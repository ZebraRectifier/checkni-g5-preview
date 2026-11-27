import { CATALOG_SEARCH_ENDPOINT, CATALOG_SEARCH_PUBLISHABLE_KEY } from './catalogGatewayPort.mjs';

const endpoint = new URL('/rest/v1/retail_catalog_items', CATALOG_SEARCH_ENDPOINT).href;
export const GLOBUS_LATEST_OBSERVATION_TIMEOUT_MS = 15_000;
export const GLOBUS_RECENT_PRICE_MAX_AGE_MS = 60 * 60 * 1000;

export function classifyGlobusLatestObservation(result, nowMs = Date.now()) {
  if (result?.kind !== 'found') return result?.kind === 'missing' ? 'missing' : 'unknown';
  const observedMs = Date.parse(result.observedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs)
      || observedMs > nowMs || observedMs < 0) return 'unknown';
  return nowMs - observedMs <= GLOBUS_RECENT_PRICE_MAX_AGE_MS ? 'recent' : 'dated';
}

// One bounded public metadata read for the address the visitor explicitly opened.
// A single recent row does not prove that other products are fresh or in stock.
export async function readGlobusStoreLatestObservation(officialStoreId, {
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!/^\d{4}$/u.test(String(officialStoreId)) || typeof fetchImpl !== 'function') return { kind: 'unknown' };
  const storeId = `globus-store-${officialStoreId}`;
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({
    select: 'retailer_id,store_id,observed_at,price_minor',
    retailer_id: 'eq.globus', store_id: `eq.${storeId}`,
    active: 'eq.true', price_minor: 'gt.0',
    order: 'observed_at.desc', limit: '1',
  })) url.searchParams.set(key, value);
  try {
    const response = await fetchImpl(url.href, {
      method: 'GET', headers: { Accept: 'application/json', apikey: CATALOG_SEARCH_PUBLISHABLE_KEY },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(GLOBUS_LATEST_OBSERVATION_TIMEOUT_MS),
    });
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) return { kind: 'unknown' };
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 4096) return { kind: 'unknown' };
    const body = await response.text();
    if (body.length > 4096) return { kind: 'unknown' };
    const rows = JSON.parse(body);
    if (!Array.isArray(rows) || rows.length > 1) return { kind: 'unknown' };
    if (!rows.length) return { kind: 'missing' };
    const row = rows[0], observedMs = Date.parse(row?.observed_at);
    if (row?.retailer_id !== 'globus' || row.store_id !== storeId
        || !Number.isSafeInteger(row.price_minor) || row.price_minor <= 0
        || !Number.isFinite(observedMs) || observedMs < 0 || observedMs > Date.now() + 60_000)
      return { kind: 'unknown' };
    return { kind: 'found', observedAt: new Date(observedMs).toISOString() };
  } catch {
    return { kind: 'unknown' };
  }
}
