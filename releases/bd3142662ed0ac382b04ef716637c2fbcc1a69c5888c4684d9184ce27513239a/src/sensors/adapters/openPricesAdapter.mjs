import { OPEN_PRICES_LICENSE_PROVENANCE } from "../sources/openPrices.mjs";

export const OPEN_PRICES_API_BASE = "https://prices.openfoodfacts.org/api/v1/prices";
export const OPEN_PRICES_SOURCE_ID = "open-prices";
export const OPEN_PRICES_TIMEOUT_MS = 6_000;
export const OPEN_PRICES_MAX_RESPONSE_BYTES = 524_288;
export const OPEN_PRICES_MAX_ITEMS = 100;

function result(kind, details = {}) {
  return Object.freeze({ kind, ...details });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBarcode(value) {
  return typeof value === "string" && /^\d{8,14}$/.test(value);
}

function normalizeSize(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > OPEN_PRICES_MAX_ITEMS) {
    return null;
  }
  return value;
}

function rubToMinor(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;

  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) return null;

  if (Math.abs(minor / 100 - value) > 1e-9) return null;
  return minor;
}

function normalizeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + "T00:00:00.000Z");
  if (!Number.isFinite(ms)) return null;
  return value;
}

function optionalCanonicalString(value, max = 300) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeLocation(value) {
  if (!isRecord(value)) {
    return Object.freeze({
      locationId: null,
      type: "UNKNOWN",
      name: null,
      displayName: null,
      brand: null,
      osmId: null,
      osmType: null
    });
  }

  const type = value.type === "OSM" || value.type === "ONLINE"
    ? value.type
    : "UNKNOWN";

  return Object.freeze({
    locationId: safeInteger(value.id),
    type,
    name: optionalCanonicalString(value.osm_name),
    displayName: optionalCanonicalString(value.osm_display_name, 500),
    brand: optionalCanonicalString(value.osm_brand),
    osmId: safeInteger(value.osm_id),
    osmType: ["NODE", "WAY", "RELATION"].includes(value.osm_type)
      ? value.osm_type
      : null
  });
}

function normalizeProof(value) {
  if (!isRecord(value)) {
    return Object.freeze({ proofId: null, type: null });
  }

  return Object.freeze({
    proofId: safeInteger(value.id),
    type: ["PRICE_TAG", "RECEIPT", "GDPR_REQUEST", "SHOP_IMPORT"].includes(value.type)
      ? value.type
      : null
  });
}

function normalizePriceItem(item, barcode) {
  if (!isRecord(item)) return null;
  if (item.type !== "PRODUCT") return null;
  if (item.product_code !== barcode) return null;
  if (item.currency !== "RUB") return null;

  const id = safeInteger(item.id);
  const priceMinor = rubToMinor(item.price);
  const observedDate = normalizeDate(item.date);

  if (id == null || priceMinor == null || observedDate == null) return null;

  const productName = optionalCanonicalString(
    item.product_name ?? item.product?.product_name
  );

  return Object.freeze({
    kind: "historical-price-evidence",
    sourceId: OPEN_PRICES_SOURCE_ID,
    evidenceId: `open-prices:${id}`,
    sourcePriceId: id,
    productCode: barcode,
    productName,
    priceMinor,
    currency: "RUB",
    observedDate,
    location: normalizeLocation(item.location),
    proof: normalizeProof(item.proof),
    license: OPEN_PRICES_LICENSE_PROVENANCE,
    sourceUrl: `${OPEN_PRICES_API_BASE}/${id}`
  });
}

async function readBoundedJson(response, maxBytes) {
  const declaredLength = response.headers?.get?.("Content-Length");
  if (
    declaredLength != null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
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

function compareEvidence(a, b) {
  if (a.observedDate !== b.observedDate) {
    return a.observedDate > b.observedDate ? -1 : 1;
  }
  return b.sourcePriceId - a.sourcePriceId;
}

export function createOpenPricesClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? OPEN_PRICES_API_BASE;
  const timeoutMs = options.timeoutMs ?? OPEN_PRICES_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? OPEN_PRICES_MAX_RESPONSE_BYTES;

  const lookupByBarcode = async (barcode, lookupOptions = {}) => {
    if (!isBarcode(barcode)) return result("error", { code: "invalid_barcode" });

    const size = normalizeSize(lookupOptions.size ?? 50);
    if (size == null) return result("error", { code: "invalid_size" });

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

    url.searchParams.set("product_code", barcode);
    url.searchParams.set("currency", "RUB");
    url.searchParams.set("type", "PRODUCT");
    url.searchParams.set("duplicate_of__isnull", "true");
    url.searchParams.set("size", String(size));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url.href, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store"
      });

      if (response.status === 429 || response.status >= 500) {
        return result("unavailable", { code: "source_unavailable" });
      }

      if (!response.ok) {
        return result("error", { code: "source_rejected_request" });
      }

      const payload = await readBoundedJson(response, maxResponseBytes);
      if (!isRecord(payload) || !Array.isArray(payload.items)) {
        return result("error", { code: "malformed_source_response" });
      }

      const evidence = payload.items
        .map((item) => normalizePriceItem(item, barcode))
        .filter(Boolean)
        .sort(compareEvidence);

      return result("evidence", {
        sourceId: OPEN_PRICES_SOURCE_ID,
        productCode: barcode,
        evidence: Object.freeze(evidence)
      });
    } catch {
      return result("unavailable", { code: "source_unavailable" });
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({ lookupByBarcode });
}

export {
  isBarcode,
  normalizePriceItem,
  readBoundedJson,
  rubToMinor
};
