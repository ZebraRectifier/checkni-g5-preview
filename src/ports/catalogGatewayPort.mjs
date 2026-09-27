import { createCatalogProduct } from "../catalog/productDiscovery.mjs";
import { normalizeHit } from "../catalog/providers/openFoodFactsCatalogProvider.mjs";

export const CATALOG_SEARCH_ENDPOINT =
  "https://cxpneczhczashanbetgj.supabase.co/functions/v1/catalog-search";
export const CATALOG_SEARCH_PUBLISHABLE_KEY =
  "sb_publishable_yyIT9Clu4jTphSdVLCVWFA_KQsZZ2rt";
export const CATALOG_SEARCH_TIMEOUT_MS = 7_000;
export const MAX_CATALOG_GATEWAY_RESPONSE_BYTES = 131_072;
export const MAX_CATALOG_GATEWAY_QUERIES = 5;
export const MAX_CATALOG_GATEWAY_PRODUCTS = 40;
export const CATALOG_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_CATALOG_SEARCH_CACHE_ENTRIES = 24;

const RAW_PRODUCT_FIELDS = new Set([
  "code",
  "product_name",
  "quantity",
  "brands",
  "categories"
]);

function result(kind, details = {}) {
  return Object.freeze({ kind, ...details });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalString(value) {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value;
}

function isSafeEndpoint(value) {
  try {
    return typeof value === "string" && new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeQueries(queries) {
  if (
    !Array.isArray(queries)
    || queries.length === 0
    || queries.length > MAX_CATALOG_GATEWAY_QUERIES
  ) {
    return null;
  }

  const seen = new Set();
  const normalized = [];
  for (const query of queries) {
    if (!isCanonicalString(query) || query.length > 120) return null;
    const trimmed = query.trim();
    const key = trimmed.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized.length > 0 ? normalized : null;
}

async function readBoundedJsonResponse(response, maxBytes) {
  const declaredLength = response.headers?.get?.("Content-Length");
  if (
    declaredLength != null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    return null;
  }
  if (!response.body || typeof response.body.getReader !== "function") return null;

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function normalizeCatalogPayload(payload) {
  if (
    !isRecord(payload)
    || payload.kind !== "catalog"
    || Object.keys(payload).some((key) => !["kind", "products", "partial"].includes(key))
    || !Array.isArray(payload.products)
    || payload.products.length > MAX_CATALOG_GATEWAY_PRODUCTS
    || typeof payload.partial !== "boolean"
  ) {
    return result("error", { code: "malformed_transport_response" });
  }

  const products = [];
  let rejectedCount = 0;

  for (const rawProduct of payload.products) {
    if (
      !isRecord(rawProduct)
      || Object.keys(rawProduct).some((key) => !RAW_PRODUCT_FIELDS.has(key))
    ) {
      rejectedCount += 1;
      continue;
    }

    const discoveryRow = normalizeHit(rawProduct);
    if (!discoveryRow) {
      rejectedCount += 1;
      continue;
    }

    const normalized = createCatalogProduct(discoveryRow);
    if (normalized.kind !== "accepted") {
      rejectedCount += 1;
      continue;
    }

    products.push(normalized.product);
  }

  return result("catalog", {
    products: Object.freeze(products),
    partial: payload.partial || rejectedCount > 0,
    rejectedCount
  });
}

function normalizeFailurePayload(payload, expectedKind) {
  if (
    !isRecord(payload)
    || payload.kind !== expectedKind
    || Object.keys(payload).some((key) => key !== "kind" && key !== "code")
    || (Object.hasOwn(payload, "code") && !isCanonicalString(payload.code))
  ) {
    return result("error", { code: "malformed_transport_response" });
  }

  return result(expectedKind, {
    ...(payload.code ? { code: payload.code } : {})
  });
}

export function createCatalogSearchClient(options = {}) {
  const endpoint = options.endpoint ?? CATALOG_SEARCH_ENDPOINT;
  const publishableKey =
    options.publishableKey ?? CATALOG_SEARCH_PUBLISHABLE_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? CATALOG_SEARCH_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? CATALOG_SEARCH_CACHE_TTL_MS;
  const maxCacheEntries =
    options.maxCacheEntries ?? MAX_CATALOG_SEARCH_CACHE_ENTRIES;
  const cache = new Map();

  if (
    typeof now !== "function"
    || !Number.isSafeInteger(cacheTtlMs)
    || cacheTtlMs < 0
    || !Number.isSafeInteger(maxCacheEntries)
    || maxCacheEntries < 0
  ) {
    throw new TypeError("catalog gateway cache configuration is invalid");
  }

  const isConfigured = () => (
    isSafeEndpoint(endpoint)
    && isCanonicalString(publishableKey)
    && typeof fetchImpl === "function"
  );

  const search = async (queries, searchOptions = {}) => {
    if (!isConfigured()) {
      return result("unavailable", { code: "transport_unconfigured" });
    }

    const normalizedQueries = normalizeQueries(queries);
    const limitPerQuery = searchOptions.limitPerQuery ?? 8;
    if (
      !normalizedQueries
      || !Number.isSafeInteger(limitPerQuery)
      || limitPerQuery < 1
      || limitPerQuery > 8
    ) {
      return result("error", { code: "invalid_request" });
    }

    const cacheKey = JSON.stringify([normalizedQueries, limitPerQuery]);
    const cached = cache.get(cacheKey);
    if (
      cached
      && cacheTtlMs > 0
      && now() - cached.cachedAtMs <= cacheTtlMs
    ) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return cached.value;
    }
    if (cached) cache.delete(cacheKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: publishableKey
        },
        body: JSON.stringify({
          queries: normalizedQueries,
          limitPerQuery
        }),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store"
      });

      const payload = await readBoundedJsonResponse(
        response,
        MAX_CATALOG_GATEWAY_RESPONSE_BYTES
      );

      if (response.status === 429 || response.status >= 500) {
        if (payload !== null) {
          return normalizeFailurePayload(payload, "unavailable");
        }
        return result("unavailable", { code: "transport_unavailable" });
      }

      if (!response.ok) {
        return payload !== null
          ? normalizeFailurePayload(payload, "error")
          : result("error", { code: "transport_rejected_request" });
      }

      if (payload === null) {
        return result("error", { code: "malformed_transport_response" });
      }

      const normalized = normalizeCatalogPayload(payload);

      if (
        normalized.kind === "catalog"
        && normalized.partial === false
        && cacheTtlMs > 0
        && maxCacheEntries > 0
      ) {
        cache.delete(cacheKey);
        cache.set(cacheKey, Object.freeze({
          cachedAtMs: now(),
          value: normalized
        }));
        while (cache.size > maxCacheEntries) {
          cache.delete(cache.keys().next().value);
        }
      }

      return normalized;
    } catch {
      return result("unavailable", { code: "transport_unavailable" });
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({ isConfigured, search });
}

const defaultClient = createCatalogSearchClient();

export function isCatalogSearchConfigured() {
  return defaultClient.isConfigured();
}

export async function requestCatalogSearch(queries, options) {
  return defaultClient.search(queries, options);
}

export {
  normalizeCatalogPayload,
  readBoundedJsonResponse
};
