import {
  PROPOSAL_STATUS,
  validateBasketProposal
} from "../core/ai-basket-proposal.mjs";
import {
  LOCAL_BASKET_DECISION,
  parseLocalBasketText
} from "./localBasketParser.mjs";
import { extractCatalogQueries } from "../runtime/catalogQueries.mjs";
import { shoppingTargets } from "./shoppingConversation.mjs";

// These seed descriptors contain defaults the shopper did not necessarily
// request (C1, white rice, wheat bread, semi-hard cheese). Discovery searches
// the family; retail selection still checks every explicit query token against
// the source card before offering it. Commercial/price requests keep identity.
const SEED_DISCOVERY_QUERIES = Object.freeze({
  "eggs-c1-10": "Яйца", "butter-825-180": "Масло", "rice-900": "Рис",
  "bread-wheat-400": "Хлеб", "cheese-semi-hard-200": "Сыр"
});
const TARGET_DISCOVERY_QUERIES = Object.freeze({ eggs: "Яйца" });
const SELECTION_DISCOVERY_QUERIES = Object.freeze({ milk: "Молоко", kefir: "Кефир", eggs: "Яйца", bread: "Хлеб",
  cheese: "Сыр", butter: "Масло", rice: "Рис", pasta: "Макароны", tomatoes: "Томаты", apples: "Яблоки" });
import { stripShoppingRequestPrefix } from "./shoppingRequestText.mjs";
import { preflightLocalBasketText } from "./localBasketPreflight.mjs";

export const SHOPPING_ASSISTANT_TOOL = Object.freeze({
  SEARCH_CATALOG: "searchCatalog",
  SEARCH_RETAILER: "searchRetailer",
  GET_OBSERVED_PRICES: "getObservedPrices",
  GET_PRODUCT_DETAILS: "getProductDetails",
  COMPARE_BASKET: "compareBasket",
  GET_ALTERNATIVES: "getAlternatives"
});

export const COMMERCIAL_ASSISTANT_RESULT_KIND = "commercial-assistant-result";
export const MAX_COMMERCIAL_RETAIL_PRODUCTS = 5;
export const MAX_COMMERCIAL_CATALOG_PRODUCTS = 5;

const RETAILER_PATTERNS = Object.freeze([
  Object.freeze({ id: "chizhik", pattern: /(?:^|\s)чижик[а-я]*(?=$|\s|[,.;!?])/iu }),
  Object.freeze({ id: "pyaterochka", pattern: /(?:^|\s)пят[её]рочк[а-я]*(?=$|\s|[,.;!?])/iu }),
  Object.freeze({ id: "okey", pattern: /(?:^|\s)(?:окей|о['’]?кей)(?=$|\s|[,.;!?])/iu }),
  Object.freeze({ id: "magnit", pattern: /(?:^|\s)(?:магнит[а-я]*)(?=$|\s|[,.;!?])/iu }),
  Object.freeze({ id: "globus", pattern: /(?:^|\s)(?:глобус[а-я]*)(?=$|\s|[,.;!?])/iu }),
  Object.freeze({ id: "vkusvill", pattern: /(?:^|\s)(?:вкусвилл[а-я]*)(?=$|\s|[,.;!?])/iu }),
  Object.freeze({ id: "lenta", pattern: /(?:^|\s)(?:лент[а-я]*)(?=$|\s|[,.;!?])/iu }),
  Object.freeze({ id: "perekrestok", pattern: /(?:^|\s)(?:перекр[её]ст[а-я]*)(?=$|\s|[,.;!?])/iu }),
  Object.freeze({ id: "auchan", pattern: /(?:^|\s)(?:ашан[а-я]*)(?=$|\s|[,.;!?])/iu }),
  Object.freeze({ id: "metro", pattern: /(?:^|\s)(?:metro|метро)(?=$|\s|[,.;!?])/iu })
]);

const COMMERCIAL_NOISE_PATTERNS = Object.freeze([
  /(?:^|\s)сам(?:ое|ую|ый|ые)?\s+деш[её]в[а-я]*(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)(?:подешевле|дешевле|деш[её]в(?:ый|ая|ое|ые|ую|ого|ых)?)(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)(?:точно\s+)?(?:есть|имеется)\s+в\s+налич[а-я]*(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)в\s+налич[а-я]*(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)(?:цена|цену|цены|стоимость|скидк[а-я]*|акци[а-я]*|экономи[а-я]*|выгодн[а-я]*)(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)(?:победител[а-я]*|winner|сбережен[а-я]*)(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)где\s+(?:дешевле|выгоднее)(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)(?:где|поч[её]м|сколько\s+стоит)(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)(?:в|из)\s+магазин(?:е|а|у|ом)?\s+[a-zа-я0-9-]+(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)(?:магазин(?:е|а|у|ом)?|ритейлер(?:е|а|у|ом)?|retailer)\s+[a-zа-я0-9-]+(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)(?:в|из)\s+(?:пят[её]рочк[а-я]*|магнит[а-я]*|перекр[её]ст[а-я]*|лент[а-я]*|ашан[а-я]*|вкусвилл[а-я]*|metro|метро|ozon|озон|яндекс(?:\s+маркет)?)(?=$|\s|[,.;!?])/giu,
  /(?:^|\s)(?:в|из)\s+(?:чижик[а-я]*|глобус[а-я]*|окей|о['’]?кей)(?=$|\s|[,.;!?])/giu
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, max = 300) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function freezeArray(value) {
  return Object.freeze(Array.isArray(value) ? value : []);
}

function toolFailure(tool, code = "tool_unavailable") {
  return Object.freeze({
    tool,
    status: "unavailable",
    code
  });
}

function toolSuccess(tool, details = {}) {
  return Object.freeze({
    tool,
    status: "ok",
    ...details
  });
}

export function detectRetailerId(text) {
  const normalized = cleanText(text).toLocaleLowerCase("ru-RU");
  if (!normalized) return null;

  const matched = RETAILER_PATTERNS.filter(({ pattern }) => pattern.test(normalized));
  return matched.length === 1 ? matched[0].id : null;
}

export function stripCommercialLanguage(text) {
  let normalized = cleanText(text);
  for (const pattern of COMMERCIAL_NOISE_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }

  return normalized
    .replace(/[,:;!?]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function currentBasketRequested(text) {
  return /(?:^|\s)(?:мо[юя]|эту|текущ[а-я]*)?\s*корзин[а-я]*(?=$|\s|[,.;!?])/iu
    .test(cleanText(text));
}

function toSurfaceBasket(validation) {
  if (validation?.status !== PROPOSAL_STATUS.ACCEPTED) return [];

  return validation.basket.map((row) => Object.freeze({
    id: row.product.id,
    name: row.product.name,
    unit: row.product.unit,
    quantity: row.quantity
  }));
}

function normalizeCurrentBasket(value) {
  if (!Array.isArray(value) || value.length === 0) return [];

  const seen = new Set();
  const out = [];
  for (const row of value) {
    if (
      !isRecord(row)
      || typeof row.id !== "string"
      || !row.id
      || typeof row.name !== "string"
      || !row.name
      || typeof row.unit !== "string"
      || !row.unit
      || !Number.isSafeInteger(row.quantity)
      || row.quantity < 1
      || row.quantity > 99
      || seen.has(row.id)
    ) {
      return [];
    }
    seen.add(row.id);
    out.push(Object.freeze({
      id: row.id,
      name: row.name,
      unit: row.unit,
      quantity: row.quantity
    }));
  }
  return Object.freeze(out);
}

function normalizeRetailProduct(product) {
  if (
    !isRecord(product)
    || typeof product.name !== "string"
    || !product.name.trim()
    || !Number.isSafeInteger(product.priceMinor)
    || product.priceMinor <= 0
    || product.currency !== "RUB"
    || product.availability !== "unknown"
    || typeof product.retailerId !== "string"
  ) {
    return null;
  }

  return Object.freeze({
    id: typeof product.id === "string" ? product.id : null,
    name: product.name.trim(),
    unit: typeof product.unit === "string" ? product.unit : null,
    retailerId: product.retailerId,
    retailerDisplayName:
      typeof product.retailerDisplayName === "string"
        ? product.retailerDisplayName
        : product.retailerId,
    storeName: typeof product.storeName === "string"
      ? product.storeName
      : null,
    priceMinor: product.priceMinor,
    currency: "RUB",
    priceConditionLabel:
      typeof product.priceConditionLabel === "string"
        ? product.priceConditionLabel
        : null,
    availability: "unknown",
    observedAt: typeof product.observedAt === "string"
      ? product.observedAt
      : null,
    sourceUrl: typeof product.sourceUrl === "string"
      ? product.sourceUrl
      : null,
    ...(typeof product.sourceProductId === "string" ? { sourceProductId: product.sourceProductId } : {}),
    ...(typeof product.productUrl === "string" ? { productUrl: product.productUrl } : {}),
    ...(typeof product.imageUrl === "string" ? { imageUrl: product.imageUrl } : {})
  });
}

function normalizeCatalogProduct(product) {
  if (
    !isRecord(product)
    || typeof product.canonicalProductId !== "string"
    || !product.canonicalProductId
    || product.comparisonEligible !== true
    || !isRecord(product.canonicalIdentity)
    || product.canonicalIdentity.id !== product.canonicalProductId
  ) {
    return null;
  }

  const identity = product.canonicalIdentity;
  if (
    typeof identity.name !== "string"
    || !identity.name
    || typeof identity.unit !== "string"
    || !identity.unit
  ) {
    return null;
  }

  return Object.freeze({
    id: identity.id,
    name: identity.name,
    unit: identity.unit,
    sourceId: typeof product.sourceId === "string"
      ? product.sourceId
      : null,
    sourceProductId: typeof product.sourceProductId === "string"
      ? product.sourceProductId
      : null,
    sourceUrl: typeof product.sourceUrl === "string"
      ? product.sourceUrl
      : null
  });
}

function normalizeComparison(value) {
  if (
    !isRecord(value)
    || value.kind !== "observed-price-comparison"
    || !isRecord(value.conclusion)
    || typeof value.conclusion.kind !== "string"
    || !Array.isArray(value.candidates)
  ) {
    return null;
  }

  return value;
}

function retailerObservationFromComparison(comparison, retailerId, storeId = null) {
  if (!comparison || typeof retailerId !== "string") return null;

  const candidates = comparison.candidates.filter((candidate) => (
    isRecord(candidate)
    && candidate.retailerId === retailerId
    && (storeId === null || candidate.storeId === storeId)
    && candidate.completePriceCoverage === true
    && candidate.completeComparisonReadyCoverage === true
    && Number.isSafeInteger(candidate.totalMinor)
    && candidate.totalMinor > 0
  ));

  if (candidates.length !== 1) return null;
  const candidate = candidates[0];

  return Object.freeze({
    candidateId: typeof candidate.candidateId === "string"
      ? candidate.candidateId
      : null,
    candidateName: typeof candidate.candidateName === "string"
      ? candidate.candidateName
      : retailerId,
    retailerId,
    retailerName: typeof candidate.retailerName === "string"
      ? candidate.retailerName
      : retailerId,
    storeId: typeof candidate.storeId === "string"
      ? candidate.storeId
      : null,
    storeName: typeof candidate.storeName === "string"
      ? candidate.storeName
      : null,
    locationLabel: typeof candidate.locationLabel === "string"
      ? candidate.locationLabel
      : null,
    totalMinor: candidate.totalMinor,
    currency: "RUB",
    availability: "unknown",
    priceCoverage: candidate.priceCoverage ?? null,
    comparisonReadyCoverage: candidate.comparisonReadyCoverage ?? null
  });
}

function normalizeToolResult(value, tool) {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return Object.freeze({
      trace: toolFailure(tool, "malformed_tool_result"),
      value: null
    });
  }

  if (value.kind === "unavailable" || value.kind === "error") {
    return Object.freeze({
      trace: toolFailure(
        tool,
        typeof value.code === "string" ? value.code : value.kind
      ),
      value: null
    });
  }

  return Object.freeze({
    trace: toolSuccess(tool),
    value
  });
}

function safeToolCall(tool, fn, ...args) {
  if (typeof fn !== "function") {
    return Promise.resolve(Object.freeze({
      trace: toolFailure(tool, "tool_unconfigured"),
      value: null
    }));
  }

  return Promise.resolve()
    .then(() => fn(...args))
    .then((value) => normalizeToolResult(value, tool))
    .catch(() => Object.freeze({
      trace: toolFailure(tool, "tool_exception"),
      value: null
    }));
}

export function createShoppingAssistantOrchestrator(options = {}) {
  const tools = Object.freeze({
    searchCatalog: options.searchCatalog ?? null,
    searchRetailer: options.searchRetailer ?? null,
    getObservedPrices: options.getObservedPrices ?? null,
    getProductDetails: options.getProductDetails ?? null,
    compareBasket: options.compareBasket ?? null,
    getAlternatives: options.getAlternatives ?? null
  });
  const getCurrentBasket = options.getCurrentBasket ?? null;
  const getRetailerContext = options.getRetailerContext ?? null;

  for (const [name, fn] of Object.entries(tools)) {
    if (fn !== null && typeof fn !== "function") {
      throw new TypeError(`shopping assistant tool ${name} must be a function`);
    }
  }
  if (getCurrentBasket !== null && typeof getCurrentBasket !== "function") {
    throw new TypeError("shopping assistant current basket reader must be a function");
  }
  if (getRetailerContext !== null && typeof getRetailerContext !== "function") {
    throw new TypeError("shopping assistant retailer context reader must be a function");
  }

  async function runTool(name, ...args) {
    if (!Object.values(SHOPPING_ASSISTANT_TOOL).includes(name)) {
      return Object.freeze({
        trace: toolFailure(name, "unknown_tool"),
        value: null
      });
    }
    return safeToolCall(name, tools[name], ...args);
  }

  async function resolveCommercialRequest(text, catalogSnapshot, context = {}) {
    if (!Array.isArray(catalogSnapshot) || catalogSnapshot.length === 0) {
      return null;
    }

    const selectionOnly = preflightLocalBasketText(text).kind === "pass" && stripShoppingRequestPrefix(text) !== cleanText(text);
    const retailerId = detectRetailerId(text) ?? detectRetailerId(context?.retailer);
    let retailerContext = null;
    if (retailerId && getRetailerContext) {
      try {
        const value = getRetailerContext(retailerId);
        if (value?.retailerId === retailerId && typeof value.storeId === "string" && value.storeId) {
          retailerContext = Object.freeze({ storeId: value.storeId, storeName: cleanText(value.storeName, 160),
            ...(typeof value.shopCode === "string" && /^\d{4,12}$/u.test(value.shopCode) ? { shopCode: value.shopCode } : {}) });
        }
      } catch { /* A failed context lookup cannot authorize a regional price. */ }
    }
    const identityText = stripCommercialLanguage(text);
    const trace = [];
    let basket = [];

    if (identityText) {
      const parsed = parseLocalBasketText(identityText, catalogSnapshot);
      if (parsed.kind === LOCAL_BASKET_DECISION.LOCAL) {
        const validation = validateBasketProposal(parsed.proposal, {
          catalog: catalogSnapshot
        });
        basket = toSurfaceBasket(validation);
      }
    }

    if (
      basket.length === 0
      && currentBasketRequested(text)
      && typeof getCurrentBasket === "function"
    ) {
      try {
        basket = normalizeCurrentBasket(getCurrentBasket());
      } catch {
        basket = [];
      }
    }

    let comparison = null;
    if (basket.length > 0 && !retailerId && !selectionOnly) {
      const compared = await runTool(
        SHOPPING_ASSISTANT_TOOL.COMPARE_BASKET,
        basket
      );
      trace.push(compared.trace);
      comparison = normalizeComparison(compared.value);
      if (compared.value !== null && comparison === null) {
        trace.push(toolFailure(
          SHOPPING_ASSISTANT_TOOL.COMPARE_BASKET,
          "malformed_comparison"
        ));
      }
    }

    let retailerObservation = null;
    if (retailerId && basket.length > 0 && !selectionOnly && (!getRetailerContext || retailerContext)) {
      const observed = await runTool(
        SHOPPING_ASSISTANT_TOOL.GET_OBSERVED_PRICES,
        basket
      );
      trace.push(observed.trace);
      const observedComparison = normalizeComparison(observed.value);
      retailerObservation = retailerObservationFromComparison(
        observedComparison,
        retailerId,
        retailerContext?.storeId ?? null
      );
      if (getRetailerContext && retailerContext === null) retailerObservation = null;
    }

    let retailProducts = [];
    if (retailerId && identityText && retailerObservation === null) {
      const singleDiscovery = selectionOnly && extractCatalogQueries(identityText).length === 1;
      const targets = singleDiscovery ? shoppingTargets(identityText) : [];
      const discoveryFamily = singleDiscovery
        ? (basket.length === 1 ? SEED_DISCOVERY_QUERIES[basket[0].id] : null)
          ?? (targets.length === 1 ? TARGET_DISCOVERY_QUERIES[targets[0]] : null)
          ?? (context.selectionDiscovery === true && targets.length === 1 ? SELECTION_DISCOVERY_QUERIES[targets[0]] : null)
        : null;
      const retailerQuery = discoveryFamily ?? (basket.length === 1
        // Generic canonical labels contain pack/fat hints that are not a
        // contiguous substring of branded retailer names. These are variants,
        // never an identity substitution or a comparable basket price.
        ? basket[0].name.replace(/\d+(?:[.,]\d+)?\s*%/gu, "").replace(/\s+/gu, " ").trim()
        : selectionOnly ? extractCatalogQueries(identityText)[0] ?? identityText : identityText);
      const searched = await runTool(
        SHOPPING_ASSISTANT_TOOL.SEARCH_RETAILER,
        retailerId,
        retailerQuery,
        { limit: MAX_COMMERCIAL_RETAIL_PRODUCTS }
      );
      trace.push(searched.trace);

      if (searched.value?.kind === "catalog" && Array.isArray(searched.value.products)) {
        retailProducts = searched.value.products
          .map(normalizeRetailProduct)
          .filter(product => product && product.retailerId === retailerId)
          .slice(0, MAX_COMMERCIAL_RETAIL_PRODUCTS);
      }
    }

    let catalogProducts = [];
    if (basket.length === 0 && identityText && !selectionOnly) {
      const queries = extractCatalogQueries(identityText);
      if (queries.length > 0) {
        const searched = await runTool(
          SHOPPING_ASSISTANT_TOOL.SEARCH_CATALOG,
          queries,
          { limitPerQuery: 8 }
        );
        trace.push(searched.trace);

        if (searched.value?.kind === "catalog" && Array.isArray(searched.value.products)) {
          catalogProducts = searched.value.products
            .map(normalizeCatalogProduct)
            .filter(Boolean)
            .slice(0, MAX_COMMERCIAL_CATALOG_PRODUCTS);
        }
      }
    }

    const result = Object.freeze({
      kind: COMMERCIAL_ASSISTANT_RESULT_KIND,
      retailerId,
      retailerContext,
      identityText,
      basket: freezeArray(basket),
      comparison,
      retailerObservation,
      retailProducts: freezeArray(retailProducts),
      catalogProducts: freezeArray(catalogProducts),
      toolTrace: freezeArray(trace)
    });

    return result;
  }

  return Object.freeze({
    toolNames: Object.freeze(Object.values(SHOPPING_ASSISTANT_TOOL)),
    runTool,
    resolveCommercialRequest
  });
}
