export const SENSOR_SOURCE_ROLE = Object.freeze({
  AGGREGATOR: "aggregator",
  PROMO_AGGREGATOR: "promo-aggregator",
  RETAILER_COMMERCE: "retailer-commerce",
  OPEN_DATA: "open-data"
});

export const SENSOR_SOURCE_STATE = Object.freeze({
  RESEARCH: "research",
  HANDOFF_ONLY: "handoff-only",
  READY: "ready",
  PAUSED: "paused"
});

const DEFAULT_CAPABILITIES = Object.freeze({
  manualHandoff: false,
  publicPageResearch: false,
  automatedObservation: false,
  openDataRead: false,
  historicalPriceRead: false,
  exactStoreContext: false,
  stockObservation: false,
  basketPrefill: false,
  checkout: false
});

function requiredString(value, label, max = 240) {
  if (typeof value !== "string") {
    throw new TypeError(label + " is required");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(label + " is required");
  }
  return normalized;
}

function httpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(label + " must be a valid https URL");
  }
  if (parsed.protocol !== "https:") {
    throw new TypeError(label + " must use https");
  }
  return parsed.href;
}

function normalizeLicenseProvenance(license) {
  if (license == null) return null;
  if (typeof license !== "object" || Array.isArray(license)) {
    throw new TypeError("sensor source license must be an object");
  }

  return Object.freeze({
    name: requiredString(license.name, "sensor source license name"),
    url: httpsUrl(license.url, "sensor source license url"),
    attribution: requiredString(
      license.attribution,
      "sensor source license attribution",
      320
    ),
    documentationUrl: httpsUrl(
      license.documentationUrl,
      "sensor source license documentationUrl"
    )
  });
}

export function defineSensorSource({
  id,
  name,
  role,
  state,
  publicUrl,
  capabilities = {},
  license = null,
  notes = null
}) {
  if (!id || !name || !role || !state || !publicUrl) {
    throw new TypeError("sensor source descriptor requires id/name/role/state/publicUrl");
  }

  const parsed = new URL(publicUrl);
  if (parsed.protocol !== "https:") {
    throw new TypeError("sensor source publicUrl must use https");
  }

  return Object.freeze({
    id,
    name,
    role,
    state,
    publicUrl: parsed.href,
    origin: parsed.origin,
    capabilities: Object.freeze({
      ...DEFAULT_CAPABILITIES,
      ...capabilities
    }),
    license: normalizeLicenseProvenance(license),
    notes
  });
}
