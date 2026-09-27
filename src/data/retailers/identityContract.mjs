export const RETAILER_IDENTITY_STATE = Object.freeze({
  IDENTITY_ONLY: "identity-only"
});

export const RETAILER_PRESENCE = Object.freeze({
  UNKNOWN: "unknown"
});

export const RETAILER_REGISTRY_META = Object.freeze({
  countryCode: "RU",
  coverage: "curated-seed",
  exhaustive: false,
  identityOnly: true
});

const DEFAULT_COMMERCIAL_CAPABILITIES = Object.freeze({
  automatedObservation: false,
  exactStorePrice: false,
  stockObservation: false,
  basketPrefill: false,
  checkout: false,
  partnerHandoff: false
});

const ALLOWED_SEED_FIELDS = Object.freeze([
  "aliases",
  "id",
  "identitySourceUrl",
  "name"
]);

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

function canonicalId(value) {
  const id = requiredString(value, "retailer id", 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new TypeError("retailer id must be canonical kebab-case");
  }
  return id;
}

function httpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("retailer identity source must be a valid https URL");
  }

  if (parsed.protocol !== "https:") {
    throw new TypeError("retailer identity source must use https");
  }

  return parsed.href;
}

function normalizeAliases(aliases) {
  if (!Array.isArray(aliases)) {
    throw new TypeError("retailer aliases must be an array");
  }

  const seen = new Set();
  const normalized = [];

  for (const alias of aliases) {
    const value = requiredString(alias, "retailer alias", 120);
    const key = value.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  return Object.freeze(normalized);
}

function rejectExtraSeedFields(seed) {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) {
    throw new TypeError("retailer seed must be an object");
  }

  const extraFields = Object.keys(seed)
    .filter((key) => !ALLOWED_SEED_FIELDS.includes(key))
    .sort();

  if (extraFields.length > 0) {
    throw new TypeError(
      "retailer seed contains unsupported fields: " + extraFields.join(",")
    );
  }
}

export function defineRetailerIdentity(seed) {
  rejectExtraSeedFields(seed);

  const {
    id,
    name,
    aliases = [],
    identitySourceUrl
  } = seed;

  return Object.freeze({
    id: canonicalId(id),
    name: requiredString(name, "retailer name", 120),
    aliases: normalizeAliases(aliases),
    countryCode: "RU",
    state: RETAILER_IDENTITY_STATE.IDENTITY_ONLY,
    presence: RETAILER_PRESENCE.UNKNOWN,
    identitySourceUrl: httpsUrl(identitySourceUrl),
    capabilities: DEFAULT_COMMERCIAL_CAPABILITIES
  });
}

export function createRetailerIdentityRegistry(packets) {
  if (!Array.isArray(packets)) {
    throw new TypeError("retailer registry packets must be an array");
  }

  const identities = [];
  const ids = new Set();

  for (const packet of packets) {
    if (!Array.isArray(packet)) {
      throw new TypeError("retailer registry packet must be an array");
    }

    for (const seed of packet) {
      const identity = defineRetailerIdentity(seed);
      if (ids.has(identity.id)) {
        throw new TypeError("duplicate retailer id: " + identity.id);
      }

      ids.add(identity.id);
      identities.push(identity);
    }
  }

  return Object.freeze(identities);
}
