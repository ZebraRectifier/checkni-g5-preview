// Explicit policy for saved observations admitted by the selected METRO
// catalogue bridge. This is not the live Beta transport's five-minute policy,
// a retailer price guarantee, or evidence of stock/checkout capability.
export const METRO_CATALOG_PRICE_MAX_AGE_MS = 60 * 60 * 1000;
// Result lifetime mirrors the unchanged live transport admission budget.
// A regression pins equality without coupling UI lifetime to transport mocks.
export const LIVE_BETA_RESULT_MAX_AGE_MS = 5 * 60 * 1000;
export const METRO_CATALOG_FRESHNESS_POLICY_ID = "metro-selected-catalog-v1";
export const CATALOG_FRESHNESS_PROOF_KEY = "checkniCatalogFreshness";

const keys = ["version", "policyId", "observedAt", "sourceProductId", "productId", "storeId", "sourceUrl"].sort();
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = value => typeof value === "string" && value.length > 0;

// Call only after all original identity, exact-address and commercial guards
// have admitted the normalized offer. Core carries this proof without changes.
export function markAdmittedMetroCatalogOffer(offer) {
  const marker = Object.freeze({ version: 1, policyId: METRO_CATALOG_FRESHNESS_POLICY_ID,
    observedAt: offer.observedAt, sourceProductId: offer.sourceProductId,
    productId: offer.canonicalProductId, storeId: offer.storeId, sourceUrl: offer.sourceUrl });
  return Object.freeze({ ...offer, provenance: Object.freeze({
    ...offer.provenance, sourceId: offer.sourceId, sourceName: offer.sourceName,
    sourceUrl: offer.sourceUrl, evidenceRef: offer.sourceUrl, observedAt: offer.observedAt,
    sourceProductId: offer.sourceProductId, proofType: "public-page",
    proof: Object.freeze({ [CATALOG_FRESHNESS_PROOF_KEY]: marker })
  }) });
}

// Undefined means no catalogue marker: use the original live-source policy.
// NaN means a present but invalid marker: the result must expire immediately,
// never silently fall back to either a live or an unbounded lifetime.
export function metroCatalogLineMaxAgeMs(sourceId, line, candidate, nowMs = Date.now()) {
  const proof = line?.provenance?.proof;
  if (!record(proof) || !Object.hasOwn(proof, CATALOG_FRESHNESS_PROOF_KEY)) return undefined;
  const marker = proof[CATALOG_FRESHNESS_PROOF_KEY];
  const observedMs = Date.parse(line?.observedAt);
  if (!record(marker) || Object.keys(marker).sort().join("|") !== keys.join("|")
      || marker.version !== 1 || marker.policyId !== METRO_CATALOG_FRESHNESS_POLICY_ID
      || sourceId !== "metro-public-live" || line?.provenance?.sourceId !== sourceId
      || candidate?.retailerId !== "metro" || candidate?.sourceId !== sourceId
      || !nonempty(marker.storeId) || marker.storeId !== candidate.storeId
      || !nonempty(marker.productId) || marker.productId !== line.productId
      || !nonempty(marker.sourceProductId) || marker.sourceProductId !== line.provenance.sourceProductId
      || !nonempty(marker.sourceUrl) || marker.sourceUrl !== line.sourceUrl
      || marker.sourceUrl !== line.provenance.sourceUrl
      || !Number.isSafeInteger(observedMs) || !Number.isSafeInteger(nowMs) || observedMs > nowMs
      || marker.observedAt !== line.observedAt || marker.observedAt !== line.provenance.observedAt
      || marker.observedAt !== new Date(observedMs).toISOString()) return NaN;
  return METRO_CATALOG_PRICE_MAX_AGE_MS;
}
