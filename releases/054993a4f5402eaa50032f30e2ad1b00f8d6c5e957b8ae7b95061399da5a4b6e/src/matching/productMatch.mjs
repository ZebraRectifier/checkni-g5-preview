import { getSensorSource } from "../sensors/sourceRegistry.mjs";

export const MATCH_METHOD = Object.freeze({
  CANONICAL_ID: "canonical-id",
  BARCODE: "barcode",
  NORMALIZED_TEXT: "normalized-text",
  AI_PROPOSAL: "ai-proposal",
  USER_CONFIRMED: "user-confirmed"
});

export const MATCH_STATUS = Object.freeze({
  PROPOSED: "proposed",
  CONFIRMED: "confirmed"
});

const ALLOWED_FIELDS = new Set([
  "sourceId",
  "sourceProductId",
  "sourceProductName",
  "canonicalProductId",
  "method",
  "status",
  "confidence"
]);

function cleanString(value, { required = true, max = 240 } = {}) {
  if (value == null || value === "") return required ? null : undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function normalizeGtin(value) {
  if (typeof value !== "string") return null;
  const digits = value.trim();
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return null;

  const padded = digits.padStart(14, "0");
  const dataDigits = padded.slice(0, 13);
  const expectedCheck = (
    10
    - Array.from(dataDigits).reduce(
      (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 3 : 1),
      0
    ) % 10
  ) % 10;

  if (expectedCheck !== Number(padded[13])) return null;
  return padded;
}

export function canonicalProductIdFromBarcode(value) {
  const gtin = normalizeGtin(value);
  return gtin ? `gtin-${gtin}` : null;
}

function isCanonicalBarcodeProductId(value) {
  if (typeof value !== "string" || !/^gtin-\d{14}$/.test(value)) return false;
  return canonicalProductIdFromBarcode(value.slice(5)) === value;
}

export function createProductMatch(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Object.freeze({ kind: "rejected", reason: "invalid_shape" });
  }

  if (!Object.keys(input).every((key) => ALLOWED_FIELDS.has(key))) {
    return Object.freeze({ kind: "rejected", reason: "invalid_shape" });
  }

  const sourceResolver = typeof options.sourceResolver === "function"
    ? options.sourceResolver
    : getSensorSource;
  const source = sourceResolver(input.sourceId);
  if (!source) {
    return Object.freeze({ kind: "rejected", reason: "unknown_source" });
  }

  const sourceProductId = cleanString(input.sourceProductId, {
    required: false,
    max: 180
  });
  const sourceProductName = cleanString(input.sourceProductName, {
    required: true,
    max: 240
  });
  const canonicalProductId = cleanString(input.canonicalProductId, {
    required: true,
    max: 180
  });

  if (
    !sourceProductName
    || !canonicalProductId
    || (input.sourceProductId != null && !sourceProductId)
  ) {
    return Object.freeze({ kind: "rejected", reason: "invalid_product_identity" });
  }

  if (!Object.values(MATCH_METHOD).includes(input.method)) {
    return Object.freeze({ kind: "rejected", reason: "invalid_method" });
  }

  if (!Object.values(MATCH_STATUS).includes(input.status)) {
    return Object.freeze({ kind: "rejected", reason: "invalid_status" });
  }

  if (
    input.method === MATCH_METHOD.CANONICAL_ID
    && input.status === MATCH_STATUS.CONFIRMED
    && !sourceProductId
  ) {
    return Object.freeze({
      kind: "rejected",
      reason: "confirmed_mapping_requires_source_product"
    });
  }

  if (
    input.method === MATCH_METHOD.BARCODE
    && !isCanonicalBarcodeProductId(canonicalProductId)
  ) {
    return Object.freeze({ kind: "rejected", reason: "invalid_product_identity" });
  }

  if (input.method === MATCH_METHOD.BARCODE) {
    const sourceCanonicalProductId = canonicalProductIdFromBarcode(sourceProductId);
    if (
      !sourceCanonicalProductId
      || sourceCanonicalProductId !== canonicalProductId
    ) {
      return Object.freeze({
        kind: "rejected",
        reason: "barcode_identity_mismatch"
      });
    }
  }

  if (
    typeof input.confidence !== "number"
    || !Number.isFinite(input.confidence)
    || input.confidence < 0
    || input.confidence > 1
  ) {
    return Object.freeze({ kind: "rejected", reason: "invalid_confidence" });
  }

  if (
    input.method === MATCH_METHOD.CANONICAL_ID
    && input.status === MATCH_STATUS.CONFIRMED
    && input.confidence !== 1
  ) {
    return Object.freeze({
      kind: "rejected",
      reason: "canonical_confirmation_must_be_exact"
    });
  }

  if (
    input.method === MATCH_METHOD.BARCODE
    && input.status === MATCH_STATUS.CONFIRMED
    && input.confidence !== 1
  ) {
    return Object.freeze({
      kind: "rejected",
      reason: "barcode_confirmation_must_be_exact"
    });
  }

  if (
    input.method === MATCH_METHOD.AI_PROPOSAL
    && input.status === MATCH_STATUS.CONFIRMED
  ) {
    return Object.freeze({ kind: "rejected", reason: "ai_cannot_confirm_match" });
  }

  if (
    input.method === MATCH_METHOD.USER_CONFIRMED
    && (
      !sourceProductId
      || input.status !== MATCH_STATUS.CONFIRMED
      || input.confidence !== 1
    )
  ) {
    return Object.freeze({
      kind: "rejected",
      reason: "user_confirmation_must_be_exact"
    });
  }

  return Object.freeze({
    kind: "accepted",
    match: Object.freeze({
      sourceId: source.id,
      sourceProductId,
      sourceProductName,
      canonicalProductId,
      method: input.method,
      status: input.status,
      confidence: input.confidence
    })
  });
}
