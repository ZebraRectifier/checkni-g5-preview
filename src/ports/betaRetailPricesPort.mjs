import {
  BETA_METRO_MAGNIT_EVERYDAY_PROOF_PROFILE_ID,
  BETA_LIVE_PROFILE_PRODUCT_IDS,
  BETA_PROFILE_PRODUCT_IDS
} from "../data/betaRealBasket.mjs";

export const BETA_RETAIL_PRICES_ENDPOINT =
  "https://cxpneczhczashanbetgj.supabase.co/functions/v1/beta-retail-prices";
export const BETA_RETAIL_PRICES_PUBLISHABLE_KEY =
  "sb_publishable_yyIT9Clu4jTphSdVLCVWFA_KQsZZ2rt";
export const BETA_RETAIL_PRICES_TIMEOUT_MS = 20_000;
export const BETA_RETAIL_PRICES_MAX_RESPONSE_BYTES = 65_536;
export const BETA_RETAIL_IDENTITY_CONFIRMATION =
  BETA_METRO_MAGNIT_EVERYDAY_PROOF_PROFILE_ID;
export const BETA_RETAIL_PROFILE_IDS = Object.freeze(
  Object.keys(BETA_LIVE_PROFILE_PRODUCT_IDS)
);
export const MAX_BETA_RETAIL_OFFERS = 24;

const SOURCE_CONTRACTS = Object.freeze({
  "globus-public-live": Object.freeze({
    sourceName: "Глобус · публичный каталог",
    retailerId: "globus",
    hosts: Object.freeze(["globus.ru", "www.globus.ru", "online.globus.ru"]),
    locationPrefix: "globus:",
    storePrefix: "globus-pvz-",
    allowedConditions: Object.freeze(["regular"]),
    minimumQuantity: 1
  }),
  "metro-public-live": Object.freeze({
    sourceName: "METRO · публичный каталог",
    retailerId: "metro",
    hosts: Object.freeze(["online.metro-cc.ru"]),
    locationPrefix: "metro:",
    storePrefix: "metro-address-",
    allowedConditions: Object.freeze(["regular"]),
    minimumQuantity: 1
  }),
  "magnit-public-live": Object.freeze({
    sourceName: "Магнит · публичная карточка товара",
    retailerId: "magnit",
    hosts: Object.freeze(["magnit.ru", "www.magnit.ru"]),
    locationPrefix: "magnit:",
    storePrefix: "magnit-shop-",
    allowedConditions: Object.freeze(["promo"]),
    minimumQuantity: 1,
    promoComparable: "required"
  }),
  "perekrestok-yandex-eda-live": Object.freeze({
    sourceName: "Перекрёсток · Яндекс Еда",
    retailerId: "perekrestok",
    hosts: Object.freeze(["eda.yandex.ru"]),
    locationPrefix: "perekrestok:",
    storePrefix: "perekrestok-yandex-",
    allowedConditions: Object.freeze(["regular", "promo"]),
    minimumQuantity: null,
    promoComparable: "forbidden"
  })
});

const ALLOWED_PRODUCT_IDS = new Set(
  Object.values(BETA_PROFILE_PRODUCT_IDS).flat()
);

// Identity is confirmed per profile: the user saw which exact items stand
// for the basket products before any live retailer read.
const confirmedProfiles = new Set();

function result(kind, code) {
  return Object.freeze(code ? { kind, code } : { kind });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, max = 1000) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

async function readBoundedJsonResponse(response, maxBytes) {
  const declared = response.headers?.get?.("Content-Length");
  if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
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
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function normalizeOffer(value) {
  if (!isRecord(value)) return null;

  const allowed = new Set([
    "sourceId", "sourceName", "sourceUrl", "observedAt",
    "granularity", "locationTruthLevel", "locationId",
    "countryCode", "regionId", "regionName", "localityId",
    "localityName", "retailerId", "canonicalProductId", "sourceProductId",
    "sourceProductName", "unitPriceMinor", "currency",
    "priceCondition", "priceConditionComparable", "conditionNote",
    "salesChannel", "minimumQuantity",
    "storeId", "storeName", "locationLabel", "availability"
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;

  const sourceId = cleanString(value.sourceId, 80);
  const contract = sourceId ? SOURCE_CONTRACTS[sourceId] : null;
  const sourceName = cleanString(value.sourceName, 120);
  const sourceUrl = cleanString(value.sourceUrl, 1000);
  const observedAtMs = Date.parse(value.observedAt);
  const locationId = cleanString(value.locationId, 180);
  const retailerId = cleanString(value.retailerId, 80);
  const productId = cleanString(value.canonicalProductId, 120);
  const sourceProductId = cleanString(value.sourceProductId, 180);
  const sourceProductName = cleanString(value.sourceProductName, 300);
  const storeId = cleanString(value.storeId, 180);
  const storeName = cleanString(value.storeName, 240);
  const locationLabel = cleanString(value.locationLabel, 300);

  if (
    !contract
    || sourceName !== contract.sourceName
    || !sourceUrl
    || !Number.isFinite(observedAtMs)
    || value.granularity !== "exact-store"
    || value.locationTruthLevel !== "store"
    || !locationId || !locationId.startsWith(contract.locationPrefix)
    || value.countryCode !== "RU"
    || value.regionId !== "77"
    || value.regionName !== "Москва"
    || value.localityId !== "moscow"
    || value.localityName !== "Москва"
    || retailerId !== contract.retailerId
    || !productId || !ALLOWED_PRODUCT_IDS.has(productId)
    || !sourceProductId || !sourceProductName
    || !Number.isSafeInteger(value.unitPriceMinor)
    || value.unitPriceMinor <= 0
    || value.currency !== "RUB"
    || !contract.allowedConditions.includes(value.priceCondition)
    || (
      value.priceCondition === "promo"
      && (
        cleanString(value.conditionNote, 300) === null
        || (
          contract.promoComparable === "required"
          && value.priceConditionComparable !== true
        )
        || (
          contract.promoComparable === "forbidden"
          && value.priceConditionComparable !== false
        )
      )
    )
    || value.salesChannel !== "online"
    || value.minimumQuantity !== contract.minimumQuantity
    || !storeId || !storeId.startsWith(contract.storePrefix)
    || locationId !== `${retailerId}:${storeId}`
    || !storeName || !locationLabel || !/Москва/u.test(locationLabel)
    || value.availability !== "unknown"
  ) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:"
    || !contract.hosts.includes(parsed.hostname)
  ) {
    return null;
  }

  return Object.freeze({
    ...value,
    observedAt: new Date(observedAtMs).toISOString()
  });
}

export function normalizeBetaRetailPricesResponse(value) {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return result("error", "malformed_transport_response");
  }

  if (value.kind === "blocked" || value.kind === "unavailable" || value.kind === "error") {
    const code = cleanString(value.code, 120);
    return code ? Object.freeze({ kind: value.kind, code }) : result("error", "malformed_transport_response");
  }

  if (value.kind !== "prices" && value.kind !== "insufficient") {
    return result("error", "malformed_transport_response");
  }

  const refreshedAtMs = Date.parse(value.refreshedAt);
  if (!Number.isFinite(refreshedAtMs) || !Array.isArray(value.offers) || value.offers.length > MAX_BETA_RETAIL_OFFERS) {
    return result("error", "malformed_transport_response");
  }

  const offers = value.offers.map(normalizeOffer);
  if (offers.some((offer) => offer === null)) {
    return result("error", "malformed_transport_response");
  }

  return Object.freeze({
    kind: value.kind,
    refreshedAt: new Date(refreshedAtMs).toISOString(),
    offers: Object.freeze(offers)
  });
}

export function confirmBetaRetailIdentity(profileId = BETA_RETAIL_IDENTITY_CONFIRMATION) {
  if (BETA_RETAIL_PROFILE_IDS.includes(profileId)) confirmedProfiles.add(profileId);
}

export function isBetaRetailIdentityConfirmed(profileId = BETA_RETAIL_IDENTITY_CONFIRMATION) {
  return confirmedProfiles.has(profileId);
}

export function clearBetaRetailIdentityConfirmation(profileId) {
  if (profileId === undefined) confirmedProfiles.clear();
  else confirmedProfiles.delete(profileId);
}

export function createBetaRetailPricesClient(options = {}) {
  const endpoint = options.endpoint ?? BETA_RETAIL_PRICES_ENDPOINT;
  const publishableKey = options.publishableKey ?? BETA_RETAIL_PRICES_PUBLISHABLE_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? BETA_RETAIL_PRICES_TIMEOUT_MS;

  const request = async (identityConfirmation = options.identityConfirmation) => {
    if (!BETA_RETAIL_PROFILE_IDS.includes(identityConfirmation)) {
      return result("unavailable", "identity_confirmation_required");
    }
    if (typeof fetchImpl !== "function") return result("unavailable", "transport_unconfigured");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: publishableKey
        },
        body: JSON.stringify({ identityConfirmation }),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store"
      });
      const payload = await readBoundedJsonResponse(response, BETA_RETAIL_PRICES_MAX_RESPONSE_BYTES);
      if (payload === null) return result("error", "malformed_transport_response");
      return normalizeBetaRetailPricesResponse(payload);
    } catch {
      return result("unavailable", "transport_unavailable");
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({ request });
}

const defaultClient = createBetaRetailPricesClient();

export async function requestBetaRetailPrices(profileId = BETA_RETAIL_IDENTITY_CONFIRMATION) {
  if (!confirmedProfiles.has(profileId)) {
    return result("unavailable", "identity_confirmation_required");
  }
  return defaultClient.request(profileId);
}
