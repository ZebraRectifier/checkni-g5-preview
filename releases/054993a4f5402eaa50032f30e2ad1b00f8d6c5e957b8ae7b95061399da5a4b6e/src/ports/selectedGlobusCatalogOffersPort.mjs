import { createRetailCatalogClient } from "./retailCatalogPort.mjs";
import {
  getReviewedRetailBasketProduct,
  getReviewedRetailSourceProductIds
} from "../catalog/reviewedRetailBasket.mjs";
import { resolveGlobusMoscowRegionStore } from "../data/globusMoscowRegionStores.mjs";
import { createObservedOffer } from "../observations/observedOffer.mjs";
import { selectStoreScopedOffers } from "../observations/selectedStoreScope.mjs";
import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sensors/sourceDescriptor.mjs";

// CHECKNI's conservative age policy for a recent public physical-store
// observation. This is not a retailer guarantee of price lifetime, stock or
// checkout, and it is independent of importer/checkpoint retention limits.
export const GLOBUS_CATALOG_PRICE_MAX_AGE_MS = 60 * 60 * 1000;

const SOURCE = defineSensorSource({
  id: "globus-physical-catalog", name: "Глобус · каталог выбранного гипермаркета",
  role: SENSOR_SOURCE_ROLE.RETAILER_COMMERCE, state: SENSOR_SOURCE_STATE.READY,
  publicUrl: "https://www.globus.ru/catalog/",
  capabilities: { publicPageResearch: true, automatedObservation: true,
    exactStoreContext: true, stockObservation: false, checkout: false }
});
const sourceResolver = id => id === SOURCE.id ? SOURCE : null;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

function catalogUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== SOURCE.origin || url.username || url.password || url.hash
        || !/^\/catalog\/[a-z0-9-]+-\d+\/?$/u.test(url.pathname)
        || [...url.searchParams.keys()].some(key => !["page", "location"].includes(key))
        || url.searchParams.getAll("page").length > 1
        || (url.searchParams.has("page") && !/^[12]$/u.test(url.searchParams.get("page")))
        || url.searchParams.getAll("location").length > 1
        || (url.searchParams.has("location") && url.searchParams.get("location") !== "1")) return null;
    return url.href;
  } catch { return null; }
}

function selectedStore(selected) {
  if (selected?.retailerId !== "globus" || !Array.isArray(selected.storeIds)
      || selected.storeIds.length !== 1 || !Array.isArray(selected.addressKeys)) return null;
  const id = /^globus-store-(\d+)$/u.exec(selected.storeIds[0])?.[1];
  const store = id && resolveGlobusMoscowRegionStore(id);
  return store?.priceStatus === "verified" && store.scope === "moscow-city" && store.bindingId === `store:${id}`
    && selected.address === store.address && selected.name === store.name ? store : null;
}

function pieceSemantics(value) {
  return record(value)
    && Object.keys(value).length === 4
    && Object.keys(value).every(key => ["packageType", "basketStep", "basketMinVolume", "unitPriceText"].includes(key))
    && value.packageType === "piece" && value.basketStep === 1 && value.basketMinVolume === 1
    && typeof value.unitPriceText === "string"
    && value.unitPriceText.normalize("NFKC").trim().replace(/\s+/gu, " ") === "1 шт";
}

function qualifiedOffer(product, store, sourceProductIds, nowMs) {
  const identity = getReviewedRetailBasketProduct(product);
  const evidence = product?.comparisonEvidence;
  const storeId = `globus-store-${store.officialStoreId}`;
  const sourceUrl = catalogUrl(product?.sourceUrl);
  if (!identity || !sourceProductIds.includes(product.sourceProductId)
      || product.retailerId !== "globus" || product.basketProductId !== identity.id
      || product.storeName !== store.name || product.currency !== "RUB"
      || !Number.isSafeInteger(product.priceMinor) || product.priceMinor <= 0
      || product.priceCondition !== "regular" || product.availability !== "unknown"
      || !record(evidence) || evidence.storeId !== storeId
      || evidence.locationLabel !== store.address || evidence.scopeBinding !== "same-source"
      || evidence.bindingId !== store.bindingId || !sourceUrl
      || evidence.scopeEvidenceUrl !== product.sourceUrl
      || catalogUrl(evidence.scopeEvidenceUrl) !== sourceUrl
      || evidence.salesChannel !== "store" || evidence.minimumQuantity !== 1
      || !pieceSemantics(evidence.quantitySemantics)) return null;

  const result = createObservedOffer({
    observation: {
      kind: "public-page-observation", sourceId: SOURCE.id, sourceUrl,
      observedAt: product.observedAt,
      product: { sourceProductId: product.sourceProductId, canonicalProductId: identity.id, name: product.name },
      priceMinor: product.priceMinor, currency: "RUB", minimumQuantity: 1,
      priceCondition: "regular", salesChannel: "store", availability: "unknown", granularity: "exact-store",
      context: { retailerId: "globus", storeId, storeName: store.name, locationLabel: store.address,
        locationId: `globus:${storeId}`, countryCode: "RU",
        regionId: "77", regionName: "Москва", localityId: "moscow", localityName: "Москва" },
      proof: { type: "PUBLIC_PAGE", scopeBinding: evidence.scopeBinding, bindingId: evidence.bindingId,
        scopeEvidenceUrl: evidence.scopeEvidenceUrl, quantitySemantics: Object.freeze({ ...evidence.quantitySemantics }) }
    },
    match: { sourceId: SOURCE.id, sourceProductId: product.sourceProductId, canonicalProductId: identity.id,
      method: "canonical-id", status: "confirmed", confidence: 1 },
    sourceResolver, nowMs, maxAgeMs: GLOBUS_CATALOG_PRICE_MAX_AGE_MS
  });
  return result.kind === "accepted" ? result.offer : null;
}

// This source consumes only independently reviewed physical GLOBUS SKUs. It
// never relabels their store channel as online or passes them through beta's
// online-only commercial normalizer. Core remains responsible for comparison.
export async function loadSelectedGlobusCatalogOffers(coreBasket, storeScope, options = {}) {
  if (!Array.isArray(coreBasket) || storeScope?.kind !== "selected-store-scope"
      || storeScope.valid !== true || !Array.isArray(storeScope.stores)) return [];
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) return [];
  const sourceProductIds = getReviewedRetailSourceProductIds("globus", coreBasket.map(row => row?.product));
  if (sourceProductIds.length === 0) return [];
  const stores = storeScope.stores.filter(selected => selected?.retailerId === "globus").map(selectedStore);
  if (stores.length === 0 || stores.some(store => !store)
      || new Set(stores.map(store => store.officialStoreId)).size !== stores.length) return [];

  const createClient = options.createCatalogClient ?? createRetailCatalogClient;
  const results = await Promise.all(stores.map(async store => {
    try {
      const client = createClient({ retailerId: "globus", store, includeComparisonEvidence: true });
      const response = await client.bySourceProductIds(sourceProductIds);
      if (response?.kind !== "catalog" || !Array.isArray(response.products)) return [];
      return response.products.map(product => qualifiedOffer(product, store, sourceProductIds, nowMs)).filter(Boolean);
    } catch { return []; }
  }));
  return selectStoreScopedOffers(results.flat(), storeScope);
}
