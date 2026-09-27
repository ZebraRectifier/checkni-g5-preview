import { getCanonicalProduct } from "../data/canonicalProductRegistry.mjs";
import { getRetailerIdentity } from "../data/retailerRegistry.mjs";
import {
  MATCH_METHOD,
  MATCH_STATUS,
  createProductMatch
} from "../matching/productMatch.mjs";
import { getSensorSource } from "../sensors/sourceRegistry.mjs";

export const CATALOG_PRODUCT_KIND = "catalog-product";
export const DEFAULT_CATALOG_SEARCH_LIMIT = 30;
export const MAX_CATALOG_SEARCH_LIMIT = 100;
export const MAX_CATALOG_SEARCH_QUERY_LENGTH = 160;

const ALLOWED_FIELDS = new Set([
  "sourceId",
  "retailerId",
  "sourceProductId",
  "name",
  "unit",
  "category",
  "sourceUrl",
  "match",
  "canonicalIdentity"
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "apikey",
  "api_key",
  "auth",
  "authorization",
  "cookie",
  "jwt",
  "key",
  "password",
  "secret",
  "session",
  "sessionid",
  "session_id",
  "sig",
  "signature",
  "token"
]);

function cleanString(value, { required = false, max = 240 } = {}) {
  if (value == null || value === "") return required ? null : undefined;
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reject(reason) {
  return Object.freeze({ kind: "rejected", reason });
}

function resolveAuthority(input) {
  const sourceId = cleanString(input.sourceId, { max: 80 });
  const retailerId = cleanString(input.retailerId, { max: 80 });

  if (input.sourceId != null && !sourceId) return reject("invalid_source");
  if (input.retailerId != null && !retailerId) return reject("invalid_retailer");

  const source = sourceId ? getSensorSource(sourceId) : null;
  const retailer = retailerId ? getRetailerIdentity(retailerId) : null;

  if (sourceId && !source) return reject("unknown_source");
  if (retailerId && !retailer) return reject("unknown_retailer");
  if (!source && !retailer) return reject("missing_authority");

  return Object.freeze({
    kind: "accepted",
    sourceId: source?.id ?? null,
    sourceName: source?.name ?? null,
    retailerId: retailer?.id ?? null,
    retailerName: retailer?.name ?? null,
    allowedOrigins: Object.freeze(
      source
        ? [source.origin]
        : [new URL(retailer.identitySourceUrl).origin]
    )
  });
}

function normalizeSourceUrl(rawUrl, allowedOrigins) {
  if (typeof rawUrl !== "string") return null;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!allowedOrigins.includes(parsed.origin)) return null;

  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) return null;
  }

  return parsed.href;
}

function normalizedCanonicalIdentity(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (!Object.keys(input).every((key) => ["id", "name", "unit"].includes(key))) {
    return null;
  }

  const id = cleanString(input.id, { required: true, max: 180 });
  const name = cleanString(input.name, { required: true, max: 240 });
  const unit = cleanString(input.unit, { required: true, max: 120 });
  if (!id || !name || !unit) return null;

  return Object.freeze({ id, name, unit });
}

function normalizeMatch(inputMatch, {
  sourceId,
  sourceProductId,
  sourceProductName,
  sourceUnit,
  canonicalIdentity: inputCanonicalIdentity
}) {
  if (inputMatch == null) {
    if (inputCanonicalIdentity != null) return reject("invalid_canonical_identity");
    return Object.freeze({
      kind: "accepted",
      match: null,
      canonicalIdentity: null,
      comparisonEligible: false
    });
  }

  if (!sourceId) return reject("match_requires_source");
  if (!inputMatch || typeof inputMatch !== "object" || Array.isArray(inputMatch)) {
    return reject("invalid_match");
  }

  const validated = createProductMatch(inputMatch);
  if (validated.kind !== "accepted") return reject("invalid_match");

  const match = validated.match;
  if (
    match.sourceId !== sourceId
    || match.sourceProductId !== sourceProductId
    || match.sourceProductName !== sourceProductName
  ) {
    return reject("match_identity_mismatch");
  }

  const staticCanonical = getCanonicalProduct(match.canonicalProductId);
  if (staticCanonical) {
    if (inputCanonicalIdentity != null) {
      const supplied = normalizedCanonicalIdentity(inputCanonicalIdentity);
      if (
        !supplied
        || supplied.id !== staticCanonical.id
        || supplied.name !== staticCanonical.name
        || supplied.unit !== staticCanonical.unit
      ) {
        return reject("canonical_identity_mismatch");
      }
    }

    return Object.freeze({
      kind: "accepted",
      match,
      canonicalIdentity: Object.freeze({
        id: staticCanonical.id,
        name: staticCanonical.name,
        unit: staticCanonical.unit
      }),
      comparisonEligible: match.status === MATCH_STATUS.CONFIRMED
    });
  }

  if (
    match.method !== MATCH_METHOD.BARCODE
    || match.status !== MATCH_STATUS.CONFIRMED
  ) {
    return reject("unknown_canonical_product");
  }

  const dynamicCanonical = normalizedCanonicalIdentity(inputCanonicalIdentity);
  if (
    !dynamicCanonical
    || dynamicCanonical.id !== match.canonicalProductId
    || !sourceUnit
    || dynamicCanonical.unit !== sourceUnit
  ) {
    return reject("invalid_canonical_identity");
  }

  return Object.freeze({
    kind: "accepted",
    match,
    canonicalIdentity: dynamicCanonical,
    comparisonEligible: true
  });
}

export function createCatalogProduct(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return reject("invalid_shape");
  }
  if (!Object.keys(input).every((key) => ALLOWED_FIELDS.has(key))) {
    return reject("invalid_shape");
  }

  const authority = resolveAuthority(input);
  if (authority.kind !== "accepted") return authority;

  const sourceProductId = cleanString(input.sourceProductId, {
    required: true,
    max: 180
  });
  const name = cleanString(input.name, { required: true, max: 240 });
  const unit = cleanString(input.unit, { max: 120 });
  const category = cleanString(input.category, { max: 160 });

  if (!sourceProductId || !name) {
    return reject("invalid_product_identity");
  }
  if (input.unit != null && !unit) return reject("invalid_product_identity");
  if (input.category != null && !category) return reject("invalid_product_identity");

  const sourceUrl = normalizeSourceUrl(input.sourceUrl, authority.allowedOrigins);
  if (!sourceUrl) return reject("invalid_source_url");

  const normalizedMatch = normalizeMatch(input.match, {
    sourceId: authority.sourceId,
    sourceProductId,
    sourceProductName: name,
    sourceUnit: unit ?? null,
    canonicalIdentity: input.canonicalIdentity
  });
  if (normalizedMatch.kind !== "accepted") return normalizedMatch;

  return Object.freeze({
    kind: "accepted",
    product: Object.freeze({
      kind: CATALOG_PRODUCT_KIND,
      sourceId: authority.sourceId,
      sourceName: authority.sourceName,
      retailerId: authority.retailerId,
      retailerName: authority.retailerName,
      sourceProductId,
      name,
      unit: unit ?? null,
      category: category ?? null,
      sourceUrl,
      canonicalProductId: normalizedMatch.canonicalIdentity?.id ?? null,
      canonicalIdentity: normalizedMatch.canonicalIdentity,
      match: normalizedMatch.match,
      comparisonEligible: normalizedMatch.comparisonEligible
    })
  });
}

function assertCatalogProduct(product) {
  if (
    !product
    || product.kind !== CATALOG_PRODUCT_KIND
    || typeof product.sourceProductId !== "string"
    || typeof product.name !== "string"
  ) {
    throw new TypeError("catalog search requires validated catalog products");
  }
}

function authorityKey(product) {
  return [
    product.sourceId ?? "",
    product.retailerId ?? "",
    product.sourceProductId
  ].join("|");
}

function searchScore(query, tokens, product) {
  const name = normalizeSearchText(product.name);
  const haystack = normalizeSearchText([
    product.name,
    product.unit,
    product.category,
    product.retailerName,
    product.sourceName
  ].filter(Boolean).join(" "));

  if (!haystack) return -1;

  const phraseMatch = haystack.includes(query);
  const allTokensMatch = tokens.every((token) => haystack.includes(token));
  if (!phraseMatch && !allTokensMatch) return -1;

  let score = 0;
  if (name === query) score += 200;
  else if (name.startsWith(query)) score += 120;
  else if (name.includes(query)) score += 90;
  else if (phraseMatch) score += 60;

  score += tokens.reduce(
    (sum, token) => sum + (name.includes(token) ? 12 : 4),
    0
  );

  if (product.comparisonEligible === true) score += 1;
  return score;
}

export function searchCatalogProducts(query, products, options = {}) {
  if (!Array.isArray(products)) {
    throw new TypeError("catalog search products must be an array");
  }

  const rawLimit = options.limit ?? DEFAULT_CATALOG_SEARCH_LIMIT;
  if (
    !Number.isInteger(rawLimit)
    || rawLimit < 1
    || rawLimit > MAX_CATALOG_SEARCH_LIMIT
  ) {
    throw new TypeError("catalog search limit is invalid");
  }

  if (typeof query !== "string" || query.length > MAX_CATALOG_SEARCH_QUERY_LENGTH) {
    return [];
  }

  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const tokens = normalizedQuery.split(" ");

  const byAuthority = new Map();

  for (const product of products) {
    assertCatalogProduct(product);

    const score = searchScore(normalizedQuery, tokens, product);
    if (score < 0) continue;

    const key = authorityKey(product);
    const current = byAuthority.get(key);
    if (
      !current
      || score > current.score
      || (
        score === current.score
        && product.comparisonEligible
        && !current.product.comparisonEligible
      )
    ) {
      byAuthority.set(key, { product, score });
    }
  }

  return Array.from(byAuthority.values())
    .sort((left, right) => (
      right.score - left.score
      || left.product.name.localeCompare(right.product.name, "ru")
      || authorityKey(left.product).localeCompare(authorityKey(right.product), "en")
    ))
    .slice(0, rawLimit)
    .map(({ product }) => product);
}

export function buildAiCatalogHints(products, options = {}) {
  if (!Array.isArray(products)) {
    throw new TypeError("AI catalog hints require an array");
  }

  const rawLimit = options.limit ?? 50;
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
    throw new TypeError("AI catalog hint limit is invalid");
  }

  const canonicalById = new Map();

  for (const product of products) {
    assertCatalogProduct(product);
    if (
      product.comparisonEligible !== true
      || product.match?.status !== MATCH_STATUS.CONFIRMED
      || typeof product.canonicalProductId !== "string"
      || !product.canonicalIdentity
    ) {
      continue;
    }

    const existing = canonicalById.get(product.canonicalProductId);
    if (
      existing
      && (
        existing.name !== product.canonicalIdentity.name
        || existing.unit !== product.canonicalIdentity.unit
      )
    ) {
      throw new TypeError("conflicting canonical identity metadata");
    }

    canonicalById.set(product.canonicalProductId, product.canonicalIdentity);
  }

  return Array.from(canonicalById.values())
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .slice(0, rawLimit)
    .map((canonical) => Object.freeze({
      id: canonical.id,
      name: canonical.name,
      unit: canonical.unit
    }));
}
