import { createRetailCatalogClient } from "./retailCatalogPort.mjs";
import { normalizeBetaRetailPricesResponse, isBetaRetailIdentityConfirmed } from "./betaRetailPricesPort.mjs";
import { BETA_METRO_MAGNIT_EVERYDAY_PROOF_PROFILE_ID } from "../data/betaRealBasket.mjs";
import { METRO_CATALOG_PRICE_MAX_AGE_MS, markAdmittedMetroCatalogOffer } from "../observations/retailCatalogFreshnessPolicy.mjs";
import { resolveMetroMoscowRegionStore } from "../data/metroMoscowRegionStores.mjs";
import {
  getReviewedRetailBasketProduct,
  getReviewedRetailSourceProductIds
} from "../catalog/reviewedRetailBasket.mjs";
import { selectStoreScopedOffers } from "../observations/selectedStoreScope.mjs";

// Transport bridge only: reuse the existing commercial admission contract.
// Magnit's public-online catalogue condition and physical GLOBUS prices are
// not admitted by that contract. Do not reinterpret them to create a winner.
export async function loadSelectedRetailCatalogOffers(coreBasket, storeScope, options = {}) {
  if (!Array.isArray(coreBasket) || storeScope?.valid !== true) return [];
  if (!isBetaRetailIdentityConfirmed(BETA_METRO_MAGNIT_EVERYDAY_PROOF_PROFILE_ID)) return [];
  const selected = storeScope.stores.find(store => store.retailerId === "metro");
  if (!selected) return [];
  const store = resolveMetroMoscowRegionStore({ storeId: selected.storeIds[0] });
  if (!store || store.scope !== "moscow-city" || store.onlinePickupStatus !== "proven") return [];
  const sourceProductIds = getReviewedRetailSourceProductIds("metro", coreBasket.map(row => row.product));
  if (sourceProductIds.length === 0) return [];

  const createClient = options.createCatalogClient ?? createRetailCatalogClient;
  const client = createClient({ retailerId: "metro", store,
    includeComparisonEvidence: true });
  let response;
  try { response = await client.bySourceProductIds(sourceProductIds); } catch { return []; }
  if (response?.kind !== "catalog" || !Array.isArray(response.products)) return [];
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = METRO_CATALOG_PRICE_MAX_AGE_MS;
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return [];

  const offers = [];
  for (const product of response.products) {
    const identity = getReviewedRetailBasketProduct(product);
    const evidence = product?.comparisonEvidence;
    const age = nowMs - Date.parse(product?.observedAt);
    if (!identity || !sourceProductIds.includes(product.sourceProductId)
        || product.basketProductId !== identity.id || product.retailerId !== "metro"
        || !evidence || evidence.scopeBinding !== "same-source"
        || evidence.bindingId !== store.bindingId || evidence.storeId !== store.storeId
        || evidence.scopeEvidenceUrl !== product.sourceUrl
        || !evidence.quantitySemantics || typeof evidence.quantitySemantics !== "object"
        || Array.isArray(evidence.quantitySemantics) || Object.keys(evidence.quantitySemantics).length !== 0
        || !Number.isFinite(age) || age < 0 || age > maxAgeMs) continue;

    const normalized = normalizeBetaRetailPricesResponse({ kind: "insufficient",
      refreshedAt: new Date(nowMs).toISOString(), offers: [{
        sourceId: "metro-public-live", sourceName: "METRO · публичный каталог",
        sourceUrl: product.sourceUrl, observedAt: product.observedAt,
        granularity: "exact-store", locationTruthLevel: "store",
        locationId: `metro:${evidence.storeId}`, countryCode: "RU", regionId: "77", regionName: "Москва",
        localityId: "moscow", localityName: "Москва", retailerId: "metro",
        canonicalProductId: identity.id, sourceProductId: product.sourceProductId,
        sourceProductName: product.name, unitPriceMinor: product.priceMinor, currency: product.currency,
        priceCondition: product.priceCondition, salesChannel: evidence.salesChannel,
        minimumQuantity: evidence.minimumQuantity, storeId: evidence.storeId,
        storeName: product.storeName, locationLabel: evidence.locationLabel, availability: product.availability
      }] });
    if (Array.isArray(normalized.offers)) offers.push(...normalized.offers.map(markAdmittedMetroCatalogOffer));
  }
  return selectStoreScopedOffers(offers, storeScope);
}
