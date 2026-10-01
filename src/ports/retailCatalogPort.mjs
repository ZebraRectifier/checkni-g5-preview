import {
  CATALOG_SEARCH_PUBLISHABLE_KEY
} from "./catalogGatewayPort.mjs";

export const RETAIL_CATALOG_ENDPOINT =
  "https://cxpneczhczashanbetgj.supabase.co/rest/v1/retail_catalog_items";
export const RETAIL_CATEGORY_ENDPOINT =
  "https://cxpneczhczashanbetgj.supabase.co/rest/v1/retail_catalog_categories";
export const RETAIL_CATALOG_TIMEOUT_MS = 2_500;
export const MAX_RETAIL_CATALOG_RESPONSE_BYTES = 262_144;
export const MAX_RETAIL_CATALOG_PRODUCTS = 40;

const RETAIL_CATALOG_DEFINITIONS = Object.freeze({
  globus: Object.freeze({
    retailerId: "globus",
    storeId: "globus-pvz-2",
    storeName: "Глобус Красногорск",
    localityId: "city-moscow",
    localityName: "Москва",
    displayName: "Глобус",
    catalogLabel: "Глобус · Москва",
    scopeLabel: "Москва · реальные наблюдаемые цены",
    logo: "Г",
    defaultProductCount: 3034,
    productUrlRules: Object.freeze([
      Object.freeze({ host: "www.globus.ru", prefix: "/products/" }),
      Object.freeze({ host: "globus.ru", prefix: "/products/" })
    ]),
    imageUrlRules: Object.freeze([
      Object.freeze({ host: "image.globus.ru", prefix: "/" })
    ]),
    categoryUrlRules: Object.freeze([
      Object.freeze({ host: "www.globus.ru", prefix: "/catalog/" }),
      Object.freeze({ host: "online.globus.ru", prefix: "/catalog/" }),
      Object.freeze({ host: "globus.ru", prefix: "/catalog/" })
    ]),
    sourceUrlRules: Object.freeze([
      Object.freeze({ host: "www.globus.ru", prefix: "/products/" }),
      Object.freeze({ host: "globus.ru", prefix: "/products/" }),
      Object.freeze({ host: "www.globus.ru", prefix: "/catalog/" }),
      Object.freeze({ host: "online.globus.ru", prefix: "/catalog/" }),
      Object.freeze({ host: "globus.ru", prefix: "/catalog/" })
    ]),
    priceConditionLabels: Object.freeze({})
  }),
  lenta: Object.freeze({
    retailerId: "lenta",
    storeId: "lenta-public-web",
    storeName: "Лента · публичный каталог",
    localityId: "country-ru-public-catalog",
    localityName: "Россия",
    displayName: "Лента",
    catalogLabel: "Лента · публичный каталог",
    scopeLabel: "Публичный каталог · наличие неизвестно",
    logo: "Л",
    defaultProductCount: 19,
    rootCategoryCount: 22,
    productUrlRules: Object.freeze([
      Object.freeze({ host: "lenta.com", prefix: "/product/" }),
      Object.freeze({ host: "www.lenta.com", prefix: "/product/" })
    ]),
    imageUrlRules: Object.freeze([
      Object.freeze({ host: "cdn.api.lenta.com", prefix: "/resample/" })
    ]),
    categoryUrlRules: Object.freeze([
      Object.freeze({ host: "lenta.com", prefix: "/catalog/" }),
      Object.freeze({ host: "www.lenta.com", prefix: "/catalog/" })
    ]),
    sourceUrlRules: Object.freeze([
      Object.freeze({ host: "lenta.com", prefix: "/product/" }),
      Object.freeze({ host: "www.lenta.com", prefix: "/product/" }),
      Object.freeze({ host: "lenta.com", prefix: "/catalog/" }),
      Object.freeze({ host: "www.lenta.com", prefix: "/catalog/" })
    ]),
    priceConditionLabels: Object.freeze({
      "loyalty-card-1": "По Карте №1"
    })
  })
});

export const RETAIL_CATALOG_IDS = Object.freeze(
  Object.keys(RETAIL_CATALOG_DEFINITIONS)
);

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
  "main_category_id",
  "source_url",
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

function safeUrl(raw, rules) {
  if (typeof raw !== "string" || !Array.isArray(rules)) return null;
  try {
    const url = new URL(raw);
    const allowed = rules.some((rule) => (
      url.protocol === "https:"
      && url.hostname === rule.host
      && url.pathname.startsWith(rule.prefix)
    ));
    if (!allowed) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function getRetailCatalogDefinition(retailerId) {
  if (typeof retailerId !== "string") return null;
  return RETAIL_CATALOG_DEFINITIONS[retailerId] ?? null;
}

function resolveDefinition(value = "globus") {
  if (typeof value === "string") {
    return getRetailCatalogDefinition(value);
  }
  if (
    value
    && typeof value === "object"
    && typeof value.retailerId === "string"
  ) {
    return getRetailCatalogDefinition(value.retailerId);
  }
  return null;
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

function normalizeRetailRow(row, retailer = "globus") {
  const definition = resolveDefinition(retailer);
  if (
    !definition
    || !row
    || typeof row !== "object"
    || Array.isArray(row)
    || row.retailer_id !== definition.retailerId
    || row.store_id !== definition.storeId
    || row.locality_id !== definition.localityId
    || row.locality_name !== definition.localityName
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

  const productUrl = safeUrl(row.product_url, definition.productUrlRules);
  const imageUrl = safeUrl(row.image_url, definition.imageUrlRules);
  const sourceUrl = safeUrl(row.source_url, definition.sourceUrlRules)
    ?? productUrl;
  const observedMs = Date.parse(row.observed_at);
  if (
    !productUrl
    || !sourceUrl
    || !Number.isFinite(observedMs)
  ) {
    return null;
  }

  const priceCondition = typeof row.price_condition === "string"
    ? row.price_condition
    : "unknown";
  const priceConditionLabel =
    definition.priceConditionLabels[priceCondition] ?? null;

  return Object.freeze({
    id: `retail:${definition.retailerId}:${row.store_id}:${row.source_product_id}`,
    name: row.name.trim(),
    unit: typeof row.weight_text === "string" && row.weight_text.trim()
      ? row.weight_text.trim()
      : "упаковка",
    category: definition.catalogLabel,
    catalogSource: definition.retailerId,
    catalogDisplayOnly: true,
    retailerId: definition.retailerId,
    retailerDisplayName: definition.displayName,
    storeName: typeof row.store_name === "string" && row.store_name.trim()
      ? row.store_name.trim()
      : definition.storeName,
    sourceProductId: row.source_product_id,
    priceMinor: row.price_minor,
    currency: "RUB",
    priceCondition,
    priceConditionLabel,
    availability: "unknown",
    mainCategoryId: Number.isSafeInteger(row.main_category_id)
      ? row.main_category_id
      : null,
    imageUrl,
    sourceUrl,
    productUrl,
    observedAt: new Date(observedMs).toISOString()
  });
}

function normalizeRetailCategory(row, retailer = "globus") {
  const definition = resolveDefinition(retailer);
  if (
    !definition
    || !row
    || typeof row !== "object"
    || Array.isArray(row)
    || row.retailer_id !== definition.retailerId
    || row.store_id !== definition.storeId
    || !Number.isSafeInteger(row.category_id)
    || row.category_id <= 0
    || typeof row.name !== "string"
    || !row.name.trim()
    || !Number.isSafeInteger(row.root_id)
    || row.root_id <= 0
    || !Number.isSafeInteger(row.depth)
    || row.depth < 0
    || row.depth > 6
    || !Number.isSafeInteger(row.product_count)
    || row.product_count < 0
  ) {
    return null;
  }

  const sourceUrl = safeUrl(row.source_url, definition.categoryUrlRules);
  if (!sourceUrl) return null;

  const parentId = row.parent_id === null
    ? null
    : Number.isSafeInteger(row.parent_id) && row.parent_id > 0
      ? row.parent_id
      : null;

  return Object.freeze({
    categoryId: row.category_id,
    name: row.name.trim(),
    parentId,
    rootId: row.root_id,
    depth: row.depth,
    productCount: row.product_count,
    sourceUrl
  });
}

export function createRetailCatalogClient(options = {}) {
  const endpoint = options.endpoint ?? RETAIL_CATALOG_ENDPOINT;
  const categoryEndpoint = options.categoryEndpoint ?? RETAIL_CATEGORY_ENDPOINT;
  const publishableKey =
    options.publishableKey ?? CATALOG_SEARCH_PUBLISHABLE_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? RETAIL_CATALOG_TIMEOUT_MS;
  const definition = resolveDefinition(options.retailerId ?? "globus");

  async function requestRows({
    query = null,
    categoryId = null,
    limit = 24
  } = {}) {
    if (
      !definition
      || (query !== null && !query)
      || (categoryId !== null && (
        !Number.isSafeInteger(categoryId)
        || categoryId <= 0
      ))
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
    url.searchParams.set("retailer_id", `eq.${definition.retailerId}`);
    url.searchParams.set("store_id", `eq.${definition.storeId}`);
    url.searchParams.set("locality_id", `eq.${definition.localityId}`);
    url.searchParams.set("active", "eq.true");
    if (query !== null) {
      url.searchParams.set("name", `ilike.*${query}*`);
    }
    if (categoryId !== null) {
      url.searchParams.set("main_category_id", `eq.${categoryId}`);
    }
    url.searchParams.set(
      "order",
      categoryId === null ? "updated_at.desc" : "name.asc"
    );
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

      const products = payload
        .map((row) => normalizeRetailRow(row, definition))
        .filter(Boolean);
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

  async function requestCategories({
    parentId = null,
    rootsOnly = false,
    limit = 160
  } = {}) {
    if (
      !definition
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > 200
      || (parentId !== null && (
        !Number.isSafeInteger(parentId)
        || parentId <= 0
      ))
    ) {
      return result("error", { code: "invalid_request" });
    }
    if (typeof fetchImpl !== "function") {
      return result("unavailable", { code: "transport_unconfigured" });
    }

    let url;
    try {
      url = new URL(categoryEndpoint);
    } catch {
      return result("unavailable", { code: "transport_unconfigured" });
    }
    if (url.protocol !== "https:") {
      return result("unavailable", { code: "transport_unconfigured" });
    }

    url.searchParams.set(
      "select",
      "retailer_id,store_id,category_id,name,parent_id,root_id,depth,source_url,product_count"
    );
    url.searchParams.set("retailer_id", `eq.${definition.retailerId}`);
    url.searchParams.set("store_id", `eq.${definition.storeId}`);
    url.searchParams.set("active", "eq.true");
    if (rootsOnly) {
      url.searchParams.set("depth", "eq.0");
    } else if (parentId !== null) {
      url.searchParams.set("parent_id", `eq.${parentId}`);
    }
    url.searchParams.set("order", "name.asc");
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

      const categories = payload
        .map((row) => normalizeRetailCategory(row, definition))
        .filter(Boolean);
      return result("categories", {
        categories: Object.freeze(categories),
        partial: categories.length !== payload.length
      });
    } catch {
      return result("unavailable", { code: "transport_unavailable" });
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    definition,
    async search(query, searchOptions = {}) {
      const normalizedQuery = cleanQuery(query);
      if (!normalizedQuery) {
        return result("error", { code: "invalid_request" });
      }
      return requestRows({
        query: normalizedQuery,
        limit: searchOptions.limit ?? 24
      });
    },
    async browse(browseOptions = {}) {
      return requestRows({
        query: null,
        limit: browseOptions.limit ?? 24
      });
    },
    async browseCategory(categoryId, browseOptions = {}) {
      return requestRows({
        query: null,
        categoryId,
        limit: browseOptions.limit ?? 40
      });
    },
    async rootCategories(categoryOptions = {}) {
      return requestCategories({
        rootsOnly: true,
        limit: categoryOptions.limit ?? 40
      });
    },
    async subcategories(parentId, categoryOptions = {}) {
      return requestCategories({
        parentId,
        limit: categoryOptions.limit ?? 160
      });
    }
  });
}

const defaultClient = createRetailCatalogClient();

export async function requestRetailCatalogSearch(query, options) {
  return defaultClient.search(query, options);
}

export async function requestRetailCatalogBrowse(options) {
  return defaultClient.browse(options);
}

export async function requestRetailCategoryProducts(categoryId, options) {
  return defaultClient.browseCategory(categoryId, options);
}

export async function requestRetailRootCategories(options) {
  return defaultClient.rootCategories(options);
}

export async function requestRetailSubcategories(parentId, options) {
  return defaultClient.subcategories(parentId, options);
}

export {
  cleanQuery,
  normalizeRetailCategory,
  normalizeRetailRow,
  readBoundedJsonResponse
};
