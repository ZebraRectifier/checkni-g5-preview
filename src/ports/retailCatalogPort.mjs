import {
  CATALOG_SEARCH_PUBLISHABLE_KEY
} from "./catalogGatewayPort.mjs";

export const RETAIL_CATALOG_ENDPOINT =
  "https://cxpneczhczashanbetgj.supabase.co/rest/v1/retail_catalog_items";
export const RETAIL_CATALOG_TIMEOUT_MS = 2_500;
export const MAX_RETAIL_CATALOG_RESPONSE_BYTES = 262_144;
export const MAX_RETAIL_CATALOG_PRODUCTS = 40;

const SELECT_FIELDS = [
  "retailer_id",
  "store_id",
  "store_name",
  "locality_id",
  "locality_name",
  "source_product_id",
  "name",
  "price_minor",
  "currency",
  "price_condition",
  "availability",
  "product_url",
  "image_url",
  "weight_text",
  "observed_at"
].join(",");

function result(kind, details = {}) {
  return Object.freeze({ kind, ...details });
}

function cleanQuery(value) {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\,%*()"'\u0000-\u001f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized && normalized.length <= 120 ? normalized : null;
}

function safeUrl(raw, host, prefix = "/") {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:"
      || url.hostname !== host
      || !url.pathname.startsWith(prefix)
    ) {
      return null;
    }
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

async function readBoundedJsonResponse(response, maxBytes) {
  const declaredLength = response.headers?.get?.("Content-Length");
  if (
    declaredLength !== null
    && declaredLength !== undefined
    && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxBytes)
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

function normalizeRetailRow(row) {
  if (
    !row
    || typeof row !== "object"
    || Array.isArray(row)
    || row.retailer_id !== "globus"
    || row.store_id !== "globus-pvz-2"
    || row.locality_id !== "city-moscow"
    || row.locality_name !== "Москва"
    || typeof row.source_product_id !== "string"
    || !row.source_product_id
    || typeof row.name !== "string"
    || !row.name.trim()
    || !Number.isSafeInteger(row.price_minor)
    || row.price_minor <= 0
    || row.currency !== "RUB"
    || row.availability !== "unknown"
  ) {
    return null;
  }

  const productUrl = safeUrl(row.product_url, "www.globus.ru", "/products/")
    ?? safeUrl(row.product_url, "globus.ru", "/products/");
  const imageUrl = safeUrl(row.image_url, "image.globus.ru");
  const observedMs = Date.parse(row.observed_at);
  if (!productUrl || !imageUrl || !Number.isFinite(observedMs)) return null;

  return Object.freeze({
    id: `retail:globus:${row.store_id}:${row.source_product_id}`,
    name: row.name.trim(),
    unit: typeof row.weight_text === "string" && row.weight_text.trim()
      ? row.weight_text.trim()
      : "упаковка",
    category: "Глобус · Москва",
    catalogSource: "globus",
    catalogDisplayOnly: true,
    retailerId: "globus",
    storeName: typeof row.store_name === "string" && row.store_name.trim()
      ? row.store_name.trim()
      : "Глобус Красногорск",
    sourceProductId: row.source_product_id,
    priceMinor: row.price_minor,
    currency: "RUB",
    priceCondition: typeof row.price_condition === "string"
      ? row.price_condition
      : "unknown",
    availability: "unknown",
    imageUrl,
    sourceUrl: productUrl,
    observedAt: new Date(observedMs).toISOString()
  });
}

export function createRetailCatalogClient(options = {}) {
  const endpoint = options.endpoint ?? RETAIL_CATALOG_ENDPOINT;
  const publishableKey =
    options.publishableKey ?? CATALOG_SEARCH_PUBLISHABLE_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? RETAIL_CATALOG_TIMEOUT_MS;

  return Object.freeze({
    async search(query, searchOptions = {}) {
      const normalizedQuery = cleanQuery(query);
      const limit = searchOptions.limit ?? 24;
      if (
        !normalizedQuery
        || !Number.isSafeInteger(limit)
        || limit < 1
        || limit > MAX_RETAIL_CATALOG_PRODUCTS
      ) {
        return result("error", { code: "invalid_request" });
      }
      if (typeof fetchImpl !== "function") {
        return result("unavailable", { code: "transport_unconfigured" });
      }

      let url;
      try {
        url = new URL(endpoint);
      } catch {
        return result("unavailable", { code: "transport_unconfigured" });
      }
      if (url.protocol !== "https:") {
        return result("unavailable", { code: "transport_unconfigured" });
      }

      url.searchParams.set("select", SELECT_FIELDS);
      url.searchParams.set("retailer_id", "eq.globus");
      url.searchParams.set("store_id", "eq.globus-pvz-2");
      url.searchParams.set("locality_id", "eq.city-moscow");
      url.searchParams.set("active", "eq.true");
      url.searchParams.set("name", `ilike.*${normalizedQuery}*`);
      url.searchParams.set("order", "updated_at.desc");
      url.searchParams.set("limit", String(limit));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.href, {
          headers: {
            Accept: "application/json",
            apikey: publishableKey
          },
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal
        });

        if (response.status === 429 || response.status >= 500) {
          return result("unavailable", { code: "transport_unavailable" });
        }
        if (!response.ok) {
          return result("error", { code: "transport_rejected_request" });
        }

        const payload = await readBoundedJsonResponse(
          response,
          MAX_RETAIL_CATALOG_RESPONSE_BYTES
        );
        if (!Array.isArray(payload) || payload.length > limit) {
          return result("error", { code: "malformed_transport_response" });
        }

        const products = payload.map(normalizeRetailRow).filter(Boolean);
        return result("catalog", {
          products: Object.freeze(products),
          partial: products.length !== payload.length
        });
      } catch {
        return result("unavailable", { code: "transport_unavailable" });
      } finally {
        clearTimeout(timer);
      }
    }
  });
}

const defaultClient = createRetailCatalogClient();

export async function requestRetailCatalogSearch(query, options) {
  return defaultClient.search(query, options);
}

export {
  cleanQuery,
  normalizeRetailRow,
  readBoundedJsonResponse
};
