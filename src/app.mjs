import { MOCK_CATALOG, searchMockCatalog } from "./data/mockCatalog.mjs";
import { VALIDATED_MERGE_REASON, createBasketStore, countBasketUnits } from "./state/basketStore.mjs";
import { createProductCard } from "./components/ProductCard.mjs";
import { renderBasketView } from "./components/BasketView.mjs";
import { createComparisonResult } from "./components/ComparisonResult.mjs";
import { revealWinningBasketList } from "./runtime/listInspection.mjs";
import { comparisonPort } from "./ports/comparisonPort.mjs";
import {
  COMPARISON_STATUS,
  createComparisonFlow
} from "./runtime/comparisonFlow.mjs";
import {
  BASKET_PROPOSAL_STATUS,
  createBasketProposalFlow
} from "./runtime/basketProposalFlow.mjs";
import { isBasketProposalConfigured, requestBasketProposal } from "./ports/basketProposalPort.mjs";
import {
  FOCUS_MODE,
  VIEW,
  createRouteState,
  focusTargetId,
  hashForView,
  scrollYFromState,
  shouldUseHistoryBack,
  viewFromHash
} from "./runtime/navigation.mjs";

const elements = {
  brandHome: document.querySelector(".brand"),
  shopView: document.querySelector("#shop-view"),
  basketView: document.querySelector("#basket-view"),
  proposalSection: document.querySelector("#basket-proposal-section"),
  manualDivider: document.querySelector("#manual-divider"),
  proposalForm: document.querySelector("#basket-proposal-form"),
  proposalInput: document.querySelector("#basket-proposal-input"),
  proposalSubmit: document.querySelector("#basket-proposal-submit"),
  proposalStatus: document.querySelector("#basket-proposal-status"),
  proposalFallback: document.querySelector("#basket-proposal-fallback"),
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#product-search"),
  clearSearch: document.querySelector("#clear-search"),
  productGrid: document.querySelector("#product-grid"),
  emptySearch: document.querySelector("#empty-search"),
  resultCount: document.querySelector("#result-count"),
  searchStatus: document.querySelector("#search-status"),
  basketContent: document.querySelector("#basket-content"),
  basketDock: document.querySelector("#basket-dock"),
  basketDockCopy: document.querySelector("#basket-dock-copy"),
  openBasket: document.querySelector("#open-basket"),
  backToShop: document.querySelector("#back-to-shop"),
  toastRegion: document.querySelector("#toast-region")
};

const basket = createBasketStore();
const comparisonFlow = createComparisonFlow((surfaceBasket) =>
  comparisonPort.compare(surfaceBasket)
);
const basketProposalFlow = createBasketProposalFlow(
  requestBasketProposal,
  (validatedBasket) => basket.mergeValidatedBasket(validatedBasket)
);
let activeQuery = "";
let currentView = viewFromHash(location.hash);
let toastTimer;

const proposalTransportConfigured = isBasketProposalConfigured();
elements.proposalSection.hidden = !proposalTransportConfigured;
elements.manualDivider.hidden = !proposalTransportConfigured;

function basketQuantityFor(productId) {
  return basket.getSnapshot().find((item) => item.id === productId)?.quantity ?? 0;
}

function renderCatalog() {
  const results = searchMockCatalog(activeQuery, MOCK_CATALOG);
  elements.productGrid.replaceChildren();

  results.forEach((product) => {
    elements.productGrid.append(
      createProductCard(product, {
        quantity: basketQuantityFor(product.id),
        onAdd: (selectedProduct) => {
          basket.add(selectedProduct);
          showToast(`${selectedProduct.name} добавлено`);
        }
      })
    );
  });

  const hasResults = results.length > 0;
  elements.productGrid.hidden = !hasResults;
  elements.emptySearch.hidden = hasResults;
  elements.resultCount.textContent = String(results.length);
  elements.searchStatus.textContent = hasResults
    ? `Найдено товаров: ${results.length}`
    : "По вашему запросу ничего не найдено";
}

function proposalProblemCopy(row) {
  const id = typeof row?.productId === "string" && row.productId
    ? ` «${row.productId}»`
    : "";

  if (row?.reason === "unknown_product_id") {
    return `Не нашли товар${id} в демо-каталоге.`;
  }
  if (row?.reason === "invalid_quantity") {
    return `Некорректное количество для позиции${id}.`;
  }
  if (row?.reason === "extra_row_fields") {
    return `Позиция${id} отклонена: источник прислал лишние поля.`;
  }
  if (row?.reason === VALIDATED_MERGE_REASON.QUANTITY_LIMIT) {
    return `Позиция${id} не добавлена: достигнут лимит количества.`;
  }
  if (row?.reason === VALIDATED_MERGE_REASON.METADATA_CONFLICT) {
    return `Позиция${id} не добавлена из-за конфликта данных.`;
  }

  return `Позиция${id || ""} не добавлена.`;
}

function renderProposalProblems(state) {
  const validation = state.validation;
  if (!validation) return null;

  const problems = [
    ...validation.unresolvedRows,
    ...validation.rejectedRows,
    ...state.mergeRejectedRows
  ];

  if (problems.length === 0) return null;

  const list = document.createElement("ul");
  list.className = "proposal-problems";
  problems.forEach((row) => {
    const item = document.createElement("li");
    item.textContent = proposalProblemCopy(row);
    list.append(item);
  });
  return list;
}

function renderBasketProposalState() {
  const state = basketProposalFlow.getState();
  const isLoading = state.status === BASKET_PROPOSAL_STATUS.LOADING;

  elements.proposalSubmit.disabled = isLoading;
  elements.proposalSubmit.textContent = isLoading
    ? "Разбираем…"
    : "Добавить из фразы";
  elements.proposalStatus.replaceChildren();
  elements.proposalFallback.hidden = true;

  if (state.status === BASKET_PROPOSAL_STATUS.IDLE) return;

  const message = document.createElement("p");
  message.className = "proposal-message";

  if (state.status === BASKET_PROPOSAL_STATUS.LOADING) {
    message.textContent = "Разбираем список. Ручной поиск остаётся доступен.";
  } else if (state.status === BASKET_PROPOSAL_STATUS.SUCCESS) {
    const count = state.validation?.basket.length ?? 0;
    message.classList.add("is-success");
    message.textContent = `Добавлено из фразы: ${count} поз.`;
  } else if (state.status === BASKET_PROPOSAL_STATUS.PARTIAL) {
    const accepted = Math.max(
      0,
      (state.validation?.basket.length ?? 0) - state.mergeRejectedRows.length
    );
    message.textContent =
      `Добавили ${accepted} поз. Остальное не добавляли без подтверждения.`;
    elements.proposalFallback.hidden = false;
  } else if (state.status === BASKET_PROPOSAL_STATUS.UNAVAILABLE) {
    message.textContent =
      "Быстрый ввод сейчас недоступен. Корзину можно собрать обычным поиском.";
    elements.proposalFallback.hidden = false;
  } else if (state.status === BASKET_PROPOSAL_STATUS.ERROR) {
    message.textContent =
      "Не удалось разобрать список. Корзина не изменилась — используйте ручной поиск.";
    elements.proposalFallback.hidden = false;
  } else if (state.inputReason === "empty") {
    message.textContent = "Введите продукты одной фразой.";
  } else if (state.inputReason === "too_long") {
    message.textContent = "Список слишком длинный. Сократите его и попробуйте снова.";
    elements.proposalFallback.hidden = false;
  } else {
    message.textContent =
      "Не удалось безопасно разобрать список. Ничего неподтверждённого не добавлено.";
    elements.proposalFallback.hidden = false;
  }

  elements.proposalStatus.append(message);
  const problems = renderProposalProblems(state);
  if (problems) elements.proposalStatus.append(problems);
}

async function handleBasketProposal() {
  const pending = basketProposalFlow.run(elements.proposalInput.value);
  renderBasketProposalState();

  const state = await pending;
  renderBasketProposalState();

  if (state.status === BASKET_PROPOSAL_STATUS.SUCCESS) {
    elements.proposalInput.value = "";
    showToast("Корзина обновлена");
  } else if (state.status === BASKET_PROPOSAL_STATUS.PARTIAL) {
    showToast("Добавили только подтверждённые позиции");
  }
}

function returnToShop() {
  if (shouldUseHistoryBack(currentView, history.state)) {
    history.back();
    return;
  }

  navigate(VIEW.SHOP, {
    replace: true,
    focusMode: FOCUS_MODE.HEADING
  });
}

function createComparisonMessage(title, copy) {
  const section = document.createElement("section");
  section.className = "future-step comparison-result comparison-state";
  section.tabIndex = -1;

  const heading = document.createElement("h2");
  heading.textContent = title;

  const message = document.createElement("p");
  message.textContent = copy;

  section.append(heading, message);
  return section;
}

function inspectWinningStore(storeId) {
  const state = comparisonFlow.getState();
  const winner = state.status === COMPARISON_STATUS.SUCCESS
    ? state.result?.winner
    : null;

  if (!winner || winner.storeId !== storeId) return;

  revealWinningBasketList(document, winner.storeName);
  showToast(
    `Список для ${winner.storeName}: ${basket.getSnapshot().length} поз.`
  );
}

function renderComparisonState({ focusResult = false } = {}) {
  const compareButton = document.querySelector("#compare-basket");
  const output = document.querySelector("#comparison-output");
  if (!compareButton || !output) return;

  const state = comparisonFlow.getState();
  const isLoading = state.status === COMPARISON_STATUS.LOADING;

  compareButton.disabled = isLoading;
  compareButton.textContent = isLoading ? "Сравниваем…" : "Сравнить магазины";
  output.replaceChildren();

  let resultNode = null;

  if (state.status === COMPARISON_STATUS.LOADING) {
    const progress = document.createElement("p");
    progress.className = "comparison-progress";
    progress.textContent = "Проверяем одну и ту же корзину по тестовым магазинам…";
    output.append(progress);
    return;
  }

  if (state.status === COMPARISON_STATUS.SUCCESS) {
    resultNode = createComparisonResult(state.result, {
      onInspectStore: inspectWinningStore
    });

    if (!resultNode) {
      resultNode = createComparisonMessage(
        "Недостаточно данных",
        "CHECKNI не может безопасно показать итог по этому результату. Измените корзину или попробуйте сравнить ещё раз."
      );
    }
  } else if (state.status === COMPARISON_STATUS.NO_WINNER) {
    resultNode = createComparisonMessage(
      "Полного варианта нет",
      "В тестовых данных нет магазина с подтверждённым полным покрытием этой корзины. Итог и экономию не показываем."
    );
  } else if (state.status === COMPARISON_STATUS.ERROR) {
    resultNode = createComparisonMessage(
      "Не удалось сравнить",
      "Корзина сохранена, а старый результат очищен. Нажмите «Сравнить магазины» ещё раз."
    );
  }

  if (!resultNode) return;

  resultNode.tabIndex = -1;
  output.append(resultNode);

  if (focusResult) {
    resultNode.focus({ preventScroll: true });
  }
}

async function handleCompare() {
  const pending = comparisonFlow.run(basket.getSnapshot());
  renderComparisonState();

  const state = await pending;
  renderComparisonState({
    focusResult:
      state.status === COMPARISON_STATUS.SUCCESS ||
      state.status === COMPARISON_STATUS.NO_WINNER ||
      state.status === COMPARISON_STATUS.ERROR
  });
}

function renderBasket() {
  const items = basket.getSnapshot();
  renderBasketView(elements.basketContent, items, {
    onIncrement: (id) => basket.increment(id),
    onDecrement: (id) => basket.decrement(id),
    onRemove: (id) => basket.remove(id),
    onBackToShop: returnToShop,
    onCompare: () => {
      void handleCompare();
    }
  });
  renderComparisonState();
}

function renderDock() {
  const items = basket.getSnapshot();
  const units = countBasketUnits(items);

  elements.basketDockCopy.textContent = units === 0
    ? "Пока пусто"
    : `${units} шт. · ${items.length} поз.`;

  elements.openBasket.classList.toggle("has-items", units > 0);
  elements.openBasket.setAttribute(
    "aria-label",
    units === 0 ? "Открыть пустую корзину" : `Открыть корзину, товаров: ${units}`
  );
}

function focusCurrentView(mode) {
  const targetId = focusTargetId(currentView, mode);
  if (!targetId) return;

  document.getElementById(targetId)?.focus({ preventScroll: true });
}

function renderView({
  focusMode = FOCUS_MODE.NONE,
  scrollY = 0
} = {}) {
  const isBasket = currentView === VIEW.BASKET;

  elements.shopView.hidden = isBasket;
  elements.basketView.hidden = !isBasket;
  elements.basketDock.hidden = isBasket;

  if (isBasket) {
    renderBasket();
  }

  focusCurrentView(focusMode);
  window.scrollTo({ top: scrollY, behavior: "auto" });
}

function navigate(view, {
  replace = false,
  focusMode = FOCUS_MODE.INTERACTIVE
} = {}) {
  if (view !== VIEW.SHOP && view !== VIEW.BASKET) return;

  const previousView = currentView;
  currentView = view;
  const hash = hashForView(view);

  if (replace) {
    history.replaceState(createRouteState(view), "", hash);
  } else if (location.hash !== hash) {
    history.replaceState(
      createRouteState(
        previousView,
        history.state?.checkniSurfaceFrom ?? null,
        window.scrollY
      ),
      ""
    );
    history.pushState(createRouteState(view, previousView), "", hash);
  }

  renderView({ focusMode });
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toastRegion.textContent = message;
  elements.toastRegion.classList.add("is-visible");

  toastTimer = window.setTimeout(() => {
    elements.toastRegion.classList.remove("is-visible");
  }, 1600);
}

function syncSearch() {
  activeQuery = elements.searchInput.value;
  elements.clearSearch.hidden = activeQuery.length === 0;
  renderCatalog();
}

elements.proposalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleBasketProposal();
});

elements.proposalFallback.addEventListener("click", () => {
  elements.searchInput.focus({ preventScroll: true });
  elements.searchInput.scrollIntoView({ block: "center", behavior: "auto" });
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  syncSearch();
});

elements.searchInput.addEventListener("input", syncSearch);

elements.clearSearch.addEventListener("click", () => {
  elements.searchInput.value = "";
  activeQuery = "";
  elements.clearSearch.hidden = true;
  renderCatalog();
  elements.searchInput.focus();
});

elements.brandHome.addEventListener("click", (event) => {
  event.preventDefault();
  returnToShop();
});
elements.openBasket.addEventListener("click", () => navigate(VIEW.BASKET));
elements.backToShop.addEventListener("click", returnToShop);

window.addEventListener("popstate", () => {
  currentView = viewFromHash(location.hash);
  renderView({
    focusMode: FOCUS_MODE.HEADING,
    scrollY: scrollYFromState(history.state)
  });
});

basket.subscribe(() => {
  comparisonFlow.invalidate();
  renderCatalog();
  renderBasket();
  renderDock();
});

history.replaceState(
  createRouteState(currentView, null, window.scrollY),
  "",
  hashForView(currentView)
);

renderCatalog();
renderBasket();
renderDock();
renderBasketProposalState();
renderView({ scrollY: scrollYFromState(history.state) });
