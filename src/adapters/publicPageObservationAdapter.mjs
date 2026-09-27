import { getRetailerIdentity } from "../data/retailerRegistry.mjs";
import { getSensorSource } from "../sensors/sourceRegistry.mjs";

export const PUBLIC_PAGE_OBSERVATION_KIND = "public-page-observation";

export const OBSERVATION_GRANULARITY = Object.freeze({
  UNKNOWN: "unknown",
  PAGE: "page",
  REGION: "region",
  CITY: "city",
  LOCATION: "location",
  EXACT_STORE: "exact-store"
});

export const OBSERVED_AVAILABILITY = Object.freeze({
  UNKNOWN: "unknown"
});

export const OBSERVED_SALES_CHANNEL = Object.freeze({
  ONLINE: "online",
  STORE: "store",
  UNKNOWN: "unknown"
});

const TOP_LEVEL_FIELDS = new Set([
  "kind",
  "sourceId",
  "sourceUrl",
  "observedAt",
  "product",
  "priceMinor",
  "currency",
  "minimumQuantity",
  "granularity",
  "context",
  "availability",
  "salesChannel"
]);

const PRODUCT_FIELDS = new Set([
  "sourceProductId",
  "canonicalProductId",
  "name"
]);

const CONTEXT_FIELDS = new Set([
  "countryCode",
  "regionId",
  "regionName",
  "localityId",
  "localityName",
  "locationId",
  "locationLabel",
  "retailerId",
  "storeId",
  "storeName"
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "apikey",
  "api_key",
  "auth",
  "authorization",
  "cookie",
  "jwt",
  "session",
  "sessionid",
  "session_id",
  "token"
]);

function hasOnlyFields(value, allowedFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => allowedFields.has(key));
}

function cleanText(value, { required = false, maxLength = 240 } = {}) {
  if (value == null || value === "") return required ? null : undefined;
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function parsePublicSourceUrl(rawUrl, source) {
  if (typeof rawUrl !== "string") return null;

  let url;
  let registered;
  try {
    url = new URL(rawUrl);
    registered = new URL(source.publicUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.origin !== registered.origin) return null;
  if (url.username || url.password) return null;

  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) return null;
  }

  return url.href;
}

function normalizeProduct(product) {
  if (!hasOnlyFields(product, PRODUCT_FIELDS)) return null;

  const sourceProductId = cleanText(product.sourceProductId, { maxLength: 160 });
  const canonicalProductId = cleanText(product.canonicalProductId, { maxLength: 160 });
  const name = cleanText(product.name, { required: true, maxLength: 240 });

  if (!name) return null;
  if (product.sourceProductId != null && !sourceProductId) return null;
  if (product.canonicalProductId != null && !canonicalProductId) return null;

  return Object.freeze({
    sourceProductId,
    canonicalProductId,
    name
  });
}

function normalizeCountryCode(value) {
  if (value == null || value === "") return undefined;
  const normalized = cleanText(value, { maxLength: 2 });
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

function normalizeSalesChannel(value) {
  if (value == null) return OBSERVED_SALES_CHANNEL.UNKNOWN;
  return Object.values(OBSERVED_SALES_CHANNEL).includes(value) ? value : null;
}

function normalizeMinimumQuantity(value) {
  if (value === undefined) return 1;
  if (value === null) return null;
  return Number.isSafeInteger(value) && value > 0 && value <= 99
    ? value
    : undefined;
}

function emptyContext() {
  return Object.freeze({
    countryCode: undefined,
    regionId: undefined,
    regionName: undefined,
    localityId: undefined,
    localityName: undefined,
    locationId: undefined,
    locationLabel: undefined,
    retailerId: undefined,
    storeId: undefined,
    storeName: undefined
  });
}

function normalizeContext(context, granularity) {
  if (context == null) {
    return (
      granularity === OBSERVATION_GRANULARITY.PAGE
      || granularity === OBSERVATION_GRANULARITY.UNKNOWN
    )
      ? emptyContext()
      : null;
  }

  if (!hasOnlyFields(context, CONTEXT_FIELDS)) return null;

  const countryCode = normalizeCountryCode(context.countryCode);
  const regionId = cleanText(context.regionId, { maxLength: 180 });
  const regionName = cleanText(context.regionName, { maxLength: 240 });
  const localityId = cleanText(context.localityId, { maxLength: 180 });
  const localityName = cleanText(context.localityName, { maxLength: 240 });
  const locationId = cleanText(context.locationId, { maxLength: 180 });
  const locationLabel = cleanText(context.locationLabel, { maxLength: 240 });
  const retailerId = cleanText(context.retailerId, { maxLength: 80 });
  const storeId = cleanText(context.storeId, { maxLength: 160 });
  const storeName = cleanText(context.storeName, { maxLength: 240 });

  if (context.countryCode != null && !countryCode) return null;
  if (context.regionId != null && !regionId) return null;
  if (context.regionName != null && !regionName) return null;
  if (context.localityId != null && !localityId) return null;
  if (context.localityName != null && !localityName) return null;
  if (context.locationId != null && !locationId) return null;
  if (context.locationLabel != null && !locationLabel) return null;
  if (context.retailerId != null && !retailerId) return null;
  if (context.storeId != null && !storeId) return null;
  if (context.storeName != null && !storeName) return null;

  const hasRegionId = Boolean(regionId);
  const hasRegionName = Boolean(regionName);
  const hasLocalityId = Boolean(localityId);
  const hasLocalityName = Boolean(localityName);

  if (hasRegionId !== hasRegionName) return null;
  if (hasLocalityId !== hasLocalityName) return null;
  if ((hasRegionId || hasLocalityId) && !countryCode) return null;
  if (hasLocalityId && !hasRegionId) return null;

  const displayLocationLabel = locationLabel ?? localityName ?? regionName;

  if (
    (
      granularity === OBSERVATION_GRANULARITY.LOCATION
      || granularity === OBSERVATION_GRANULARITY.CITY
      || granularity === OBSERVATION_GRANULARITY.REGION
    )
    && !displayLocationLabel
  ) {
    return null;
  }

  if (
    granularity === OBSERVATION_GRANULARITY.EXACT_STORE
    && (!storeId || !storeName)
  ) {
    return null;
  }

  return Object.freeze({
    countryCode,
    regionId,
    regionName,
    localityId,
    localityName,
    locationId,
    locationLabel: displayLocationLabel,
    retailerId,
    storeId,
    storeName
  });
}

export function validatePublicPageObservation(input, options = {}) {
  if (!hasOnlyFields(input, TOP_LEVEL_FIELDS)) {
    return Object.freeze({ kind: "rejected", reason: "invalid_shape" });
  }

  if (input.kind !== PUBLIC_PAGE_OBSERVATION_KIND) {
    return Object.freeze({ kind: "rejected", reason: "invalid_kind" });
  }

  const sourceResolver = typeof options.sourceResolver === "function"
    ? options.sourceResolver
    : getSensorSource;
  const source = sourceResolver(input.sourceId);
  if (!source) {
    return Object.freeze({ kind: "rejected", reason: "unknown_source" });
  }

  const sourceUrl = parsePublicSourceUrl(input.sourceUrl, source);
  if (!sourceUrl) {
    return Object.freeze({ kind: "rejected", reason: "invalid_source_url" });
  }

  const observedAtMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    return Object.freeze({ kind: "rejected", reason: "invalid_observed_at" });
  }

  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0) {
    return Object.freeze({ kind: "rejected", reason: "invalid_price" });
  }

  if (input.currency !== "RUB") {
    return Object.freeze({ kind: "rejected", reason: "unsupported_currency" });
  }

  if (!Object.values(OBSERVATION_GRANULARITY).includes(input.granularity)) {
    return Object.freeze({ kind: "rejected", reason: "invalid_granularity" });
  }

  if (input.availability !== OBSERVED_AVAILABILITY.UNKNOWN) {
    return Object.freeze({ kind: "rejected", reason: "unsupported_availability" });
  }

  const salesChannel = normalizeSalesChannel(input.salesChannel);
  if (!salesChannel) {
    return Object.freeze({ kind: "rejected", reason: "invalid_sales_channel" });
  }

  const minimumQuantity = normalizeMinimumQuantity(input.minimumQuantity);
  if (minimumQuantity === undefined) {
    return Object.freeze({ kind: "rejected", reason: "invalid_minimum_quantity" });
  }

  const product = normalizeProduct(input.product);
  if (!product) {
    return Object.freeze({ kind: "rejected", reason: "invalid_product" });
  }

  const context = normalizeContext(input.context, input.granularity);
  if (!context) {
    return Object.freeze({ kind: "rejected", reason: "invalid_context" });
  }

  if (context.retailerId && !getRetailerIdentity(context.retailerId)) {
    return Object.freeze({ kind: "rejected", reason: "unknown_retailer" });
  }

  return Object.freeze({
    kind: "accepted",
    observation: Object.freeze({
      kind: PUBLIC_PAGE_OBSERVATION_KIND,
      sourceId: source.id,
      sourceUrl,
      observedAt: new Date(observedAtMs).toISOString(),
      product,
      priceMinor: input.priceMinor,
      currency: "RUB",
      minimumQuantity,
      granularity: input.granularity,
      context,
      availability: OBSERVED_AVAILABILITY.UNKNOWN,
      salesChannel
    })
  });
}

export function isObservationFresh(
  observation,
  { nowMs = Date.now(), maxAgeMs } = {}
) {
  if (
    !observation
    || observation.kind !== PUBLIC_PAGE_OBSERVATION_KIND
    || !Number.isFinite(nowMs)
    || !Number.isFinite(maxAgeMs)
    || maxAgeMs < 0
  ) {
    return false;
  }

  const observedAtMs = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAtMs) || observedAtMs > nowMs) return false;

  return nowMs - observedAtMs <= maxAgeMs;
}
