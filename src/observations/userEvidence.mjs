import {
  OBSERVATION_GRANULARITY,
  OBSERVED_AVAILABILITY
} from "../adapters/publicPageObservationAdapter.mjs";
import {
  MATCH_METHOD,
  MATCH_STATUS
} from "../matching/productMatch.mjs";

export const USER_EVIDENCE_KIND = "user-evidence-observation";
export const USER_EVIDENCE_SOURCE_ID = "community-evidence";

export const USER_EVIDENCE_TYPE = Object.freeze({
  RECEIPT: "receipt",
  DIGITAL_RECEIPT: "digital-receipt",
  SHELF_PRICE_TAG: "shelf-price-tag",
  BARCODE_CONFIRMATION: "barcode-confirmation",
  MANUAL_PRICE_CONFIRMATION: "manual-price-confirmation"
});

export const USER_EVIDENCE_PRICE_CONDITION = Object.freeze({
  REGULAR: "regular",
  LOYALTY: "loyalty",
  PROMO: "promo",
  UNKNOWN: "unknown"
});

export const COMMUNITY_EVIDENCE_SOURCE = Object.freeze({
  id: USER_EVIDENCE_SOURCE_ID,
  name: "CHECKNI community evidence",
  capabilities: Object.freeze({
    manualHandoff: false,
    publicPageResearch: false,
    automatedObservation: false,
    openDataRead: false,
    historicalPriceRead: false,
    exactStoreContext: true,
    stockObservation: false,
    basketPrefill: false,
    checkout: false
  })
});

const TOP_LEVEL_FIELDS = new Set([
  "kind",
  "evidenceId",
  "evidenceType",
  "proofRef",
  "consent",
  "observedAt",
  "product",
  "priceMinor",
  "currency",
  "granularity",
  "context",
  "priceCondition",
  "conditionNote",
  "availability"
]);

const PRODUCT_FIELDS = new Set([
  "canonicalProductId",
  "barcode",
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
  "storeId",
  "storeName"
]);

const CONSENT_FIELDS = new Set([
  "granted",
  "capturedAt"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyFields(value, allowedFields) {
  return isRecord(value) && Object.keys(value).every((key) => allowedFields.has(key));
}

function cleanString(value, { required = false, max = 500 } = {}) {
  if (value == null || value === "") return required ? null : undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeProduct(product) {
  if (!hasOnlyFields(product, PRODUCT_FIELDS)) return null;

  const canonicalProductId = cleanString(product.canonicalProductId, {
    required: true,
    max: 180
  });
  const name = cleanString(product.name, {
    required: true,
    max: 240
  });
  const barcode = cleanString(product.barcode, { max: 32 });

  if (!canonicalProductId || !name) return null;
  if (product.barcode != null && (!barcode || !/^\d{8,14}$/.test(barcode))) {
    return null;
  }

  return Object.freeze({
    canonicalProductId,
    sourceProductId: barcode,
    name
  });
}

function normalizeConsent(consent) {
  if (!hasOnlyFields(consent, CONSENT_FIELDS)) return null;
  if (consent.granted !== true) return null;

  const capturedAt = normalizeTimestamp(consent.capturedAt);
  if (!capturedAt) return null;

  return Object.freeze({
    granted: true,
    capturedAt
  });
}

function normalizeContext(context, granularity) {
  if (!hasOnlyFields(context, CONTEXT_FIELDS)) return null;

  const countryCodeRaw = cleanString(context.countryCode, { max: 2 });
  const countryCode = countryCodeRaw?.toUpperCase();
  const regionId = cleanString(context.regionId, { max: 180 });
  const regionName = cleanString(context.regionName, { max: 240 });
  const localityId = cleanString(context.localityId, { max: 180 });
  const localityName = cleanString(context.localityName, { max: 240 });
  const locationId = cleanString(context.locationId, { max: 240 });
  const locationLabel = cleanString(context.locationLabel, { max: 300 });
  const storeId = cleanString(context.storeId, { max: 180 });
  const storeName = cleanString(context.storeName, { max: 300 });

  if (context.countryCode != null && (!countryCode || !/^[A-Z]{2}$/.test(countryCode))) {
    return null;
  }
  if (context.regionId != null && !regionId) return null;
  if (context.regionName != null && !regionName) return null;
  if (context.localityId != null && !localityId) return null;
  if (context.localityName != null && !localityName) return null;
  if (context.locationId != null && !locationId) return null;
  if (context.locationLabel != null && !locationLabel) return null;
  if (context.storeId != null && !storeId) return null;
  if (context.storeName != null && !storeName) return null;

  const hasRegion = Boolean(regionId || regionName);
  const hasLocality = Boolean(localityId || localityName);

  if (Boolean(regionId) !== Boolean(regionName)) return null;
  if (Boolean(localityId) !== Boolean(localityName)) return null;
  if ((hasRegion || hasLocality) && !countryCode) return null;
  if (hasLocality && !hasRegion) return null;

  if (granularity === OBSERVATION_GRANULARITY.EXACT_STORE) {
    if (!locationId || !storeId || !storeName) return null;
  } else if (
    granularity === OBSERVATION_GRANULARITY.CITY
    || granularity === OBSERVATION_GRANULARITY.REGION
    || granularity === OBSERVATION_GRANULARITY.LOCATION
  ) {
    if (!locationId || !locationLabel) return null;
  } else if (
    granularity !== OBSERVATION_GRANULARITY.UNKNOWN
    && granularity !== OBSERVATION_GRANULARITY.PAGE
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
    locationLabel,
    storeId,
    storeName
  });
}

function proofTypeFor(evidenceType) {
  if (
    evidenceType === USER_EVIDENCE_TYPE.RECEIPT
    || evidenceType === USER_EVIDENCE_TYPE.DIGITAL_RECEIPT
  ) {
    return "RECEIPT";
  }
  if (evidenceType === USER_EVIDENCE_TYPE.SHELF_PRICE_TAG) {
    return "PRICE_TAG";
  }
  if (
    evidenceType === USER_EVIDENCE_TYPE.BARCODE_CONFIRMATION
    || evidenceType === USER_EVIDENCE_TYPE.MANUAL_PRICE_CONFIRMATION
  ) {
    return "USER_CONFIRMATION";
  }
  return null;
}

function reject(reason) {
  return Object.freeze({ kind: "rejected", reason });
}

export function validateUserEvidenceObservation(input) {
  if (!hasOnlyFields(input, TOP_LEVEL_FIELDS)) {
    return reject("invalid_shape");
  }

  if (input.kind !== USER_EVIDENCE_KIND) {
    return reject("invalid_kind");
  }

  if (!Object.values(USER_EVIDENCE_TYPE).includes(input.evidenceType)) {
    return reject("invalid_evidence_type");
  }

  const evidenceId = cleanString(input.evidenceId, {
    required: true,
    max: 240
  });
  const proofRef = cleanString(input.proofRef, {
    required: true,
    max: 700
  });
  if (!evidenceId || !proofRef) {
    return reject("invalid_proof_reference");
  }

  const consent = normalizeConsent(input.consent);
  if (!consent) {
    return reject("consent_required");
  }

  const observedAt = normalizeTimestamp(input.observedAt);
  if (!observedAt) {
    return reject("invalid_observed_at");
  }

  const product = normalizeProduct(input.product);
  if (!product) {
    return reject("invalid_product");
  }

  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor <= 0) {
    return reject("invalid_price");
  }

  if (input.currency !== "RUB") {
    return reject("unsupported_currency");
  }

  if (!Object.values(OBSERVATION_GRANULARITY).includes(input.granularity)) {
    return reject("invalid_granularity");
  }

  const context = normalizeContext(input.context, input.granularity);
  if (!context) {
    return reject("invalid_context");
  }

  if (!Object.values(USER_EVIDENCE_PRICE_CONDITION).includes(input.priceCondition)) {
    return reject("invalid_price_condition");
  }

  const conditionNote = cleanString(input.conditionNote, { max: 500 });
  if (input.conditionNote != null && !conditionNote) {
    return reject("invalid_condition_note");
  }
  if (
    (
      input.priceCondition === USER_EVIDENCE_PRICE_CONDITION.LOYALTY
      || input.priceCondition === USER_EVIDENCE_PRICE_CONDITION.PROMO
    )
    && !conditionNote
  ) {
    return reject("price_condition_details_required");
  }

  if (input.availability !== OBSERVED_AVAILABILITY.UNKNOWN) {
    return reject("unsupported_availability");
  }

  const proofType = proofTypeFor(input.evidenceType);
  if (!proofType) {
    return reject("invalid_evidence_type");
  }

  const observation = Object.freeze({
    kind: USER_EVIDENCE_KIND,
    sourceId: USER_EVIDENCE_SOURCE_ID,
    sourceUrl: null,
    evidenceId,
    evidenceType: input.evidenceType,
    observedAt,
    product,
    priceMinor: input.priceMinor,
    currency: "RUB",
    granularity: input.granularity,
    context,
    availability: OBSERVED_AVAILABILITY.UNKNOWN,
    salesChannel: "store",
    priceCondition: input.priceCondition,
    conditionNote,
    proof: Object.freeze({
      type: proofType,
      ref: proofRef,
      evidenceType: input.evidenceType,
      priceCondition: input.priceCondition,
      conditionNote
    }),
    consent
  });

  const match = Object.freeze({
    sourceId: USER_EVIDENCE_SOURCE_ID,
    sourceProductId: product.sourceProductId,
    sourceProductName: product.name,
    canonicalProductId: product.canonicalProductId,
    method: MATCH_METHOD.CANONICAL_ID,
    status: MATCH_STATUS.CONFIRMED,
    confidence: 1
  });

  return Object.freeze({
    kind: "accepted",
    observation,
    match
  });
}
