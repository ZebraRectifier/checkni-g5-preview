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
    rootCategoryUrlProductFallback: true,
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
  magnit: Object.freeze({
    retailerId: "magnit",
    storeId: "magnit-771878",
    storeName: "Магнит · Москва, Дмитровское ш. 5 к 1",
    localityId: "city-moscow",
    localityName: "Москва",
    displayName: "Магнит",
    catalogLabel: "Магнит · Москва",
    scopeLabel: "Москва · публичный магазин · наличие неизвестно",
    logo: "М",
    defaultProductCount: 515,
    rootCategoryCount: 18,
    productUrlRules: Object.freeze([
      Object.freeze({ host: "magnit.ru", prefix: "/product/" }),
      Object.freeze({ host: "www.magnit.ru", prefix: "/product/" })
    ]),
    imageUrlRules: Object.freeze([
      Object.freeze({ host: "images-foodtech.magnit.ru", prefix: "/" })
    ]),
    categoryUrlRules: Object.freeze([
      Object.freeze({ host: "magnit.ru", prefix: "/catalog" }),
      Object.freeze({ host: "www.magnit.ru", prefix: "/catalog" })
    ]),
    sourceUrlRules: Object.freeze([
      Object.freeze({ host: "magnit.ru", prefix: "/product/" }),
      Object.freeze({ host: "www.magnit.ru", prefix: "/product/" }),
      Object.freeze({ host: "magnit.ru", prefix: "/catalog" }),
      Object.freeze({ host: "www.magnit.ru", prefix: "/catalog" })
    ]),
    priceConditionLabels: Object.freeze({
      "public-online": "Публичная онлайн-цена"
    })
  }),
  vkusvill: Object.freeze({
    retailerId: "vkusvill",
    storeId: "vkusvill-public-web",
    storeName: "ВкусВилл · публичный каталог",
    localityId: "country-ru-public-catalog",
    localityName: "Россия",
    displayName: "ВкусВилл",
    catalogLabel: "ВкусВилл · публичный каталог",
    scopeLabel: "Публичный каталог · цена может зависеть от региона · наличие неизвестно",
    logo: "В",
    defaultProductCount: 697,
    rootCategoryCount: 17,
    productUrlRules: Object.freeze([
      Object.freeze({ host: "vkusvill.ru", prefix: "/goods/" }),
      Object.freeze({ host: "www.vkusvill.ru", prefix: "/goods/" })
    ]),
    imageUrlRules: Object.freeze([
      Object.freeze({ host: "img.vkusvill.ru", prefix: "/" })
    ]),
    categoryUrlRules: Object.freeze([
      Object.freeze({ host: "vkusvill.ru", prefix: "/goods/" }),
      Object.freeze({ host: "www.vkusvill.ru", prefix: "/goods/" })
    ]),
    sourceUrlRules: Object.freeze([
      Object.freeze({ host: "vkusvill.ru", prefix: "/goods/" }),
      Object.freeze({ host: "www.vkusvill.ru", prefix: "/goods/" })
    ]),
    priceConditionLabels: Object.freeze({
      "public-online": "Публичная цена сайта",
      "loyalty-vkusvill": "По карте ВкусВилл",
      "promo": "Акционная цена сайта"
    })
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
    defaultProductCount: 64,
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
  }),
  perekrestok: Object.freeze({
    retailerId: "perekrestok",
    storeId: "perekrestok-yandex-3186917",
    storeName:
      "Перекрёсток · Москва, Большой Овчинниковский пер. 16 · Яндекс Еда",
    localityId: "city-moscow",
    localityName: "Москва",
    displayName: "Перекрёсток",
    catalogLabel: "Перекрёсток · Москва · Яндекс Еда",
    scopeLabel: "Москва · цены доставки Яндекс Еды · наличие неизвестно",
    logo: "П",
    defaultProductCount: 5460,
    rootCategoryCount: 58,
    productUrlRules: Object.freeze([
      Object.freeze({ host: "eda.yandex.ru", prefix: "/retail/perekrestok" })
    ]),
    imageUrlRules: Object.freeze([
      Object.freeze({ host: "avatars.mds.yandex.net", prefix: "/get-eda/" }),
      Object.freeze({ host: "eda.yandex", prefix: "/images/" })
    ]),
    categoryUrlRules: Object.freeze([
      Object.freeze({ host: "eda.yandex.ru", prefix: "/retail/perekrestok" })
    ]),
    sourceUrlRules: Object.freeze([
      Object.freeze({ host: "eda.yandex.ru", prefix: "/retail/perekrestok" })
    ]),
    priceConditionLabels: Object.freeze({
      "yandex-eda-regular": "Цена доставки Яндекс Еды",
      "yandex-eda-promo": "Промо-цена доставки Яндекс Еды"
    })
  }),
  da: Object.freeze({
    retailerId: "da",
    storeId: "da-public-promo",
    storeName: "ДА! · публичный промо-каталог",
    localityId: "network-da-public-promo",
    localityName: "Сеть ДА!",
    displayName: "ДА!",
    catalogLabel: "ДА! · текущий промо-каталог",
    scopeLabel: "Промо 1–14 октября · наличие зависит от магазина",
    logo: "Д",
    defaultProductCount: 94,
    rootCategoryCount: 1,
    catalogValidFrom: "2026-10-01",
    catalogValidTo: "2026-10-14",
    requiresPromoValidity: true,
    productUrlRules: Object.freeze([
      Object.freeze({ host: "market-da.ru", prefix: "/sale.html" })
    ]),
    imageUrlRules: Object.freeze([
      Object.freeze({ host: "market-da.ru", prefix: "/assets/" })
    ]),
    categoryUrlRules: Object.freeze([
      Object.freeze({ host: "market-da.ru", prefix: "/sale.html" })
    ]),
    sourceUrlRules: Object.freeze([
      Object.freeze({ host: "market-da.ru", prefix: "/sale.html" })
    ]),
    priceConditionLabels: Object.freeze({
      "public-promo": "Промо-цена каталога"
    })
  })
});

function validDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}

function moscowDateKey(nowMs = Date.now()) {
  if (!Number.isFinite(nowMs)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year && values.month && values.day
    ? `${values.year}-${values.month}-${values.day}`
    : null;
}

function definitionIsCurrent(definition, nowMs = Date.now()) {
  if (!definition?.catalogValidFrom && !definition?.catalogValidTo) return true;
  const today = moscowDateKey(nowMs);
  const validFrom = validDateKey(definition.catalogValidFrom);
  const validTo = validDateKey(definition.catalogValidTo);
  return Boolean(
    today
    && validFrom
    && validTo
    && validFrom <= validTo
    && today >= validFrom
    && today <= validTo
  );
}

export const RETAIL_CATALOG_IDS = Object.freeze(
  Object.keys(RETAIL_CATALOG_DEFINITIONS)
    .filter((retailerId) => definitionIsCurrent(RETAIL_CATALOG_DEFINITIONS[retailerId]))
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
  "minimum_quantity",
  "quantity_semantics",
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

function promoTruth(row, definition, nowMs = Date.now()) {
  if (!definition?.requiresPromoValidity) return Object.freeze({
    conditionSuffixes: Object.freeze([])
  });

  const semantics = row?.quantity_semantics;
  if (
    !semantics
    || typeof semantics !== "object"
    || Array.isArray(semantics)
  ) {
    return null;
  }

  const validFrom = validDateKey(semantics.promo_valid_from);
  const validTo = validDateKey(semantics.promo_valid_to);
  const today = moscowDateKey(nowMs);
  if (
    !validFrom
    || !validTo
    || validFrom > validTo
    || !today
    || today < validFrom
    || today > validTo
  ) {
    return null;
  }

  const minimumQuantity = row.minimum_quantity;
  if (!Number.isSafeInteger(minimumQuantity) || minimumQuantity < 1) {
    return null;
  }

  const suffixes = [];
  if (semantics.kind === "multibuy") {
    if (
      minimumQuantity < 2
      || semantics.minimum_quantity !== minimumQuantity
    ) {
      return null;
    }
    suffixes.push(`при покупке ${minimumQuantity} шт.`);
  } else if (semantics.kind === "weight-basis") {
    if (
      minimumQuantity !== 1
      || !Number.isSafeInteger(semantics.basis_grams)
      || semantics.basis_grams < 1
    ) {
      return null;
    }
    suffixes.push(`за ${semantics.basis_grams} г`);
  } else if (semantics.kind !== undefined) {
    return null;
  } else if (minimumQuantity !== 1) {
    return null;
  }

  suffixes.push(`до ${validTo.slice(8, 10)}.${validTo.slice(5, 7)}`);
  return Object.freeze({
    validFrom,
    validTo,
    minimumQuantity,
    conditionSuffixes: Object.freeze(suffixes)
  });
}

function normalizeRetailRow(row, retailer = "globus", options = {}) {
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
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const promo = promoTruth(row, definition, nowMs);
  if (
    !productUrl
    || !sourceUrl
    || !Number.isFinite(observedMs)
    || !promo
  ) {
    return null;
  }

  const priceCondition = typeof row.price_condition === "string"
    ? row.price_condition
    : "unknown";
  const basePriceConditionLabel =
    definition.priceConditionLabels[priceCondition] ?? null;
  const conditionParts = [
    basePriceConditionLabel,
    ...promo.conditionSuffixes
  ].filter(Boolean);
  const priceConditionLabel = conditionParts.length > 0
    ? conditionParts.join(" · ")
    : null;

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
  const normalizeOptions = Number.isFinite(options.nowMs)
    ? Object.freeze({ nowMs: options.nowMs })
    : undefined;

  async function requestRows({
    query = null,
    categoryId = null,
    categoryUrlPrefix = null,
    limit = 24,
    offset = 0
  } = {}) {
    if (
      !definition
      || (query !== null && !query)
      || (categoryId !== null && (
        !Number.isSafeInteger(categoryId)
        || categoryId <= 0
      ))
      || (categoryUrlPrefix !== null && (
        typeof categoryUrlPrefix !== "string"
        || categoryUrlPrefix.length === 0
        || categoryUrlPrefix.length > 500
      ))
      || (categoryId !== null && categoryUrlPrefix !== null)
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > MAX_RETAIL_CATALOG_PRODUCTS
      || !Number.isSafeInteger(offset)
      || offset < 0
      || offset > 10_000
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
    if (categoryUrlPrefix !== null) {
      url.searchParams.set("category_url", `like.${categoryUrlPrefix}*`);
    }
    url.searchParams.set(
      "order",
      categoryId === null && categoryUrlPrefix === null
        ? "updated_at.desc"
        : "name.asc,source_product_id.asc"
    );
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

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
        .map((row) => normalizeRetailRow(row, definition, normalizeOptions))
        .filter(Boolean);
      return result("catalog", {
        products: Object.freeze(products),
        partial: products.length !== payload.length,
        nextOffset: offset + payload.length,
        pageSize: payload.length
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
    async browseCategory(categoryRef, browseOptions = {}) {
      const categoryId = Number.isSafeInteger(categoryRef)
        ? categoryRef
        : categoryRef?.categoryId;
      const useRootSourceFallback = Boolean(
        definition?.rootCategoryUrlProductFallback
        && categoryRef
        && typeof categoryRef === "object"
        && categoryRef.depth === 0
      );
      let categoryUrlPrefix = null;
      if (useRootSourceFallback) {
        categoryUrlPrefix = safeUrl(
          categoryRef.sourceUrl,
          definition.categoryUrlRules
        );
        if (!categoryUrlPrefix) {
          return result("error", { code: "invalid_request" });
        }
      }
      return requestRows({
        query: null,
        categoryId: useRootSourceFallback ? null : categoryId,
        categoryUrlPrefix,
        limit: browseOptions.limit ?? 40,
        offset: browseOptions.offset ?? 0
      });
    },
    async rootCategories(categoryOptions = {}) {
      const defaultRootLimit = Number.isSafeInteger(definition?.rootCategoryCount)
        ? Math.min(160, Math.max(40, definition.rootCategoryCount))
        : 40;
      return requestCategories({
        rootsOnly: true,
        limit: categoryOptions.limit ?? defaultRootLimit
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
