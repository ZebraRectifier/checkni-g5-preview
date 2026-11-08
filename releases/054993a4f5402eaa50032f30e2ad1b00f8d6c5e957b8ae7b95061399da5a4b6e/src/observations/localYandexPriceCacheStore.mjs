import {
  normalizeYandexPublicPricesResponse
} from "../ports/yandexPublicPricesPort.mjs";

export const YANDEX_PRICE_CACHE_STORAGE_KEY =
  "checkni.surface.yandex-price-cache.v1";
export const MAX_YANDEX_PRICE_CACHE_ENTRIES = 12;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveStorage(explicitStorage) {
  if (explicitStorage !== undefined) return explicitStorage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readRows(storage, key) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRows(storage, key, rows) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

function normalizedEntry(value, { nowMs, maxAgeMs }) {
  if (!isRecord(value)) return null;

  const response = normalizeYandexPublicPricesResponse(value.response);
  if (response.kind !== "prices" && response.kind !== "empty") {
    return null;
  }

  const observedAtMs = Date.parse(response.observedAt);
  if (!Number.isFinite(observedAtMs)) return null;
  if (observedAtMs > nowMs + 60_000) return null;
  if (nowMs - observedAtMs > maxAgeMs) return null;

  return Object.freeze({
    organizationId: response.organizationId,
    observedAtMs,
    response
  });
}

function responseTruthFingerprint(response) {
  const products = Array.isArray(response.products)
    ? response.products
      .map((product) => [
        product.sourceProductId ?? null,
        product.name ?? null,
        product.priceMinor ?? null,
        product.currency ?? null
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"))
    : [];

  return JSON.stringify([
    response.kind,
    response.sourceId ?? null,
    response.organizationId ?? null,
    response.sourceUrl ?? null,
    products
  ]);
}

function newestOrganizationState(entries, organizationId) {
  const scoped = entries
    .filter((entry) => entry.organizationId === organizationId)
    .sort((a, b) => b.observedAtMs - a.observedAtMs);

  if (scoped.length === 0) {
    return { kind: "none", entries: [] };
  }

  const newestAt = scoped[0].observedAtMs;
  const newest = scoped.filter((entry) => entry.observedAtMs === newestAt);
  const facts = new Set(
    newest.map((entry) => responseTruthFingerprint(entry.response))
  );

  if (facts.size > 1) {
    return {
      kind: "conflict",
      observedAtMs: newestAt,
      entries: newest
    };
  }

  return {
    kind: "coherent",
    observedAtMs: newestAt,
    entries: newest
  };
}

export function loadCachedYandexPrices(
  organizationId,
  options = {}
) {
  const storage = resolveStorage(options.storage);
  const key = options.storageKey ?? YANDEX_PRICE_CACHE_STORAGE_KEY;
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 15 * 60 * 1000;

  if (
    typeof organizationId !== "string"
    || !/^\d+$/.test(organizationId)
    || !Number.isFinite(nowMs)
    || !Number.isFinite(maxAgeMs)
    || maxAgeMs < 0
  ) {
    return null;
  }

  const entries = readRows(storage, key)
    .map((value) => normalizedEntry(value, { nowMs, maxAgeMs }))
    .filter(Boolean)
    .sort((a, b) => b.observedAtMs - a.observedAtMs);

  const state = newestOrganizationState(entries, organizationId);
  if (state.kind !== "coherent") return null;

  return state.entries[0]?.response ?? null;
}

export function saveCachedYandexPrices(response, options = {}) {
  const normalized = normalizeYandexPublicPricesResponse(response);
  if (normalized.kind !== "prices" && normalized.kind !== "empty") {
    return Object.freeze({
      kind: "rejected",
      reason: "uncacheable_response"
    });
  }

  const storage = resolveStorage(options.storage);
  const key = options.storageKey ?? YANDEX_PRICE_CACHE_STORAGE_KEY;
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 15 * 60 * 1000;

  const next = normalizedEntry(
    { response: normalized },
    { nowMs, maxAgeMs }
  );
  if (!next) {
    return Object.freeze({
      kind: "rejected",
      reason: "stale_or_invalid_response"
    });
  }

  const existing = readRows(storage, key)
    .map((value) => normalizedEntry(value, { nowMs, maxAgeMs }))
    .filter(Boolean);

  const sameOrganization = existing.filter(
    (entry) => entry.organizationId === next.organizationId
  );
  const otherOrganizations = existing.filter(
    (entry) => entry.organizationId !== next.organizationId
  );
  const currentState = newestOrganizationState(
    sameOrganization,
    next.organizationId
  );

  let selectedOrganizationEntries;

  if (
    currentState.kind !== "none"
    && currentState.observedAtMs > next.observedAtMs
  ) {
    selectedOrganizationEntries = currentState.entries;
  } else if (
    currentState.kind !== "none"
    && currentState.observedAtMs === next.observedAtMs
  ) {
    const newest = currentState.entries.slice();
    const nextFingerprint = responseTruthFingerprint(next.response);
    const existingFingerprints = new Set(
      newest.map((entry) => responseTruthFingerprint(entry.response))
    );

    if (!existingFingerprints.has(nextFingerprint)) {
      newest.push(next);
    }

    selectedOrganizationEntries = newest;
  } else {
    selectedOrganizationEntries = [next];
  }

  const rows = [
    ...selectedOrganizationEntries,
    ...otherOrganizations
  ]
    .sort((a, b) => b.observedAtMs - a.observedAtMs)
    .slice(0, MAX_YANDEX_PRICE_CACHE_ENTRIES)
    .map((entry) => ({
      response: entry.response
    }));

  if (!writeRows(storage, key, rows)) {
    return Object.freeze({
      kind: "unavailable",
      reason: "storage_unavailable"
    });
  }

  return Object.freeze({
    kind: "accepted",
    organizationId: next.organizationId,
    count: rows.length
  });
}

export function clearYandexPriceCache(options = {}) {
  const storage = resolveStorage(options.storage);
  const key = options.storageKey ?? YANDEX_PRICE_CACHE_STORAGE_KEY;
  if (!storage) return false;

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
