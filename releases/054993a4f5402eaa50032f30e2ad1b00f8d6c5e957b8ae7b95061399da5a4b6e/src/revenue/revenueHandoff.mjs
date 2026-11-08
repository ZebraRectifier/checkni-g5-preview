import { getRetailerIdentity } from "../data/retailerRegistry.mjs";
import { getSensorSource } from "../sensors/sourceRegistry.mjs";

export const REVENUE_HANDOFF_KIND = Object.freeze({
  AFFILIATE_LINK: "affiliate-link",
  PROMO_CODE: "promo-code"
});

const ALLOWED_FIELDS = new Set([
  "sourceId",
  "retailerId",
  "kind",
  "partnerUrl",
  "promoCode",
  "disclosureLabel",
  "requiresAdMarking",
  "erid",
  "advertiserName"
]);

function cleanString(value, { required = false, max = 240 } = {}) {
  if (value == null || value === "") return required ? null : undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function parsePartnerUrl(value) {
  if (typeof value !== "string") return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  return url.href;
}

export function createRevenueHandoff(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Object.freeze({ kind: "rejected", reason: "invalid_shape" });
  }

  if (!Object.keys(input).every((key) => ALLOWED_FIELDS.has(key))) {
    return Object.freeze({ kind: "rejected", reason: "invalid_shape" });
  }

  const source = getSensorSource(input.sourceId);
  if (!source) {
    return Object.freeze({ kind: "rejected", reason: "unknown_source" });
  }

  const retailerId = cleanString(input.retailerId, { max: 80 });
  if (input.retailerId != null && !retailerId) {
    return Object.freeze({ kind: "rejected", reason: "invalid_retailer" });
  }
  const retailer = retailerId ? getRetailerIdentity(retailerId) : null;
  if (retailerId && !retailer) {
    return Object.freeze({ kind: "rejected", reason: "unknown_retailer" });
  }

  if (!Object.values(REVENUE_HANDOFF_KIND).includes(input.kind)) {
    return Object.freeze({ kind: "rejected", reason: "invalid_kind" });
  }

  const partnerUrl = parsePartnerUrl(input.partnerUrl);
  if (!partnerUrl) {
    return Object.freeze({ kind: "rejected", reason: "invalid_partner_url" });
  }

  const promoCode = cleanString(input.promoCode, { max: 80 });
  const disclosureLabel = cleanString(input.disclosureLabel, {
    required: true,
    max: 120
  });
  const advertiserName = cleanString(input.advertiserName, { max: 240 });
  const erid = cleanString(input.erid, { max: 160 });

  if (!disclosureLabel) {
    return Object.freeze({ kind: "rejected", reason: "missing_disclosure" });
  }

  if (input.kind === REVENUE_HANDOFF_KIND.PROMO_CODE && !promoCode) {
    return Object.freeze({ kind: "rejected", reason: "missing_promo_code" });
  }

  if (
    input.promoCode != null
    && !promoCode
  ) {
    return Object.freeze({ kind: "rejected", reason: "invalid_promo_code" });
  }

  if (typeof input.requiresAdMarking !== "boolean") {
    return Object.freeze({ kind: "rejected", reason: "invalid_marking_flag" });
  }

  if (
    input.requiresAdMarking
    && (!erid || !advertiserName)
  ) {
    return Object.freeze({ kind: "rejected", reason: "missing_ad_marking" });
  }

  return Object.freeze({
    kind: "accepted",
    handoff: Object.freeze({
      sourceId: source.id,
      sourceName: source.name,
      retailerId: retailer?.id ?? null,
      retailerName: retailer?.name ?? null,
      kind: input.kind,
      partnerUrl,
      promoCode,
      disclosureLabel,
      requiresAdMarking: input.requiresAdMarking,
      erid,
      advertiserName
    })
  });
}

export function selectRevenueHandoffForResult(result, handoffs = []) {
  if (!Array.isArray(handoffs)) return null;

  const retailerId = result?.winner?.retailerId ?? null;
  if (retailerId) {
    const retailerMatch = handoffs.find(
      (handoff) => handoff?.retailerId === retailerId
    );
    if (retailerMatch) return retailerMatch;
  }

  const sourceId = result?.winner?.sourceId;
  if (!sourceId) return null;
  return handoffs.find((handoff) => handoff?.sourceId === sourceId) ?? null;
}
