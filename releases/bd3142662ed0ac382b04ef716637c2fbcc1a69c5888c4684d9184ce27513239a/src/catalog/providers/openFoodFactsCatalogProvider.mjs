import {
  MATCH_METHOD,
  MATCH_STATUS,
  canonicalProductIdFromBarcode,
  createProductMatch
} from "../../matching/productMatch.mjs";
import { defineCatalogSearchProvider } from "../../ports/catalogSearchPort.mjs";

export const OPEN_FOOD_FACTS_CATALOG_PROVIDER_ID = "open-food-facts";
export const OPEN_FOOD_FACTS_SOURCE_ID = "open-food-facts";
export const OPEN_FOOD_FACTS_SEARCH_ENDPOINT = "https://search.openfoodfacts.org/search";
export const OPEN_FOOD_FACTS_PRODUCT_BASE = "https://world.openfoodfacts.org/product/";
export const OPEN_FOOD_FACTS_TIMEOUT_MS = 6_000;
export const OPEN_FOOD_FACTS_MAX_RESPONSE_BYTES = 524_288;
export const OPEN_FOOD_FACTS_MAX_RESULTS = 30;
export const OPEN_FOOD_FACTS_MAX_QUERY_LENGTH = 120;
export const OPEN_FOOD_FACTS_USER_AGENT =
  "CHECKNI-catalog/0.1 (+https://github.com/ZebraRectifier/Checkni)";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, max) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function normalizeSearchQuery(value) {
  const query = cleanString(value, OPEN_FOOD_FACTS_MAX_QUERY_LENGTH);
  if (!query) return null;

  const neutralized = query
    .replace(/\b(?:AND|OR|NOT)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return neutralized || null;
}

function escapeLuceneText(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([+\-!(){}\[\]^"~*?:/])/g, "\\$1")
    .replace(/&&/g, "\\&&")
    .replace(/\|\|/g, "\\||");
}

function russiaFirstQuery(value) {
  const query = normalizeSearchQuery(value);
  if (!query) return null;
  return `countries_tags:"en:russia" ${escapeLuceneText(query)}`;
}

function normalizeResultCount(value) {
  if (!Number.isInteger(value) || value < 1 || value > OPEN_FOOD_FACTS_MAX_RESULTS) {
    return null;
  }
  return value;
}

function normalizeHit(hit) {
  if (!isRecord(hit)) return null;

  const code = cleanString(hit.code, 32);
  const name = cleanString(hit.product_name, 240);
  if (!code || !name) return null;

  const unit = cleanString(hit.quantity, 120);
  const category = cleanString(hit.categories, 160);
  const canonicalProductId = canonicalProductIdFromBarcode(code);

  let match;
  let canonicalIdentity;

  if (canonicalProductId && unit) {
    const validated = createProductMatch({
      sourceId: OPEN_FOOD_FACTS_SOURCE_ID,
      sourceProductId: code,
      sourceProductName: name,
      canonicalProductId,
      method: MATCH_METHOD.BARCODE,
      status: MATCH_STATUS.CONFIRMED,
      confidence: 1
    });

    if (validated.kind === "accepted") {
      match = validated.match;
      canonicalIdentity = Object.freeze({
        id: canonicalProductId,
        name,
        unit
      });
    }
  }

  return Object.freeze({
    sourceId: OPEN_FOOD_FACTS_SOURCE_ID,
    sourceProductId: code,
    name,
    ...(unit ? { unit } : {}),
    ...(category ? { category } : {}),
    sourceUrl: OPEN_FOOD_FACTS_PRODUCT_BASE + encodeURIComponent(code),
    ...(match ? { match } : {}),
    ...(canonicalIdentity ? { canonicalIdentity } : {})
  });
}

async function readBoundedJson(response, maxBytes) {
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

export function createOpenFoodFactsCatalogClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? OPEN_FOOD_FACTS_SEARCH_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? OPEN_FOOD_FACTS_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? OPEN_FOOD_FACTS_MAX_RESPONSE_BYTES;

  const search = async (query, searchOptions = {}) => {
    const normalizedQuery = russiaFirstQuery(query);
    if (!normalizedQuery) {
      throw new TypeError("Open Food Facts query is invalid");
    }

    if (typeof fetchImpl !== "function") {
      throw new Error("open_food_facts_transport_unconfigured");
    }

    const pageSize = normalizeResultCount(
      searchOptions.pageSize ?? OPEN_FOOD_FACTS_MAX_RESULTS
    );
    if (pageSize == null) {
      throw new TypeError("Open Food Facts page size is invalid");
    }

    let url;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error("open_food_facts_transport_unconfigured");
    }
    if (url.protocol !== "https:") {
      throw new Error("open_food_facts_transport_unconfigured");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url.href, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": OPEN_FOOD_FACTS_USER_AGENT
        },
        body: JSON.stringify({
          q: normalizedQuery,
          langs: ["ru", "en"],
          page: 1,
          page_size: pageSize,
          fields: [
            "code",
            "product_name",
            "quantity",
            "brands",
            "categories"
          ]
        }),
        redirect: "manual",
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store"
      });

      if (response.status === 429 || response.status >= 500) {
        throw new Error("open_food_facts_unavailable");
      }
      if (!response.ok) {
        throw new Error("open_food_facts_rejected_request");
      }

      const payload = await readBoundedJson(response, maxResponseBytes);
      if (!isRecord(payload) || !Array.isArray(payload.hits)) {
        throw new Error("open_food_facts_malformed_response");
      }

      return Object.freeze(
        payload.hits
          .map(normalizeHit)
          .filter(Boolean)
      );
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({ search });
}

export function createOpenFoodFactsCatalogProvider(options = {}) {
  const client = createOpenFoodFactsCatalogClient(options);
  return defineCatalogSearchProvider({
    id: OPEN_FOOD_FACTS_CATALOG_PROVIDER_ID,
    search: (query, context = {}) => {
      if (
        typeof context.countryCode === "string"
        && context.countryCode !== "RU"
      ) {
        return [];
      }
      return client.search(query);
    }
  });
}

export {
  normalizeHit,
  readBoundedJson,
  russiaFirstQuery
};
