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
import { createOkeyStoreDirectory } from "./components/OkeyStoreDirectory.mjs";
import { createMagnitStorePicker } from "./components/MagnitStorePicker.mjs";
import { resolveMagnitMoscowStore } from "./data/magnitMoscowStores.mjs";
import { createOkeyDeliveryCatalog } from "./components/OkeyDeliveryCatalog.mjs";
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
  RETAIL_CATALOG_IDS,
  createRetailCatalogClient,
  getRetailCatalogDefinition
} from "./ports/retailCatalogPort.mjs";
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
  mascotStage: document.querySelector(".hero-identity"),
  mascotBubble: document.querySelector(".hero-bubble"),
  mascotImage: document.querySelector(".hero-mascot"),
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
  betaLiveStatus: document.querySelector("#beta-live-status"),
  retailBrowser: document.querySelector("#retail-browser"),
  retailStoreGrid: document.querySelector("#retail-store-grid"),
  retailCatalogNav: document.querySelector("#retail-catalog-nav"),
  retailCategoryBack: document.querySelector("#retail-category-back"),
  retailCategoryTitle: document.querySelector("#retail-category-title"),
  retailCategoryNote: document.querySelector("#retail-category-note"),
  retailBreadcrumbs: document.querySelector("#retail-breadcrumbs"),
  retailCategoryGrid: document.querySelector("#retail-category-grid"),
  retailCategoryStatus: document.querySelector("#retail-category-status")
};

const basket = createBasketStore();
const comparisonMode = comparisonPort.mode === COMPARISON_MODE.OBSERVED
  ? COMPARISON_MODE.OBSERVED
  : COMPARISON_MODE.DEMO;
const runtimeHostname = typeof location?.hostname === "string"
  ? location.hostname.trim().toLowerCase()
  : "";
const isPublicBetaHost = (
  runtimeHostname === "checkni.vercel.app"
  || runtimeHostname.endsWith(".vercel.app")
  || runtimeHostname === "zebrarectifier.github.io"
);
const publicRetailCatalogMode = (
  comparisonMode === COMPARISON_MODE.OBSERVED
  && (
    isPublicBetaHost
    || new URLSearchParams(location.search).get("catalog") === "retail"
  )
);
const DEFAULT_RETAILER_ID = "globus";
const retailCatalogClients = new Map(
  RETAIL_CATALOG_IDS.map((retailerId) => [
    retailerId,
    createRetailCatalogClient({ retailerId })
  ])
);
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
  if (typeof product?.imageUrl === "string" && product.imageUrl) {
    return Promise.resolve(product.imageUrl);
  }
  if (product?.sourceBarcode) {
    return productPhotoLoader.load({ code: product.sourceBarcode });
  }
  return productPhotoLoader.load({ name: product?.name });
}
let catalogRequestVersion = 0;
let retailBrowserRequestVersion = 0;
let pendingCatalogSearch = null;
let catalogSearchState = {
  status: publicRetailCatalogMode ? "loading" : "demo",
  query: "",
  products: [],
  retailCount: 0,
  discoveredCount: 0,
  categoryExpectedCount: 0,
  nextOffset: 0,
  canLoadMore: false,
  loadingMore: false,
  loadMoreError: false
};
let retailBrowserState = {
  retailerId: DEFAULT_RETAILER_ID,
  status: "idle",
  path: [],
  categories: [],
  rootProductCount:
    getRetailCatalogDefinition(DEFAULT_RETAILER_ID)?.defaultProductCount ?? 0
};

let selectedMagnitStore = resolveMagnitMoscowStore({
  shopCode: history.state?.checkniMagnitShopCode
}) ?? resolveMagnitMoscowStore({ shopCode: "777312" });
let magnitStorePicker = null;

function retailDefinitionFor(retailerId) {
  const base = getRetailCatalogDefinition(retailerId);
  if (retailerId !== "magnit" || selectedMagnitStore.shopCode === base.shopCode) return base;
  return {
    ...base,
    shopCode: selectedMagnitStore.shopCode,
    storeId: "magnit-" + selectedMagnitStore.shopCode,
    storeAddress: selectedMagnitStore.address,
    storeName: "Магнит · " + selectedMagnitStore.address,
    catalogLabel: "Магнит · " + selectedMagnitStore.address,
    scopeLabel: selectedMagnitStore.address + " · публичная цена сайта · наличие неизвестно",
    defaultProductCount: null,
    rootCategoryCount: null
  };
}

function currentRetailDefinition() {
  return retailDefinitionFor(retailBrowserState.retailerId)
    ?? getRetailCatalogDefinition(DEFAULT_RETAILER_ID);
}

function currentRetailClient() {
  if (retailBrowserState.retailerId === "magnit") {
    const key = "magnit-" + selectedMagnitStore.shopCode;
    if (!retailCatalogClients.has(key)) {
      retailCatalogClients.set(key, createRetailCatalogClient({
        retailerId: "magnit", store: selectedMagnitStore
      }));
    }
    return retailCatalogClients.get(key);
  }
  return retailCatalogClients.get(retailBrowserState.retailerId)
    ?? retailCatalogClients.get(DEFAULT_RETAILER_ID);
}

function validRetailerId(value) {
  return typeof value === "string" && getRetailCatalogDefinition(value)
    ? value
    : DEFAULT_RETAILER_ID;
}
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

const MASCOT_COPY = Object.freeze({
  idle: "Что ищем сегодня?",
  curious: "Уточним — и я добью корзину.",
  searching: "Ищу и сверяю товары…",
  checking: "Проверяю варианты…",
  found: "Нашёл. Проверь корзину.",
  partial: "Часть нашёл — остальное уточним.",
  error: "Не вышло. Корзина цела.",
  big_saving: "О, тут уже есть экономия."
});

function setMascotState(state = "idle", copy = null) {
  if (!elements.mascotStage || !elements.mascotBubble) return;

  const safeState = Object.prototype.hasOwnProperty.call(MASCOT_COPY, state)
    ? state
    : "idle";
  elements.mascotStage.dataset.mascotState = safeState;
  elements.mascotBubble.textContent = copy || MASCOT_COPY[safeState];

  if (elements.mascotImage) {
    elements.mascotImage.dataset.mascotState = safeState;
  }
}

function mascotStateForHybrid(status) {
  if (status === HYBRID_BASKET_FLOW_STATUS.LOADING) return "searching";
  if (status === HYBRID_BASKET_FLOW_STATUS.SUCCESS) return "found";
  if (status === HYBRID_BASKET_FLOW_STATUS.PARTIAL) return "partial";
  if (status === HYBRID_BASKET_FLOW_STATUS.CLARIFICATION) return "curious";
  if (
    status === HYBRID_BASKET_FLOW_STATUS.UNAVAILABLE
    || status === HYBRID_BASKET_FLOW_STATUS.ERROR
  ) return "error";
  if (status === HYBRID_BASKET_FLOW_STATUS.REJECTED) return "curious";
  return "idle";
}

function comparisonHasPositiveSavings(result) {
  const direct = result?.savingsMinor;
  const observed = result?.conclusion?.savingsMinor;
  return (
    (Number.isSafeInteger(direct) && direct > 0)
    || (Number.isSafeInteger(observed) && observed > 0)
  );
}

function mascotStateForComparison(state) {
  if (state.status === COMPARISON_STATUS.LOADING) return "checking";
  if (state.status === COMPARISON_STATUS.SUCCESS) {
    return comparisonHasPositiveSavings(state.result)
      ? "big_saving"
      : "found";
  }
  if (state.status === COMPARISON_STATUS.NO_WINNER) return "partial";
  if (state.status === COMPARISON_STATUS.ERROR) return "error";
  return "idle";
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
      if (publicRetailCatalogMode) {
        void handleManualSearch();
      }
      document.querySelector(".catalog-section")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }
}

function formatCatalogCount(value) {
  return new Intl.NumberFormat("ru-RU").format(
    Number.isSafeInteger(value) && value >= 0 ? value : 0
  );
}

function russianCountNoun(value, one, few, many) {
  const count = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function retailStoreCountCopy(definition, productCount) {
  if (!Number.isSafeInteger(productCount)) return "Каталог выбранного адреса";
  const products =
    `${formatCatalogCount(productCount)} ${russianCountNoun(
      productCount,
      "товар",
      "товара",
      "товаров"
    )}`;
  const categoryCount = definition?.rootCategoryCount;
  if (!Number.isSafeInteger(categoryCount) || categoryCount <= 0) {
    return products;
  }
  const categories =
    `${formatCatalogCount(categoryCount)} ${russianCountNoun(
      categoryCount,
      "категория",
      "категории",
      "категорий"
    )}`;
  return `${categories} · ${products}`;
}

function renderRetailStoreButtons() {
  if (!elements.retailStoreGrid) return;

  elements.retailStoreGrid.replaceChildren();
  for (const retailerId of RETAIL_CATALOG_IDS) {
    const definition = retailDefinitionFor(retailerId);
    if (!definition) continue;

    const selected = retailerId === retailBrowserState.retailerId;
    const button = document.createElement("button");
    button.type = "button";
    button.id = retailerId === DEFAULT_RETAILER_ID
      ? "retail-store-card"
      : `retail-store-card-${retailerId}`;
    button.className = selected
      ? "retail-store-card is-selected"
      : "retail-store-card";
    button.dataset.retailerId = retailerId;
    button.setAttribute("aria-pressed", selected ? "true" : "false");

    const logo = document.createElement("span");
    logo.className = "retail-store-logo";
    logo.setAttribute("aria-hidden", "true");
    logo.textContent = definition.logo;

    const copy = document.createElement("span");
    copy.className = "retail-store-copy";
    const kicker = document.createElement("span");
    kicker.className = "retail-store-kicker";
    kicker.textContent = "Магазин";
    const name = document.createElement("strong");
    name.textContent = definition.storeName;
    const scope = document.createElement("span");
    scope.textContent = definition.scopeLabel;
    copy.append(kicker, name, scope);

    const total = document.createElement("span");
    total.className = "retail-store-total";
    const count = selected
      ? retailBrowserState.rootProductCount
      : definition.defaultProductCount;
    total.textContent = retailStoreCountCopy(definition, count);

    button.append(logo, copy, total);
    button.addEventListener("click", () => {
      if (selected) {
        elements.retailCatalogNav?.scrollIntoView?.({
          behavior: "smooth",
          block: "start"
        });
        return;
      }
      void selectRetailer(retailerId);
    });
    elements.retailStoreGrid.append(button);
  }
}

function renderRetailBrowser() {
  if (!elements.retailBrowser) return;

  if (!publicRetailCatalogMode) {
    elements.retailBrowser.hidden = true;
    return;
  }

  const definition = currentRetailDefinition();
  elements.retailBrowser.hidden = false;
  renderRetailStoreButtons();
  magnitStorePicker?.update({
    visible: retailBrowserState.retailerId === "magnit",
    store: selectedMagnitStore,
    status: retailBrowserState.status,
    hasCategories: retailBrowserState.path.length > 0 || retailBrowserState.categories.length > 0
  });
  elements.retailCategoryGrid.replaceChildren();

  const current = retailBrowserState.path.at(-1) ?? null;
  elements.retailCategoryTitle.textContent = current?.name ?? "Категории";
  elements.retailCategoryNote.textContent = current
    ? retailBrowserState.status === "loading"
      ? "Загружаем раздел каталога…"
      : retailBrowserState.status === "error"
        ? "Раздел временно не загрузился. Можно повторить."
        : retailBrowserState.categories.length > 0
          ? "Выберите подкатегорию. Если раздел конечный — ниже сразу появятся товары."
          : "Конечный раздел. Товары показаны ниже."
    : "Выберите раздел, затем подкатегорию — товары появятся ниже.";
  elements.retailCategoryBack.hidden = retailBrowserState.path.length === 0;

  elements.retailBreadcrumbs.replaceChildren();
  if (retailBrowserState.path.length > 0) {
    const rootButton = document.createElement("button");
    rootButton.type = "button";
    rootButton.textContent = "Категории";
    rootButton.addEventListener("click", () => {
      void navigateRetailPath([]);
    });
    elements.retailBreadcrumbs.append(rootButton);

    for (let index = 0; index < retailBrowserState.path.length; index += 1) {
      const category = retailBrowserState.path[index];
      const separator = document.createElement("span");
      separator.textContent = "›";
      separator.setAttribute("aria-hidden", "true");
      elements.retailBreadcrumbs.append(separator);

      const isCurrent = index === retailBrowserState.path.length - 1;
      if (isCurrent) {
        const currentCrumb = document.createElement("span");
        currentCrumb.className = "is-current";
        currentCrumb.textContent = category.name;
        currentCrumb.setAttribute("aria-current", "page");
        elements.retailBreadcrumbs.append(currentCrumb);
      } else {
        const crumb = document.createElement("button");
        crumb.type = "button";
        crumb.textContent = category.name;
        crumb.addEventListener("click", () => {
          void navigateRetailPath(
            retailBrowserState.path.slice(0, index + 1)
          );
        });
        elements.retailBreadcrumbs.append(crumb);
      }
    }
  }
  elements.retailBreadcrumbs.hidden = retailBrowserState.path.length === 0;

  if (retailBrowserState.status === "loading") {
    const loading = document.createElement("button");
    loading.type = "button";
    loading.className = "retail-category-button is-loading";
    loading.disabled = true;
    const title = document.createElement("strong");
    title.textContent = "Загружаем каталог…";
    loading.append(title);
    elements.retailCategoryGrid.append(loading);
    elements.retailCategoryStatus.textContent =
      `Загружаем категории ${definition.displayName}`;
    return;
  }

  if (retailBrowserState.status === "error") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retail-category-button retail-category-retry";
    const title = document.createElement("strong");
    title.textContent = "Повторить загрузку";
    const note = document.createElement("span");
    note.textContent = "Категории временно не загрузились";
    retry.append(title, note);
    retry.addEventListener("click", () => {
      const parent = retailBrowserState.path.at(-1);
      if (parent) {
        void loadRetailChildren(parent, retailBrowserState.path);
      } else {
        void loadRetailRoots();
      }
    });
    elements.retailCategoryGrid.append(retry);

    if (retailBrowserState.path.length > 0) {
      const parentButton = document.createElement("button");
      parentButton.type = "button";
      parentButton.className = "retail-category-button retail-category-exit";
      const parentTitle = document.createElement("strong");
      parentTitle.textContent = retailBrowserState.path.length > 1
        ? "Вернуться на уровень выше"
        : "Вернуться ко всем категориям";
      const parentNote = document.createElement("span");
      parentNote.textContent = "Можно выбрать другой раздел";
      parentButton.append(parentTitle, parentNote);
      parentButton.addEventListener("click", () => {
        void navigateRetailPath(retailBrowserState.path.slice(0, -1));
      });
      elements.retailCategoryGrid.append(parentButton);
    }

    elements.retailCategoryStatus.textContent =
      `Категории ${definition.displayName} временно недоступны. Можно повторить или вернуться назад.`;
    return;
  }

  for (const category of retailBrowserState.categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "retail-category-button";
    button.dataset.categoryId = String(category.categoryId);

    const title = document.createElement("strong");
    title.textContent = category.name;
    const count = document.createElement("span");
    const productNoun = russianCountNoun(
      category.productCount,
      "товар",
      "товара",
      "товаров"
    );
    count.textContent = category.productCount > 0
      ? `${formatCatalogCount(category.productCount)} ${productNoun} · открыть`
      : "Товары не заявлены · проверить раздел";

    const arrow = document.createElement("span");
    arrow.className = "retail-category-arrow";
    arrow.textContent = "→";
    arrow.setAttribute("aria-hidden", "true");

    button.append(title, count, arrow);
    button.addEventListener("click", () => {
      void openRetailCategory(category);
    });
    elements.retailCategoryGrid.append(button);
  }

  elements.retailCategoryStatus.textContent = retailBrowserState.categories.length > 0
    ? `Разделов: ${retailBrowserState.categories.length}`
    : "Подкатегорий нет";
}

function normalizeRetailHistoryPath(path) {
  if (!Array.isArray(path) || path.length > 7) return null;

  const normalized = [];
  for (const category of path) {
    const categoryId = Number(category?.categoryId);
    const name = typeof category?.name === "string"
      ? category.name.trim()
      : "";
    const depth = Number(category?.depth);
    const sourceUrl = typeof category?.sourceUrl === "string"
      ? category.sourceUrl.trim()
      : "";
    const productCount = Number(category?.productCount);

    if (
      !Number.isSafeInteger(categoryId)
      || categoryId <= 0
      || !name
      || name.length > 180
      || (
        category?.depth !== undefined
        && (!Number.isSafeInteger(depth) || depth < 0 || depth > 6)
      )
      || (sourceUrl && sourceUrl.length > 500)
      || (
        category?.productCount !== undefined
        && (
          !Number.isSafeInteger(productCount)
          || productCount < 0
          || productCount > 1_000_000
        )
      )
    ) {
      return null;
    }

    normalized.push({
      categoryId,
      name,
      ...(Number.isSafeInteger(depth) ? { depth } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(Number.isSafeInteger(productCount) ? { productCount } : {})
    });
  }

  return normalized;
}

function retailPathForHistory(path = retailBrowserState.path) {
  return normalizeRetailHistoryPath(path) ?? [];
}

function createAppRouteState(
  view,
  fromView = null,
  scrollY = 0,
  retailPath = retailBrowserState.path,
  retailerId = retailBrowserState.retailerId
) {
  const state = createRouteState(view, fromView, scrollY);

  if (publicRetailCatalogMode) {
    state.checkniRetailNavigation = true;
    state.checkniRetailPath = retailPathForHistory(retailPath);
    state.checkniRetailerId = validRetailerId(retailerId);
    state.checkniMagnitShopCode = selectedMagnitStore.shopCode;
  }

  return state;
}

function updateRetailHistory(path, {
  replace = false,
  retailerId = retailBrowserState.retailerId
} = {}) {
  if (!publicRetailCatalogMode || currentView !== VIEW.SHOP) return;

  const nextPath = retailPathForHistory(path);
  const nextState = {
    ...history.state,
    ...createAppRouteState(
      VIEW.SHOP,
      history.state?.checkniSurfaceFrom ?? null,
      window.scrollY,
      nextPath,
      retailerId
    )
  };

  if (replace) {
    history.replaceState(nextState, "", hashForView(VIEW.SHOP));
  } else {
    history.pushState(nextState, "", hashForView(VIEW.SHOP));
  }
}

function resetCatalogForRetailNavigation(categoryName = "") {
  catalogRequestVersion += 1;
  pendingCatalogSearch = null;
  activeQuery = "";
  elements.searchInput.value = "";
  elements.clearSearch.hidden = true;
  catalogSearchState = {
    status: "category",
    query: "",
    products: [],
    retailCount: 0,
    discoveredCount: 0,
    categoryName,
    categoryExpectedCount: 0,
    nextOffset: 0,
    canLoadMore: false,
    loadingMore: false,
    loadMoreError: false
  };
  renderCatalog();
}

function beginRetailNavigation(path, { clearCatalog = true } = {}) {
  const requestId = ++retailBrowserRequestVersion;
  const current = path.at(-1) ?? null;

  if (clearCatalog) {
    resetCatalogForRetailNavigation(current?.name ?? "");
  }

  retailBrowserState = {
    ...retailBrowserState,
    status: "loading",
    path,
    categories: []
  };
  renderRetailBrowser();

  return requestId;
}

async function selectRetailer(retailerId, {
  replaceHistory = false
} = {}) {
  const definition = retailDefinitionFor(retailerId);
  if (!publicRetailCatalogMode || !definition) return;

  retailBrowserRequestVersion += 1;
  catalogRequestVersion += 1;
  pendingCatalogSearch = null;
  activeQuery = "";
  elements.searchInput.value = "";
  elements.clearSearch.hidden = true;
  retailBrowserState = {
    retailerId,
    status: "idle",
    path: [],
    categories: [],
    rootProductCount: definition.defaultProductCount
  };
  updateRetailHistory([], { replace: replaceHistory, retailerId });
  renderRetailBrowser();

  await Promise.all([
    loadRetailRoots({ clearCatalog: false }),
    loadInitialRetailCatalog()
  ]);
}

async function loadRetailRoots({ clearCatalog = true } = {}) {
  if (!publicRetailCatalogMode) return;

  const retailerId = retailBrowserState.retailerId;
  const client = currentRetailClient();
  const requestId = beginRetailNavigation([], { clearCatalog });
  const result = await client.rootCategories();
  if (
    requestId !== retailBrowserRequestVersion
    || retailerId !== retailBrowserState.retailerId
  ) return;

  if (result.kind !== "categories") {
    retailBrowserState = {
      ...retailBrowserState,
      status: "error",
      path: [],
      categories: []
    };
    renderRetailBrowser();
    return;
  }

  const total = result.categories.reduce(
    (sum, category) => sum + category.productCount,
    0
  );
  retailBrowserState = {
    ...retailBrowserState,
    status: "ready",
    path: [],
    categories: result.categories,
    rootProductCount: total > 0 ? total : retailBrowserState.rootProductCount
  };
  renderRetailBrowser();
}

async function loadRetailChildren(category, path, {
  clearCatalog = true,
  scrollToProducts = true
} = {}) {
  if (!publicRetailCatalogMode || !category) return;

  const normalizedPath = normalizeRetailHistoryPath(path);
  if (!normalizedPath) return;

  const retailerId = retailBrowserState.retailerId;
  const client = currentRetailClient();
  const requestId = beginRetailNavigation(normalizedPath, { clearCatalog });
  const result = await client.subcategories(category.categoryId, {
    limit: 160
  });
  if (
    requestId !== retailBrowserRequestVersion
    || retailerId !== retailBrowserState.retailerId
  ) return;

  if (result.kind !== "categories") {
    retailBrowserState = {
      ...retailBrowserState,
      status: "error",
      path: normalizedPath,
      categories: []
    };
    renderRetailBrowser();
    return;
  }

  const hasChildren = result.categories.length > 0;
  retailBrowserState = {
    ...retailBrowserState,
    status: "ready",
    path: normalizedPath,
    categories: result.categories
  };
  renderRetailBrowser();
  await loadRetailCategoryProducts(category, {
    navigationRequestId: requestId,
    scrollToProducts: hasChildren ? false : scrollToProducts
  });
}

async function navigateRetailPath(path, {
  replaceHistory = false,
  scrollToProducts = true
} = {}) {
  if (!publicRetailCatalogMode) return;

  const normalizedPath = normalizeRetailHistoryPath(path);
  if (!normalizedPath) return;

  updateRetailHistory(normalizedPath, { replace: replaceHistory });

  if (normalizedPath.length === 0) {
    await loadRetailRoots();
    return;
  }

  const category = normalizedPath.at(-1);
  await loadRetailChildren(category, normalizedPath, {
    scrollToProducts
  });
}

async function openRetailCategory(category) {
  if (retailBrowserState.status === "loading") return;

  const nextPath = [...retailBrowserState.path, category];
  await navigateRetailPath(nextPath);
}

async function loadRetailCategoryProducts(category, {
  navigationRequestId = retailBrowserRequestVersion,
  scrollToProducts = true
} = {}) {
  if (
    !publicRetailCatalogMode
    || !category
    || navigationRequestId !== retailBrowserRequestVersion
  ) {
    return;
  }

  const retailerId = retailBrowserState.retailerId;
  const client = currentRetailClient();
  const requestId = ++catalogRequestVersion;
  const pageLimit = 40;
  pendingCatalogSearch = null;
  activeQuery = "";
  elements.searchInput.value = "";
  elements.clearSearch.hidden = true;
  catalogSearchState = {
    status: "loading",
    query: "",
    products: [],
    retailCount: 0,
    discoveredCount: 0,
    categoryName: category.name,
    categoryExpectedCount:
      Number.isSafeInteger(category.productCount) && category.productCount >= 0
        ? category.productCount
        : 0,
    nextOffset: 0,
    canLoadMore: false,
    loadingMore: false,
    loadMoreError: false
  };
  renderCatalog();

  const result = await client.browseCategory(category, {
    limit: pageLimit,
    offset: 0
  });
  if (
    requestId !== catalogRequestVersion
    || navigationRequestId !== retailBrowserRequestVersion
    || retailerId !== retailBrowserState.retailerId
  ) {
    return;
  }

  if (result.kind === "catalog") {
    const nextOffset = Number.isSafeInteger(result.nextOffset)
      ? result.nextOffset
      : result.products.length;
    const pageSize = Number.isSafeInteger(result.pageSize)
      ? result.pageSize
      : result.products.length;
    const expectedCount =
      Number.isSafeInteger(category.productCount) && category.productCount >= 0
        ? category.productCount
        : result.products.length;

    catalogSearchState = {
      status: "live",
      query: "",
      products: result.products,
      retailCount: result.products.length,
      discoveredCount: result.products.length,
      categoryName: category.name,
      categoryExpectedCount: expectedCount,
      nextOffset,
      canLoadMore: pageSize === pageLimit && (
        expectedCount <= 0 || nextOffset < expectedCount
      ),
      loadingMore: false,
      loadMoreError: false
    };
  } else {
    catalogSearchState = {
      status: "fallback",
      query: "",
      products: [],
      retailCount: 0,
      discoveredCount: 0,
      categoryName: category.name,
      categoryExpectedCount: 0,
      nextOffset: 0,
      canLoadMore: false,
      loadingMore: false,
      loadMoreError: false
    };
  }
  renderCatalog();

  if (scrollToProducts) {
    document.querySelector(".catalog-section")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

async function loadMoreRetailCategoryProducts() {
  if (
    !publicRetailCatalogMode
    || catalogSearchState.status !== "live"
    || !catalogSearchState.categoryName
    || !catalogSearchState.canLoadMore
    || catalogSearchState.loadingMore
  ) {
    return;
  }

  const category = retailBrowserState.path.at(-1);
  if (!category) return;

  const retailerId = retailBrowserState.retailerId;
  const navigationRequestId = retailBrowserRequestVersion;
  const client = currentRetailClient();
  const requestId = ++catalogRequestVersion;
  const pageLimit = 40;
  const offset = Number.isSafeInteger(catalogSearchState.nextOffset)
    ? catalogSearchState.nextOffset
    : catalogSearchState.products.length;

  catalogSearchState = {
    ...catalogSearchState,
    loadingMore: true,
    loadMoreError: false
  };
  renderCatalog();

  const result = await client.browseCategory(category, {
    limit: pageLimit,
    offset
  });

  if (
    requestId !== catalogRequestVersion
    || navigationRequestId !== retailBrowserRequestVersion
    || retailerId !== retailBrowserState.retailerId
  ) {
    return;
  }

  if (result.kind !== "catalog") {
    catalogSearchState = {
      ...catalogSearchState,
      loadingMore: false,
      loadMoreError: true
    };
    renderCatalog();
    return;
  }

  const byId = new Map(
    catalogSearchState.products.map((product) => [product.id, product])
  );
  for (const product of result.products) {
    byId.set(product.id, product);
  }
  const products = Object.freeze(Array.from(byId.values()));
  const nextOffset = Number.isSafeInteger(result.nextOffset)
    ? result.nextOffset
    : offset + result.products.length;
  const pageSize = Number.isSafeInteger(result.pageSize)
    ? result.pageSize
    : result.products.length;
  const expectedCount = Number.isSafeInteger(
    catalogSearchState.categoryExpectedCount
  )
    ? catalogSearchState.categoryExpectedCount
    : products.length;

  catalogSearchState = {
    ...catalogSearchState,
    products,
    retailCount: products.length,
    discoveredCount: products.length,
    nextOffset,
    canLoadMore: pageSize === pageLimit && (
      expectedCount <= 0 || nextOffset < expectedCount
    ),
    loadingMore: false,
    loadMoreError: false
  };
  renderCatalog();
}

function restoreRetailNavigationFromHistory({ initial = false } = {}) {
  const restoredStore = resolveMagnitMoscowStore({
    shopCode: history.state?.checkniMagnitShopCode
  });
  const addressChanged = Boolean(restoredStore && restoredStore.shopCode !== selectedMagnitStore.shopCode);
  if (restoredStore) selectedMagnitStore = restoredStore;
  const retailerId = validRetailerId(history.state?.checkniRetailerId);
  const restoredPath = normalizeRetailHistoryPath(
    history.state?.checkniRetailPath
  ) ?? [];
  const definition = retailDefinitionFor(retailerId);

  if (!definition) return;

  if (retailerId !== retailBrowserState.retailerId || addressChanged) {
    retailBrowserRequestVersion += 1;
    catalogRequestVersion += 1;
    pendingCatalogSearch = null;
    retailBrowserState = {
      retailerId,
      status: "idle",
      path: [],
      categories: [],
      rootProductCount: definition.defaultProductCount
    };
  }

  if (restoredPath.length === 0) {
    void Promise.all([
      loadRetailRoots({ clearCatalog: false }),
      loadInitialRetailCatalog()
    ]);
    return;
  }

  void loadRetailChildren(restoredPath.at(-1), restoredPath, {
    clearCatalog: true,
    scrollToProducts: false
  });
}

function setupRetailBrowser() {
  if (publicRetailCatalogMode && elements.retailCatalogNav) {
    magnitStorePicker = createMagnitStorePicker({
      shopCode: selectedMagnitStore.shopCode,
      onSelect: (store) => {
        selectedMagnitStore = store;
        void selectRetailer("magnit");
      }
    });
    elements.retailCatalogNav.before(magnitStorePicker.element);
  }
  renderRetailBrowser();
  if (!publicRetailCatalogMode) return;

  elements.retailStoreGrid?.after(createOkeyStoreDirectory());
  elements.retailStoreGrid?.after(createOkeyDeliveryCatalog());
  elements.retailCategoryBack?.addEventListener("click", () => {
    if (retailBrowserState.path.length === 0) return;
    history.back();
  });

  restoreRetailNavigationFromHistory({ initial: true });
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
  document.querySelector("#retail-load-more")?.remove();
  const normalizedQuery = activeQuery.trim();
  const retailDefinition = currentRetailDefinition();
  const retailName = retailDefinition?.displayName ?? "магазина";
  const loading = catalogSearchState.status === "loading";
  const live = (
    catalogSearchState.status === "live"
    && catalogSearchState.query === normalizedQuery
  );
  const fallback = (
    catalogSearchState.status === "fallback"
    && catalogSearchState.query === normalizedQuery
  );
  const categoryBrowsing = (
    publicRetailCatalogMode
    && catalogSearchState.status === "category"
  );

  const results = live
    ? catalogSearchState.products
    : loading
      ? []
      : publicRetailCatalogMode
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

  if (
    live
    && catalogSearchState.categoryName
    && (
      catalogSearchState.canLoadMore
      || catalogSearchState.loadingMore
      || catalogSearchState.loadMoreError
    )
  ) {
    const loadMore = document.createElement("button");
    loadMore.id = "retail-load-more";
    loadMore.type = "button";
    loadMore.className = "add-button retail-load-more";
    loadMore.disabled = catalogSearchState.loadingMore;
    loadMore.textContent = catalogSearchState.loadingMore
      ? "Загружаем ещё…"
      : catalogSearchState.loadMoreError
        ? "Повторить загрузку"
        : "Показать ещё";
    loadMore.setAttribute(
      "aria-label",
      `${loadMore.textContent}: ${catalogSearchState.categoryName}`
    );
    loadMore.addEventListener("click", () => {
      void loadMoreRetailCategoryProducts();
    });
    elements.productGrid.after(loadMore);
  }

  if (loading) {
    elements.catalogEyebrow.textContent = "Живой каталог";
    elements.catalogNote.textContent = normalizedQuery
      ? "Ищем реальные товары…"
      : `Загружаем реальные товары ${retailName}…`;
  } else if (live) {
    const categoryResult = Boolean(catalogSearchState.categoryName);
    elements.catalogEyebrow.textContent = categoryResult
      ? `Живой каталог · ${retailName}`
      : catalogSearchState.retailCount > 0
        ? normalizedQuery
          ? `Живой каталог · ${retailName} + Open Food Facts`
          : `Живой каталог · ${retailName}`
        : "Живой каталог · Open Food Facts";
    elements.catalogNote.textContent = categoryResult
      ? catalogSearchState.retailCount > 0
        ? `${catalogSearchState.categoryName}: реальные товары ${retailName} с наблюдаемыми ценами.`
        : `${catalogSearchState.categoryName}: в этом разделе сейчас нет товаров.`
      : catalogSearchState.retailCount > 0
        ? normalizedQuery
          ? `Цена ${retailName} показана с источником и временем наблюдения. Наличие остаётся неизвестным; карточку можно сравнивать только после подтверждения общей товарной идентичности.`
          : `Реальные товары ${retailName}: фото, наблюдаемая цена, источник и время проверки. Наличие не выдумываем.`
        : "Каталог помогает идентифицировать товар. Он не подтверждает цену или наличие в магазине.";
  } else if (fallback) {
    elements.catalogEyebrow.textContent = publicRetailCatalogMode
      ? "Живой каталог недоступен"
      : "Демо-каталог";
    elements.catalogNote.textContent = publicRetailCatalogMode
      ? `Не удалось загрузить каталог ${retailName}. Тестовые товары не подставляем.`
      : "Live-каталог временно недоступен. Показан DEMO · MOCK fallback.";
  } else {
    elements.catalogEyebrow.textContent = publicRetailCatalogMode
      ? `Живой каталог · ${retailName}`
      : "Демо-каталог";
    elements.catalogNote.textContent = publicRetailCatalogMode
      ? categoryBrowsing
        ? catalogSearchState.categoryName
          ? `${catalogSearchState.categoryName}: выберите подкатегорию — товары появятся после конечного раздела.`
          : `Выберите категорию ${retailName} — товары появятся после конечного раздела.`
        : normalizedQuery
          ? `Нажмите Enter, чтобы искать реальные товары ${retailName}.`
          : `Загружаем реальные товары ${retailName} с наблюдаемыми ценами.`
      : normalizedQuery
        ? "Нажмите Enter, чтобы искать в живом каталоге. Пока показаны демо-подсказки."
        : "Тестовые позиции для резервного режима.";
  }

  const hasResults = results.length > 0;
  elements.productGrid.hidden = !hasResults;
  elements.emptySearch.hidden = loading || hasResults || categoryBrowsing;
  elements.resultCount.textContent = loading
    ? "…"
    : categoryBrowsing
      ? "—"
      : String(results.length);

  if (loading) {
    elements.searchStatus.textContent = "Ищем товары в живом каталоге";
    return;
  }

  if (categoryBrowsing) {
    elements.searchStatus.textContent = "Выберите конечную категорию";
    return;
  }

  if (live && !hasResults) {
    if (catalogSearchState.categoryName) {
      elements.emptySearchCopy.textContent =
        `В этой категории ${retailName} сейчас нет товаров.`;
      elements.searchStatus.textContent = "В категории нет товаров";
      return;
    }

    elements.emptySearchCopy.textContent = catalogSearchState.discoveredCount > 0
      ? "Нашлись позиции, но без подтверждённого штрихкода и размера упаковки. Попробуйте уточнить запрос."
      : "В живом каталоге по этому запросу ничего не найдено.";
    elements.searchStatus.textContent = "Подтверждённых товаров не найдено";
    return;
  }

  elements.emptySearchCopy.textContent = fallback
    ? "Живой каталог сейчас не загрузился. Попробуйте ещё раз."
    : "Попробуйте более короткий запрос — например «сыр» или «хлеб».";
  elements.searchStatus.textContent = hasResults
    ? (
        live
        && catalogSearchState.categoryName
        && Number.isSafeInteger(catalogSearchState.categoryExpectedCount)
        && catalogSearchState.categoryExpectedCount > results.length
      )
      ? `Показано товаров: ${results.length} из ${catalogSearchState.categoryExpectedCount}`
      : `Найдено товаров: ${results.length}`
    : fallback
      ? "Живой каталог временно недоступен"
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
  setMascotState(mascotStateForHybrid(state.status));
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
    } else if (triggerReason === "ambiguous_segment") {
      appendProposalAction(
        view?.primaryAction || "Уточнить товар",
        focusProposalInput
      );
      appendProposalAction(
        view?.secondaryAction || "Искать вручную",
        () => {
          invalidateHybridForManualTakeover();
          elements.searchInput.focus({ preventScroll: true });
          elements.searchInput.scrollIntoView({
            block: "center",
            behavior: "auto"
          });
        },
        { secondary: true }
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
  setMascotState(mascotStateForComparison(state));
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
    history.replaceState(createAppRouteState(view), "", hash);
  } else if (location.hash !== hash) {
    history.replaceState(
      createAppRouteState(
        previousView,
        history.state?.checkniSurfaceFrom ?? null,
        window.scrollY
      ),
      ""
    );
    history.pushState(createAppRouteState(view, previousView), "", hash);
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
    status: publicRetailCatalogMode ? "idle" : "demo",
    query: activeQuery.trim(),
    products: [],
    retailCount: 0,
    discoveredCount: 0
  };
  renderCatalog();
}

function handleManualSearch() {
  activeQuery = elements.searchInput.value.trim();
  elements.clearSearch.hidden = activeQuery.length === 0;

  if (!activeQuery) {
    if (publicRetailCatalogMode) {
      return loadInitialRetailCatalog();
    }
    catalogRequestVersion += 1;
    pendingCatalogSearch = null;
    catalogSearchState = {
      status: "demo",
      query: "",
      products: [],
      retailCount: 0,
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
      const [catalogResult, retailResult] = await Promise.all([
        requestCatalogSearch([query], { limitPerQuery: 8 }),
        currentRetailClient().search(query, { limit: 24 })
      ]);
      if (requestId !== catalogRequestVersion) return;

      if (
        catalogResult.kind === "catalog"
        || retailResult.kind === "catalog"
      ) {
        const canonicalProducts = catalogResult.kind === "catalog"
          ? surfaceProductsFromCatalog(catalogResult.products)
          : [];
        const retailProducts = retailResult.kind === "catalog"
          ? retailResult.products
          : [];
        catalogSearchState = {
          status: "live",
          query,
          products: [...retailProducts, ...canonicalProducts],
          retailCount: retailProducts.length,
          discoveredCount:
            (catalogResult.products?.length ?? 0)
            + (catalogResult.rejectedCount ?? 0)
            + retailProducts.length
        };
      } else {
        catalogSearchState = {
          status: "fallback",
          query,
          products: [],
          retailCount: 0,
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

async function loadInitialRetailCatalog() {
  if (!publicRetailCatalogMode) {
    renderCatalog();
    return;
  }

  const requestId = ++catalogRequestVersion;
  pendingCatalogSearch = null;
  activeQuery = "";
  catalogSearchState = {
    status: "loading",
    query: "",
    products: [],
    retailCount: 0,
    discoveredCount: 0
  };
  renderCatalog();

  const retailerId = retailBrowserState.retailerId;
  const retailResult = await currentRetailClient().browse({ limit: 24 });
  if (
    requestId !== catalogRequestVersion
    || retailerId !== retailBrowserState.retailerId
  ) return;

  if (retailResult.kind === "catalog") {
    catalogSearchState = {
      status: "live",
      query: "",
      products: retailResult.products,
      retailCount: retailResult.products.length,
      discoveredCount: retailResult.products.length
    };
  } else {
    catalogSearchState = {
      status: "fallback",
      query: "",
      products: [],
      retailCount: 0,
      discoveredCount: 0
    };
  }
  renderCatalog();
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
    status: publicRetailCatalogMode ? "loading" : "demo",
    query: "",
    products: [],
    retailCount: 0,
    discoveredCount: 0
  };
  elements.clearSearch.hidden = true;
  if (publicRetailCatalogMode) {
    void loadInitialRetailCatalog();
  } else {
    renderCatalog();
  }
  elements.searchInput.focus();
});

elements.brandHome.addEventListener("click", (event) => {
  event.preventDefault();
  returnToShop();
});
elements.openBasket.addEventListener("click", () => navigate(VIEW.BASKET));
elements.backToShop.addEventListener("click", returnToShop);

window.addEventListener("popstate", () => {
  const previousView = currentView;
  currentView = viewFromHash(location.hash);
  renderView({
    focusMode: FOCUS_MODE.HEADING,
    scrollY: scrollYFromState(history.state)
  });

  if (
    publicRetailCatalogMode
    && previousView === VIEW.SHOP
    && currentView === VIEW.SHOP
  ) {
    restoreRetailNavigationFromHistory();
  }
});

basket.subscribe(() => {
  comparisonFlow.invalidate();
  renderCatalog();
  renderBasket();
  renderDock();
  renderBetaLiveSection();
});

const restoredRetailPath = publicRetailCatalogMode
  ? normalizeRetailHistoryPath(history.state?.checkniRetailPath)
  : null;
const restoredRetailerId = publicRetailCatalogMode
  ? validRetailerId(history.state?.checkniRetailerId)
  : DEFAULT_RETAILER_ID;

history.replaceState(
  createAppRouteState(
    currentView,
    history.state?.checkniSurfaceFrom ?? null,
    window.scrollY,
    restoredRetailPath ?? retailBrowserState.path,
    restoredRetailerId
  ),
  "",
  hashForView(currentView)
);

if (!publicRetailCatalogMode) {
  renderCatalog();
}
renderBasket();
renderHomeExample();
setupCatalogSort();
setupSkyControls();
setupRetailBrowser();
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

