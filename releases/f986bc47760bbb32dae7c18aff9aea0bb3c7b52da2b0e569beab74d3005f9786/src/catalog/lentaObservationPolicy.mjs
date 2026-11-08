export const LENTA_OBSERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isLentaCatalogCard(product) {
  return product?.retailerId === 'lenta' || product?.catalogSource === 'lenta';
}

export function getLentaObservationStatus(product, nowMs = Date.now()) {
  if (!isLentaCatalogCard(product)) return null;

  const observedMs = Date.parse(product?.observedAt);
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs) || observedMs > nowMs) {
    return 'unknown';
  }
  return nowMs - observedMs >= LENTA_OBSERVATION_MAX_AGE_MS ? 'stale' : 'recent';
}

// The current Lenta feed is a country-wide public catalogue rather than an
// exact-store, stock-confirmed offer. It must stay display-only even while an
// observation is recent. Keeping this decision in an explicit policy makes a
// future identity binding unable to admit stale rows accidentally.
export function canAdmitLentaCatalogCard(product, nowMs = Date.now()) {
  return getLentaObservationStatus(product, nowMs) === null;
}
