import { searchMockCatalog } from "./data/mockCatalog.mjs";
import { SHOP_CATALOG } from "./data/shopCatalog.mjs";
import {
  BETA_LIVE_PROOF_BASKET,
  BETA_LIVE_PROFILE_BINDINGS,
  BETA_LIVE_PROFILE_PRODUCT_IDS
} from "./data/betaRealBasket.mjs";
import {
  confirmBetaRetailIdentity,
  isBetaRetailIdentityConfirmed
} from "./ports/betaRetailPricesPort.mjs";
import { VALIDATED_MERGE_REASON, createBasketStore, countBasketUnits } from "./state/basketStore.mjs";
import { createProductCard } from "./components/ProductCard.mjs";
import { BASKET_COMPARE_LABEL, renderBasketView } from "./components/BasketView.mjs";
import {
  createComparisonResult,
  createObservedComparisonResult
} from "./components/ComparisonResult.mjs";
import { createWebSnapshotResult } from "./components/WebSnapshotResult.mjs";
import { formatRubMinor } from "./components/ComparisonResult.mjs";
import { WEB_SNAPSHOT_META } from "./data/webPriceSnapshot.mjs";
import { compareWebSnapshot } from "./core/web-snapshot-comparison.mjs";
import { PIXEL_ICONS } from "./components/pixelIcons.mjs";
import { revealWinningBasketList } from "./runtime/listInspection.mjs";
import { createProductPhotoLoader } from "./runtime/productPhotos.mjs";
import { requestCatalogPhotos } from "./ports/catalogPhotosPort.mjs";
import { createStoresSection } from "./components/StoresMap.mjs";
import {
  CATALOG_SORT,
  buildSnapshotPriceHints,
  dockPriceSuffix,
  sortCatalogProducts
} from "./runtime/priceHints.mjs";
import {
  COMPARISON_MODE,
  comparisonPort
} from "./ports/comparisonPort.mjs";
import {
  COMPARISON_STATUS,
  createComparisonFlow
} from "./runtime/comparisonFlow.mjs";
import {
  HYBRID_BASKET_FLOW_STATUS,
  createHybridBasketFlow
} from "./runtime/hybridBasketFlow.mjs";
import {
  createHybridBasketInterpreterLoader
} from "./runtime/hybridBasketLoader.mjs";
import {
  createHybridBetaMetricsStore
} from "./runtime/hybridBasketBetaMetrics.mjs";
import {
  HYBRID_DRAFT_CONFIRMATION,
  canConfirmHybridBasketDraft
} from "./intelligence/hybridBasketConfirmation.mjs";
import { requestBasketProposal } from "./ports/basketProposalPort.mjs";
import { requestCatalogSearch } from "./ports/catalogGatewayPort.mjs";
import {
  createAiCatalogResolver,
  surfaceProductsFromCatalog
} from "./runtime/liveCatalog.mjs";
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
  emptySearchCopy: document.querySelector("#empty-search-copy"),
  catalogEyebrow: document.querySelector("#catalog-eyebrow"),
  catalogNote: document.querySelector("#catalog-note"),
  resultCount: document.querySelector("#result-count"),
  searchStatus: document.querySelector("#search-status"),
  basketContent: document.querySelector("#basket-content"),
  basketDock: document.querySelector("#basket-dock"),
  basketDockCopy: document.querySelector("#basket-dock-copy"),
  openBasket: document.querySelector("#open-basket"),
  backToShop: document.querySelector("#back-to-shop"),
  toastRegion: document.querySelector("#toast-region"),
  comparisonModeBadge: document.querySelector("#comparison-mode-badge"),
  basketModeCopy: document.querySelector("#basket-mode-copy"),
  betaLiveSection: document.querySelector("#beta-live-section"),
  betaLiveButton: document.querySelector("#beta-live-button"),
  betaLiveStatus: document.querySelector("#beta-live-status")
};

const basket = createBasketStore();
const comparisonMode = comparisonPort.mode === COMPARISON_MODE.OBSERVED
  ? COMPARISON_MODE.OBSERVED
  : COMPARISON_MODE.DEMO;
const comparisonFlow = createComparisonFlow((surfaceBasket) =>
  comparisonPort.compare(surfaceBasket)
);
const resolveAiCatalog = createAiCatalogResolver(
  requestCatalogSearch,
  { fallbackCatalog: [] }
);
const hybridInterpreterLoader = createHybridBasketInterpreterLoader();
const hybridBetaMetrics = createHybridBetaMetricsStore();
// Budget drafts ("корзина на 600 рублей") always plan against the dated
// snapshot hints: the draft text carries its own source/region label, so
// this map stays mode-independent, unlike the catalogue card hints below.
const budgetPlannerHints = buildSnapshotPriceHints();
const basketProposalFlow = createHybridBasketFlow({
  loader: hybridInterpreterLoader,
  localCatalog: SHOP_CATALOG,
  resolveLiveCatalog: resolveAiCatalog,
  requestAiProposal: requestBasketProposal,
  priceHints: budgetPlannerHints,
  applyValidatedBasket: (validatedBasket) => (
    basket.mergeValidatedBasket(validatedBasket)
  ),
  onMetric: (event) => {
    hybridBetaMetrics.record(event);
  }
});
let activeQuery = "";
let catalogSort = CATALOG_SORT.DEFAULT;
const snapshotPriceHints = comparisonMode === COMPARISON_MODE.OBSERVED
  ? new Map()
  : buildSnapshotPriceHints();

// Real product photos from Open Food Facts: exact by barcode for live
// results, "пример товара" by name for the demo catalogue. Decoration
// only — every failure silently keeps the pixel icon.
const productPhotoLoader = createProductPhotoLoader({
  requestPhotos: (requests) => requestCatalogPhotos(requests),
  storage: (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })()
});
function loadProductPhoto(product) {
  if (product?.sourceBarcode) {
    return productPhotoLoader.load({ code: product.sourceBarcode });
  }
  return productPhotoLoader.load({ name: product?.name });
}
let catalogRequestVersion = 0;
let pendingCatalogSearch = null;
let catalogSearchState = {
  status: "demo",
  query: "",
  products: [],
  discoveredCount: 0
};
let currentView = viewFromHash(location.hash);
let toastTimer;
let proposalInputRevision = 0;

elements.proposalSection.hidden = false;
elements.manualDivider.hidden = false;

if (elements.comparisonModeBadge) {
  elements.comparisonModeBadge.textContent = comparisonMode === COMPARISON_MODE.OBSERVED
    ? "OBSERVED · REAL"
    : "DEMO · MOCK";
}

if (elements.basketModeCopy) {
  elements.basketModeCopy.textContent = comparisonMode === COMPARISON_MODE.OBSERVED
    ? "Проверьте состав и запустите сравнение по доверенным наблюдениям реальных цен."
    : "Проверьте состав и запустите сравнение по трём демонстрационным магазинам.";
}

function basketQuantityFor(productId) {
  return basket.getSnapshot().find((item) => item.id === productId)?.quantity ?? 0;
}

// Home "Пример сравнения": a real snapshot comparison of an everyday demo
// basket, so a fresh visitor sees the product answer before typing anything.
const HOME_EXAMPLE_BASKET = Object.freeze([
  Object.freeze({ id: "milk-25-900", name: "Молоко 2,5%", quantity: 1 }),
  Object.freeze({ id: "eggs-c1-10", name: "Яйца C1", quantity: 1 }),
  Object.freeze({ id: "bread-wheat-400", name: "Хлеб пшеничный", quantity: 1 }),
  Object.freeze({ id: "apples-1kg", name: "Яблоки", quantity: 1 })
]);

const HOME_EXAMPLE_SWATCHES = Object.freeze({
  perekrestok: "#2f7d32",
  vkusvill: "#e8743b",
  chizhik: "#f4c430"
});

function renderHomeExample() {
  const section = document.querySelector("#home-example");
  const rowsHost = document.querySelector("#home-example-rows");
  const note = document.querySelector("#home-example-note");
  if (!section || !rowsHost) return;

  if (comparisonMode === COMPARISON_MODE.OBSERVED) {
    section.hidden = true;
    return;
  }

  let result = null;
  try {
    result = compareWebSnapshot(HOME_EXAMPLE_BASKET);
  } catch {
    return;
  }
  if (!result || result.conclusion.kind !== "cheapest") return;

  const complete = result.stores.filter((store) => store.complete);
  if (complete.length < 2) return;

  rowsHost.replaceChildren();
  const winnerMinor = complete[0].totalMinor;

  for (const store of complete) {
    const row = document.createElement("div");
    row.className = "home-example-row";

    const swatch = document.createElement("span");
    swatch.className = "hx-swatch";
    swatch.setAttribute("aria-hidden", "true");
    swatch.style.background = HOME_EXAMPLE_SWATCHES[store.retailerId] ?? "#9a6a3e";

    const name = document.createElement("span");
    name.className = "hx-name";
    name.textContent = store.name;

    const icons = document.createElement("span");
    icons.className = "hx-icons";
    icons.setAttribute("aria-hidden", "true");
    icons.innerHTML = [
      PIXEL_ICONS.milk,
      PIXEL_ICONS.eggs,
      PIXEL_ICONS.bread,
      PIXEL_ICONS.apple
    ].join("");

    const total = document.createElement("span");
    total.className = "hx-total";
    total.textContent = formatRubMinor(store.totalMinor);

    const badge = document.createElement("span");
    badge.className = "hx-badge";
    if (store.totalMinor === winnerMinor) {
      row.classList.add("is-winner");
      badge.textContent = "Выгоднее!";
    } else {
      badge.textContent = `+${formatRubMinor(store.totalMinor - winnerMinor)}`;
    }

    const main = document.createElement("span");
    main.className = "hx-main";
    const info = document.createElement("span");
    info.className = "hx-info";
    info.append(name, icons);
    main.append(swatch, info);

    const stub = document.createElement("span");
    stub.className = "hx-stub";
    stub.append(total, badge);

    if (store.totalMinor === winnerMinor) {
      const flag = document.createElement("span");
      flag.className = "hx-flag";
      flag.textContent = "Самый дешёвый";
      rowsHost.append(flag);
    }

    row.append(main, stub);
    rowsHost.append(row);
  }

  if (note) {
    note.textContent =
      `Корзина: молоко, яйца, хлеб, яблоки. Цены с сайтов магазинов, `
      + `${WEB_SNAPSHOT_META.observedDateLabel}. Регион не подтверждён.`;
  }
  section.hidden = false;
}

function renderBetaLiveSection() {
  if (!elements.betaLiveSection) return;
  elements.betaLiveSection.hidden = !(
    comparisonMode === COMPARISON_MODE.OBSERVED
    && basket.getSnapshot().length === 0
  );
}

function invalidateHybridForManualTakeover() {
  const proposalState = basketProposalFlow.getState();
  if (
    proposalState.status !== HYBRID_BASKET_FLOW_STATUS.LOADING
    && proposalState.status !== HYBRID_BASKET_FLOW_STATUS.CLARIFICATION
  ) {
    return;
  }

  hybridBetaMetrics.recordAction("manual_fallback");
  basketProposalFlow.invalidate();
  renderBasketProposalState();
}

function setupSkyControls() {
  const proposalInput = document.querySelector("#basket-proposal-input");
  const search = document.querySelector("#product-search");

  document.querySelector("#basket-cta-card")?.addEventListener("click", () => {
    elements.openBasket?.click();
  });

  const focusProposal = () => {
    proposalInput?.scrollIntoView({ behavior: "smooth", block: "center" });
    proposalInput?.focus({ preventScroll: true });
  };

  document.querySelector("#mascot-ask")?.addEventListener("click", focusProposal);
  document.querySelector("#ask-banner")?.addEventListener("click", focusProposal);

  document.querySelector("#tab-home")?.addEventListener("click", () => {
    if (typeof navigate === "function") navigate(VIEW.SHOP, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  for (const chip of document.querySelectorAll(".cat-chip")) {
    chip.addEventListener("click", () => {
      if (!search) return;
      invalidateHybridForManualTakeover();
      search.value = chip.dataset.query ?? "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".catalog-section")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }
}

function setupCatalogSort() {
  const heading = document.querySelector(".catalog-section .section-heading");
  if (!heading || document.querySelector("#catalog-sort")) return;

  const label = document.createElement("label");
  label.className = "catalog-sort";
  const caption = document.createElement("span");
  caption.className = "sr-only";
  caption.textContent = "Порядок товаров";

  const select = document.createElement("select");
  select.id = "catalog-sort";
  for (const [value, text] of [
    [CATALOG_SORT.DEFAULT, "По каталогу"],
    [CATALOG_SORT.CHEAPEST, "Сначала дешевле"],
    [CATALOG_SORT.PER_UNIT, "Выгоднее за кг/л"]
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  select.addEventListener("change", () => {
    catalogSort = select.value;
    renderCatalog();
  });

  label.append(caption, select);
  heading.append(label);
}

function renderCatalog() {
  const normalizedQuery = activeQuery.trim();
  const loading = catalogSearchState.status === "loading";
  const live = (
    catalogSearchState.status === "live"
    && catalogSearchState.query === normalizedQuery
  );
  const fallback = (
    catalogSearchState.status === "fallback"
    && catalogSearchState.query === normalizedQuery
  );

  const results = live
    ? catalogSearchState.products
    : loading
      ? []
      : sortCatalogProducts(
          searchMockCatalog(normalizedQuery, SHOP_CATALOG),
          catalogSort,
          snapshotPriceHints
        );

  elements.productGrid.replaceChildren();

  results.forEach((product) => {
    elements.productGrid.append(
      createProductCard(product, {
        quantity: basketQuantityFor(product.id),
        priceHint: live ? null : snapshotPriceHints.get(product.id),
        loadPhoto: loadProductPhoto,
        onAdd: (selectedProduct) => {
          invalidateHybridForManualTakeover();
          basket.add(selectedProduct);
          showToast(`${selectedProduct.name} добавлено`);
        }
      })
    );
  });

  if (loading) {
    elements.catalogEyebrow.textContent = "Живой каталог";
    elements.catalogNote.textContent = "Ищем товары в Open Food Facts…";
  } else if (live) {
    elements.catalogEyebrow.textContent = "Живой каталог · Open Food Facts";
    elements.catalogNote.textContent =
      "Каталог помогает идентифицировать товар. Он не подтверждает цену или наличие в магазине.";
  } else if (fallback) {
    elements.catalogEyebrow.textContent = "Демо-каталог";
    elements.catalogNote.textContent =
      "Live-каталог временно недоступен. Показан DEMO · MOCK fallback.";
  } else {
    elements.catalogEyebrow.textContent = "Демо-каталог";
    elements.catalogNote.textContent = normalizedQuery
      ? "Нажмите Enter, чтобы искать в живом каталоге. Пока показаны демо-подсказки."
      : "Тестовые позиции для резервного режима.";
  }

  const hasResults = results.length > 0;
  elements.productGrid.hidden = !hasResults;
  elements.emptySearch.hidden = loading || hasResults;
  elements.resultCount.textContent = loading ? "…" : String(results.length);

  if (loading) {
    elements.searchStatus.textContent = "Ищем товары в живом каталоге";
    return;
  }

  if (live && !hasResults) {
    elements.emptySearchCopy.textContent = catalogSearchState.discoveredCount > 0
      ? "Нашлись позиции, но без подтверждённого штрихкода и размера упаковки. Попробуйте уточнить запрос."
      : "В живом каталоге по этому запросу ничего не найдено.";
    elements.searchStatus.textContent = "Подтверждённых товаров не найдено";
    return;
  }

  elements.emptySearchCopy.textContent =
    "Попробуйте более короткий запрос — например «сыр» или «хлеб».";
  elements.searchStatus.textContent = hasResults
    ? `Найдено товаров: ${results.length}`
    : "По вашему запросу ничего не найдено";
}

function proposalProblemCopy(row) {
  const id = typeof row?.productId === "string" && row.productId
    ? ` «${row.productId}»`
    : "";

  if (row?.reason === "unknown_product_id") {
    return `Не нашли товар${id} в текущем каталоге.`;
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

function appendProposalItems(items) {
  if (!Array.isArray(items) || items.length === 0) return;

  const list = document.createElement("ul");
  list.className = "proposal-preview-list";

  items.forEach((row) => {
    const item = document.createElement("li");
    item.textContent = `${row.name} · ${row.unit} ×${row.quantity}`;
    list.append(item);
  });

  elements.proposalStatus.append(list);
}

function appendProposalAction(label, onClick, {
  secondary = false
} = {}) {
  if (!label || typeof onClick !== "function") return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = secondary
    ? "text-button proposal-inline-action"
    : "proposal-submit proposal-inline-action";
  button.textContent = label;
  button.addEventListener("click", onClick);
  elements.proposalStatus.append(button);
}

function focusProposalInput() {
  elements.proposalInput.focus({ preventScroll: true });
  elements.proposalInput.scrollIntoView({
    block: "center",
    behavior: "auto"
  });
}

function applyClarificationAction(mode) {
  const state = basketProposalFlow.confirm(mode);

  if (state.status === HYBRID_BASKET_FLOW_STATUS.SUCCESS) {
    hybridBetaMetrics.recordAction(
      mode === HYBRID_DRAFT_CONFIRMATION.ADD_FOUND_ONLY
        ? "partial_found_only"
        : "draft_confirmed"
    );

    if (mode === HYBRID_DRAFT_CONFIRMATION.CONFIRM_ALL) {
      elements.proposalInput.value = "";
      proposalInputRevision += 1;
    }
  }
  renderBasketProposalState();

  if (state.status === HYBRID_BASKET_FLOW_STATUS.SUCCESS) {
    showToast("Корзина обновлена");
  } else if (state.status === HYBRID_BASKET_FLOW_STATUS.PARTIAL) {
    showToast("Добавили только подтверждённые позиции");
  }
}

function renderBasketProposalState() {
  const state = basketProposalFlow.getState();
  const isLoading = state.status === HYBRID_BASKET_FLOW_STATUS.LOADING;

  elements.proposalSubmit.disabled = false;
  elements.proposalSubmit.textContent = isLoading
    ? "Обновить запрос"
    : "Собрать корзину";
  elements.proposalStatus.replaceChildren();
  elements.proposalFallback.hidden = true;

  if (state.status === HYBRID_BASKET_FLOW_STATUS.IDLE) return;

  const message = document.createElement("p");
  message.className = "proposal-message";

  if (state.status === HYBRID_BASKET_FLOW_STATUS.LOADING) {
    message.textContent = "Сейчас подумаю…";
    elements.proposalStatus.append(message);

    const thinkingMessage = message;
    setTimeout(() => {
      if (
        thinkingMessage.isConnected
        && basketProposalFlow.getState().status === HYBRID_BASKET_FLOW_STATUS.LOADING
      ) {
        thinkingMessage.textContent = "Проверяю товары и количество…";
      }
    }, 700);
    setTimeout(() => {
      if (
        thinkingMessage.isConnected
        && basketProposalFlow.getState().status === HYBRID_BASKET_FLOW_STATUS.LOADING
      ) {
        thinkingMessage.textContent = "Ещё секунду — сверяю варианты…";
      }
    }, 1800);
    return;
  }

  if (state.status === HYBRID_BASKET_FLOW_STATUS.SUCCESS) {
    const count = state.validation?.basket.length ?? 0;
    message.classList.add("is-success");
    message.textContent = state.presentation?.headline
      || `Корзина обновлена · ${count} поз.`;
    elements.proposalStatus.append(message);
    return;
  }

  if (state.status === HYBRID_BASKET_FLOW_STATUS.PARTIAL) {
    const accepted = Math.max(
      0,
      (state.validation?.basket.length ?? 0)
        - state.mergeRejectedRows.length
    );
    message.textContent =
      `Добавили ${accepted} поз. Остальное не подтвердилось — проверьте вручную.`;
    elements.proposalStatus.append(message);
    elements.proposalFallback.hidden = false;
    return;
  }

  if (state.status === HYBRID_BASKET_FLOW_STATUS.CLARIFICATION) {
    const view = state.presentation;
    message.textContent = view?.headline || "Нужно уточнение.";
    elements.proposalStatus.append(message);

    if (view?.message) {
      const detail = document.createElement("p");
      detail.className = "proposal-detail";
      detail.textContent = view.message;
      elements.proposalStatus.append(detail);
    }

    appendProposalItems(view?.items);

    const triggerReason = state.result?.triggerReason;
    const reason = state.result?.reason;

    const canAddFoundOnly = canConfirmHybridBasketDraft(
      state.result,
      HYBRID_DRAFT_CONFIRMATION.ADD_FOUND_ONLY
    );

    if (
      reason === "partial_validation"
      && (state.validation?.acceptedRows.length ?? 0) > 0
      && canAddFoundOnly
    ) {
      appendProposalAction(
        "Добавить только найденное",
        () => applyClarificationAction(
          HYBRID_DRAFT_CONFIRMATION.ADD_FOUND_ONLY
        )
      );
      appendProposalAction(
        "Уточнить запрос",
        focusProposalInput,
        { secondary: true }
      );
    } else if (reason === "partial_validation") {
      appendProposalAction(
        view?.primaryAction || "Уточнить запрос",
        focusProposalInput
      );
    } else if (triggerReason === "quantity_out_of_range") {
      appendProposalAction(
        "Уточнить количество",
        focusProposalInput
      );
    } else if (triggerReason === "commercial_constraint") {
      appendProposalAction(
        view?.primaryAction || "Уточнить товар",
        focusProposalInput
      );
    } else if (triggerReason === "smalltalk") {
      appendProposalAction(
        view?.primaryAction || "Написать покупки",
        focusProposalInput
      );
    } else {
      appendProposalAction(
        view?.primaryAction || "Добавить предложенное",
        () => applyClarificationAction(
          HYBRID_DRAFT_CONFIRMATION.CONFIRM_ALL
        )
      );
      appendProposalAction(
        view?.secondaryAction || "Уточнить запрос",
        focusProposalInput,
        { secondary: true }
      );
    }

    elements.proposalFallback.hidden = false;
    return;
  }

  if (state.inputReason === "empty") {
    message.textContent = "Введите продукты одной фразой.";
  } else if (state.inputReason === "too_long") {
    message.textContent =
      "Список слишком длинный. Сократите его и попробуйте снова.";
    elements.proposalFallback.hidden = false;
  } else if (state.status === HYBRID_BASKET_FLOW_STATUS.UNAVAILABLE) {
    message.textContent = state.presentation?.headline
      || "Не получилось разобрать автоматически.";
    elements.proposalFallback.hidden = false;
  } else if (state.status === HYBRID_BASKET_FLOW_STATUS.ERROR) {
    message.textContent = state.presentation?.headline
      || "Не удалось собрать черновик. Корзина не изменилась.";
    elements.proposalFallback.hidden = false;
  } else {
    message.textContent = state.presentation?.headline
      || "Не удалось безопасно собрать корзину.";
    elements.proposalFallback.hidden = false;
  }

  elements.proposalStatus.append(message);

  if (state.presentation?.message) {
    const detail = document.createElement("p");
    detail.className = "proposal-detail";
    detail.textContent = state.presentation.message;
    elements.proposalStatus.append(detail);
  }

  const problems = renderProposalProblems(state);
  if (problems) elements.proposalStatus.append(problems);
}
async function handleBasketProposal() {
  const submittedRevision = proposalInputRevision;
  const pending = basketProposalFlow.run(elements.proposalInput.value);
  renderBasketProposalState();

  const state = await pending;
  renderBasketProposalState();

  if (state.status === HYBRID_BASKET_FLOW_STATUS.SUCCESS) {
    if (proposalInputRevision === submittedRevision) {
      elements.proposalInput.value = "";
    }
    showToast("Корзина обновлена");
  } else if (state.status === HYBRID_BASKET_FLOW_STATUS.PARTIAL) {
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


// Before any live retailer read the user sees which exact items stand
// for the basket products and confirms every matching live profile.
function createBetaIdentityPrompt() {
  if (comparisonMode !== COMPARISON_MODE.OBSERVED) return null;

  const basketIds = new Set(basket.getSnapshot().map((item) => item.id));
  const matchingProfileIds = Object.entries(BETA_LIVE_PROFILE_PRODUCT_IDS)
    .filter(([, productIds]) => productIds.some((id) => basketIds.has(id)))
    .map(([profileId]) => profileId);
  const unconfirmedProfileIds = matchingProfileIds.filter(
    (profileId) => !isBetaRetailIdentityConfirmed(profileId)
  );
  if (unconfirmedProfileIds.length === 0) return null;

  const bindings = unconfirmedProfileIds.flatMap((profileId) => (
    (BETA_LIVE_PROFILE_BINDINGS[profileId] ?? []).filter((binding) => (
      basketIds.has(binding.canonicalProductId)
    ))
  ));
  if (bindings.length === 0) return null;

  const section = document.createElement("section");
  section.className = "future-step comparison-result real-identity-prompt";
  section.setAttribute("aria-label", "Проверка реальных цен в Москве");

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Реальные цены · Москва";

  const heading = document.createElement("h2");
  heading.textContent = "Проверить в METRO и Магните";

  const intro = document.createElement("p");
  intro.textContent = "Сравним одинаковые товары в обоих магазинах:";

  const list = document.createElement("ul");
  list.className = "real-identity-list";
  for (const binding of bindings) {
    const item = document.createElement("li");
    item.textContent = binding.displayName;
    list.append(item);
  }

  const note = document.createElement("p");
  note.className = "comparison-provenance";
  note.textContent = bindings.length < basketIds.size
    ? "Остальные товары корзины пока без живых цен — «дешевле» назовём, только если цены будут на всю корзину."
    : "Цены загрузятся только после подтверждения. Если условия цены неоднозначны, «дешевле» не назовём.";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "primary-button";
  action.textContent = "Подтвердить товары и сравнить";
  action.addEventListener("click", async () => {
    action.disabled = true;
    for (const profileId of unconfirmedProfileIds) {
      confirmBetaRetailIdentity(profileId);
    }
    await handleCompare();
  });

  section.append(eyebrow, heading, intro, list, note, action);
  return section;
}

function renderComparisonState({ focusResult = false } = {}) {
  const compareButton = document.querySelector("#compare-basket");
  const output = document.querySelector("#comparison-output");
  if (!compareButton || !output) return;

  const state = comparisonFlow.getState();
  const isLoading = state.status === COMPARISON_STATUS.LOADING;

  compareButton.disabled = isLoading;
  compareButton.setAttribute("aria-busy", isLoading ? "true" : "false");
  compareButton.textContent = isLoading
    ? "Сравниваем…"
    : BASKET_COMPARE_LABEL;
  output.replaceChildren();

  let resultNode = null;

  if (state.status === COMPARISON_STATUS.LOADING) {
    const progress = document.createElement("p");
    progress.className = "comparison-progress";
    progress.textContent = comparisonMode === COMPARISON_MODE.OBSERVED
      ? "Проверяем доверенные наблюдения цен без подстановки MOCK…"
      : "Проверяем одну и ту же корзину по тестовым магазинам…";
    output.append(progress);
    return;
  }

  if (state.status === COMPARISON_STATUS.SUCCESS) {
    resultNode = comparisonMode === COMPARISON_MODE.OBSERVED
      ? createObservedComparisonResult(state.result)
      : createComparisonResult(state.result, {
          onInspectStore: inspectWinningStore
        });

    if (!resultNode) {
      resultNode = createComparisonMessage(
        "Недостаточно данных",
        "CHECKNI не может безопасно показать итог по этому результату. Измените корзину или попробуйте сравнить ещё раз."
      );
    }
  } else if (state.status === COMPARISON_STATUS.NO_WINNER) {
    resultNode = comparisonMode === COMPARISON_MODE.OBSERVED
      ? createComparisonMessage(
          "Недостаточно реальных данных",
          "Реальный результат не содержит авторитетного заключения Core. MOCK-данные сюда не подставляем."
        )
      : createComparisonMessage(
          "Полного варианта нет",
          "В тестовых данных нет магазина с подтверждённым полным покрытием этой корзины. Итог и экономию не показываем."
        );
  } else if (state.status === COMPARISON_STATUS.ERROR) {
    resultNode = createComparisonMessage(
      "Не удалось сравнить",
      `Корзина сохранена, а старый результат очищен. Нажмите «${BASKET_COMPARE_LABEL}» ещё раз.`
    );
  }

  if (!resultNode) return;

  resultNode.tabIndex = -1;
  // Snapshot and OBSERVED truth stay separated, never mixed:
  // - DEMO: the dated snapshot answer is the primary block, as before.
  // - OBSERVED: the live Core result comes first and keeps focus; the
  //   snapshot block is appended below it only when it actually answers
  //   (cheapest/tie), as a clearly labelled dated reference — otherwise a
  //   normal basket on the public host gets no "where is it cheaper"
  //   answer at all while live coverage is still 2–3 proof products.
  let snapshotResult = null;
  try {
    snapshotResult = compareWebSnapshot(basket.getSnapshot());
  } catch {
    snapshotResult = null;
  }
  const snapshotAnswers = snapshotResult !== null && (
    snapshotResult.conclusion.kind === "cheapest"
    || snapshotResult.conclusion.kind === "tie"
  );
  const snapshotNode = comparisonMode === COMPARISON_MODE.DEMO
    ? createWebSnapshotResult(snapshotResult)
    : snapshotAnswers
      ? createWebSnapshotResult(snapshotResult)
      : null;

  const identityPrompt = createBetaIdentityPrompt();
  if (identityPrompt) output.append(identityPrompt);

  if (snapshotNode) {
    snapshotNode.tabIndex = -1;
    if (comparisonMode === COMPARISON_MODE.DEMO) {
      output.append(snapshotNode, resultNode);
    } else {
      output.append(resultNode, snapshotNode);
    }
  } else {
    output.append(resultNode);
  }

  const focusNode = comparisonMode === COMPARISON_MODE.DEMO
    ? snapshotNode ?? resultNode
    : resultNode;
  if (focusResult) {
    focusNode.focus({ preventScroll: true });
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

// The live example uses only products that currently pass the strict
// regular-price contract in both retailers.

async function handleBetaLiveExample() {
  if (
    comparisonMode !== COMPARISON_MODE.OBSERVED
    || basket.getSnapshot().length !== 0
    || !elements.betaLiveButton
  ) {
    return;
  }

  elements.betaLiveButton.disabled = true;
  if (elements.betaLiveStatus) {
    elements.betaLiveStatus.textContent =
      "Товары подтверждены. Собираем корзину и обновляем публичные цены…";
  }

  const exampleBasket = BETA_LIVE_PROOF_BASKET;
  const merged = basket.mergeValidatedBasket(exampleBasket);
  if (merged.rejectedRows.length > 0) {
    elements.betaLiveButton.disabled = false;
    if (elements.betaLiveStatus) {
      elements.betaLiveStatus.textContent =
        "Не удалось безопасно собрать живой пример.";
    }
    return;
  }

  // The button is an explicit, price-blind identity confirmation. No retailer
  // price is requested before this user action.
  const exampleIds = new Set(exampleBasket.map((item) => item.product.id));
  for (const [profileId, productIds] of Object.entries(BETA_LIVE_PROFILE_PRODUCT_IDS)) {
    if (productIds.some((id) => exampleIds.has(id))) {
      confirmBetaRetailIdentity(profileId);
    }
  }

  navigate(VIEW.BASKET, {
    focusMode: FOCUS_MODE.HEADING
  });
  await handleCompare();

  const state = comparisonFlow.getState();
  showToast(
    state.status === COMPARISON_STATUS.SUCCESS
      ? "Свежие реальные цены проверены"
      : "Показали только подтверждённые свежие данные"
  );
}

function renderBasket() {
  const items = basket.getSnapshot();
  renderBasketView(elements.basketContent, items, {
    onIncrement: (id) => {
      invalidateHybridForManualTakeover();
      basket.increment(id);
    },
    onDecrement: (id) => {
      invalidateHybridForManualTakeover();
      basket.decrement(id);
    },
    onRemove: (id) => {
      invalidateHybridForManualTakeover();
      basket.remove(id);
    },
    onBackToShop: returnToShop,
    comparisonMode,
    onCompare: () => {
      invalidateHybridForManualTakeover();
      void handleCompare();
    }
  });
  renderComparisonState();
}

function renderDock() {
  const items = basket.getSnapshot();
  const units = countBasketUnits(items);

  const priceSuffix = comparisonMode === COMPARISON_MODE.DEMO
    ? dockPriceSuffix(items)
    : "";

  elements.basketDockCopy.textContent = units === 0
    ? "Пока пусто"
    : `${units} шт. · ${items.length} поз.${priceSuffix}`;

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

function syncSearchDraft() {
  catalogRequestVersion += 1;
  pendingCatalogSearch = null;
  activeQuery = elements.searchInput.value;
  elements.clearSearch.hidden = activeQuery.trim().length === 0;
  catalogSearchState = {
    status: "demo",
    query: activeQuery.trim(),
    products: [],
    discoveredCount: 0
  };
  renderCatalog();
}

function handleManualSearch() {
  activeQuery = elements.searchInput.value.trim();
  elements.clearSearch.hidden = activeQuery.length === 0;

  if (!activeQuery) {
    catalogRequestVersion += 1;
    pendingCatalogSearch = null;
    catalogSearchState = {
      status: "demo",
      query: "",
      products: [],
      discoveredCount: 0
    };
    renderCatalog();
    return Promise.resolve();
  }

  if (
    pendingCatalogSearch
    && pendingCatalogSearch.query === activeQuery
    && pendingCatalogSearch.requestId === catalogRequestVersion
    && pendingCatalogSearch.promise
  ) {
    return pendingCatalogSearch.promise;
  }

  const requestId = ++catalogRequestVersion;
  const query = activeQuery;
  const pendingToken = {
    query,
    requestId,
    promise: null
  };
  pendingCatalogSearch = pendingToken;

  catalogSearchState = {
    status: "loading",
    query,
    products: [],
    discoveredCount: 0
  };
  renderCatalog();

  const executionPromise = (async () => {
    try {
      const result = await requestCatalogSearch([query], { limitPerQuery: 8 });
      if (requestId !== catalogRequestVersion) return;

      if (result.kind === "catalog") {
        const products = surfaceProductsFromCatalog(result.products);
        catalogSearchState = {
          status: "live",
          query,
          products,
          discoveredCount: result.products.length + (result.rejectedCount ?? 0)
        };
      } else {
        catalogSearchState = {
          status: "fallback",
          query,
          products: [],
          discoveredCount: 0
        };
      }

      renderCatalog();
    } finally {
      if (pendingCatalogSearch === pendingToken) {
        pendingCatalogSearch = null;
      }
    }
  })();

  pendingToken.promise = executionPromise;
  return executionPromise;
}

const preloadHybridInterpreter = () => {
  void basketProposalFlow.preload().catch(() => {});
};

elements.proposalInput.addEventListener("pointerdown", preloadHybridInterpreter, {
  once: true
});
elements.proposalInput.addEventListener("focus", preloadHybridInterpreter, {
  once: true
});

elements.proposalInput.addEventListener("input", () => {
  proposalInputRevision += 1;

  const proposalState = basketProposalFlow.getState();

  if (
    proposalState.status
    === HYBRID_BASKET_FLOW_STATUS.LOADING
  ) {
    hybridBetaMetrics.recordAction("pending_edit_cancelled");
    basketProposalFlow.invalidate();
    renderBasketProposalState();
    return;
  }

  if (
    proposalState.status
    === HYBRID_BASKET_FLOW_STATUS.CLARIFICATION
  ) {
    hybridBetaMetrics.recordAction("clarification_edit");
    basketProposalFlow.invalidate();
    renderBasketProposalState();
  }
});

elements.proposalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleBasketProposal();
});

elements.proposalFallback.addEventListener("click", () => {
  const proposalState = basketProposalFlow.getState();
  const activeHybrid = (
    proposalState.status === HYBRID_BASKET_FLOW_STATUS.LOADING
    || proposalState.status === HYBRID_BASKET_FLOW_STATUS.CLARIFICATION
  );
  invalidateHybridForManualTakeover();
  if (!activeHybrid) {
    hybridBetaMetrics.recordAction("manual_fallback");
  }
  elements.searchInput.focus({ preventScroll: true });
  elements.searchInput.scrollIntoView({ block: "center", behavior: "auto" });
});

elements.betaLiveButton?.addEventListener("click", () => {
  void handleBetaLiveExample();
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  invalidateHybridForManualTakeover();
  void handleManualSearch();
});

elements.searchInput.addEventListener("input", () => {
  invalidateHybridForManualTakeover();
  syncSearchDraft();
});

elements.clearSearch.addEventListener("click", () => {
  invalidateHybridForManualTakeover();
  catalogRequestVersion += 1;
  pendingCatalogSearch = null;
  elements.searchInput.value = "";
  activeQuery = "";
  catalogSearchState = {
    status: "demo",
    query: "",
    products: [],
    discoveredCount: 0
  };
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
  renderBetaLiveSection();
});

history.replaceState(
  createRouteState(currentView, null, window.scrollY),
  "",
  hashForView(currentView)
);

renderCatalog();
renderBasket();
renderHomeExample();
setupCatalogSort();
setupSkyControls();
// "Магазины": honest store map + list, mounted after the catalogue.
try {
  document.querySelector(".catalog-section")?.after(createStoresSection());
} catch {
  // The map is decoration; the shop must render without it.
}
renderDock();
renderBetaLiveSection();
renderBasketProposalState();
renderView({ scrollY: scrollYFromState(history.state) });
