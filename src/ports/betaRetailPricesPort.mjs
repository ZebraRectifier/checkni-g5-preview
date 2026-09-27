export const BETA_RETAIL_PRICES_ENDPOINT =
  "https://cxpneczhczashanbetgj.supabase.co/functions/v1/beta-retail-prices";
export const BETA_RETAIL_PRICES_PUBLISHABLE_KEY =
  "sb_publishable_yyIT9Clu4jTphSdVLCVWFA_KQsZZ2rt";
export const BETA_RETAIL_PRICES_TIMEOUT_MS = 16_000;
export const BETA_RETAIL_PRICES_MAX_RESPONSE_BYTES = 65_536;

const ALLOWED_SOURCE_IDS = new Set([
  "spar-public-live",
  "perekrestok-public-live"
]);
const ALLOWED_PRODUCT_IDS = new Set([
  "frutonyanya-water-330",
  "frutonyanya-multifruct-200"
]);

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
    "localityName", "canonicalProductId", "sourceProductId",
    "sourceProductName", "unitPriceMinor", "currency",
    "priceCondition", "salesChannel", "minimumQuantity",
    "storeId", "storeName", "locationLabel", "availability"
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;

  const sourceId = cleanString(value.sourceId, 80);
  const sourceName = cleanString(value.sourceName, 120);
  const sourceUrl = cleanString(value.sourceUrl, 1000);
  const observedAtMs = Date.parse(value.observedAt);
  const productId = cleanString(value.canonicalProductId, 120);
  const sourceProductId = cleanString(value.sourceProductId, 120);
  const sourceProductName = cleanString(value.sourceProductName, 300);

  if (
    !sourceId || !ALLOWED_SOURCE_IDS.has(sourceId)
    || !sourceName || !sourceUrl || !Number.isFinite(observedAtMs)
    || value.granularity !== "city"
    || value.locationTruthLevel !== "city"
    || value.countryCode !== "RU"
    || value.regionId !== "77"
    || value.regionName !== "Москва"
    || value.localityId !== "moscow"
    || value.localityName !== "Москва"
    || !productId || !ALLOWED_PRODUCT_IDS.has(productId)
    || !sourceProductId || !sourceProductName
    || !Number.isSafeInteger(value.unitPriceMinor)
    || value.unitPriceMinor <= 0
    || value.currency !== "RUB"
    || value.priceCondition !== "regular"
    || value.salesChannel !== "online"
    || value.minimumQuantity !== 1
    || value.storeId !== null
    || value.storeName !== null
    || value.locationLabel !== "Москва"
    || !["unknown", "unavailable"].includes(value.availability)
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
    || !["myspar.ru", "www.myspar.ru", "perekrestok.ru", "www.perekrestok.ru"].includes(parsed.hostname)
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
  if (!Number.isFinite(refreshedAtMs) || !Array.isArray(value.offers) || value.offers.length > 6) {
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

export function createBetaRetailPricesClient(options = {}) {
  const endpoint = options.endpoint ?? BETA_RETAIL_PRICES_ENDPOINT;
  const publishableKey = options.publishableKey ?? BETA_RETAIL_PRICES_PUBLISHABLE_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? BETA_RETAIL_PRICES_TIMEOUT_MS;

  const request = async () => {
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
        body: "{}",
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

export async function requestBetaRetailPrices() {
  return defaultClient.request();
}
