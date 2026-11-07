export const YANDEX_PUBLIC_PRICES_ENDPOINT =
  "https://cxpneczhczashanbetgj.supabase.co/functions/v1/yandex-public-prices";
export const YANDEX_PUBLIC_PRICES_PUBLISHABLE_KEY =
  "sb_publishable_yyIT9Clu4jTphSdVLCVWFA_KQsZZ2rt";
export const YANDEX_PUBLIC_PRICES_TIMEOUT_MS = 14_000;
export const YANDEX_PUBLIC_PRICES_MAX_RESPONSE_BYTES = 65_536;
export const YANDEX_PUBLIC_PRICES_MAX_PRODUCTS = 200;

function result(kind, code) {
  return Object.freeze(code ? { kind, code } : { kind });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, max = 700) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function isSafeEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint === "") return false;
  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

function organizationIdFromRequestUrl(value) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;

  try {
    const url = new URL(cleaned);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:"
      || !["yandex.com", "www.yandex.com", "yandex.ru", "www.yandex.ru"].includes(host)
      || url.search
      || url.hash
      || url.username
      || url.password
    ) {
      return null;
    }

    const match = /^\/maps\/org\/(?:(?:[^/]+)\/)?(\d+)\/?$/.exec(
      url.pathname
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function normalizedSourceUrl(value) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;

  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:" || url.origin !== "https://yandex.com") {
      return null;
    }
    if (url.search || url.hash || url.username || url.password) return null;

    const match = /^\/maps\/org\/(?:(?:[^/]+)\/)?(\d+)\/menu\/$/.exec(
      url.pathname
    );
    if (!match) return null;

    return Object.freeze({
      href: url.href,
      organizationId: match[1]
    });
  } catch {
    return null;
  }
}

async function readBoundedJsonResponse(response, maxBytes) {
  const declared = response.headers?.get?.("Content-Length");
  if (
    declared != null
    && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)
  ) {
    return null;
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    return null;
  }

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

    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(joined)
    );
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function normalizeProduct(value) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => ![
      "sourceProductId",
      "name",
      "priceMinor",
      "currency"
    ].includes(key))
  ) {
    return null;
  }

  const sourceProductId = cleanString(value.sourceProductId, 180);
  const name = cleanString(value.name, 240);

  if (
    !sourceProductId
    || !name
    || !Number.isSafeInteger(value.priceMinor)
    || value.priceMinor <= 0
    || value.currency !== "RUB"
  ) {
    return null;
  }

  return Object.freeze({
    sourceProductId,
    name,
    priceMinor: value.priceMinor,
    currency: "RUB"
  });
}

export function normalizeYandexPublicPricesResponse(value) {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return result("error", "malformed_transport_response");
  }

  if (value.kind === "blocked" || value.kind === "unavailable" || value.kind === "error") {
    const code = cleanString(value.code, 120);
    if (!code) return result("error", "malformed_transport_response");
    return Object.freeze({ kind: value.kind, code });
  }

  if (value.kind !== "prices" && value.kind !== "empty") {
    return result("error", "malformed_transport_response");
  }

  const sourceId = cleanString(value.sourceId, 120);
  const organizationId = cleanString(value.organizationId, 40);
  const sourceLocation = normalizedSourceUrl(value.sourceUrl);
  const observedAtMs = Date.parse(value.observedAt);

  if (
    sourceId !== "yandex-business-public"
    || !organizationId
    || !/^\d+$/.test(organizationId)
    || !sourceLocation
    || sourceLocation.organizationId !== organizationId
    || !Number.isFinite(observedAtMs)
    || !Array.isArray(value.products)
    || value.products.length > YANDEX_PUBLIC_PRICES_MAX_PRODUCTS
  ) {
    return result("error", "malformed_transport_response");
  }

  const products = value.products.map(normalizeProduct);
  if (products.some((product) => product === null)) {
    return result("error", "malformed_transport_response");
  }

  if (value.kind === "empty" && products.length !== 0) {
    return result("error", "malformed_transport_response");
  }
  if (value.kind === "prices" && products.length === 0) {
    return result("error", "malformed_transport_response");
  }

  return Object.freeze({
    kind: value.kind,
    sourceId,
    organizationId,
    sourceUrl: sourceLocation.href,
    observedAt: new Date(observedAtMs).toISOString(),
    products: Object.freeze(products)
  });
}

export function createYandexPublicPricesClient(options = {}) {
  const endpoint = options.endpoint ?? YANDEX_PUBLIC_PRICES_ENDPOINT;
  const publishableKey =
    options.publishableKey ?? YANDEX_PUBLIC_PRICES_PUBLISHABLE_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? YANDEX_PUBLIC_PRICES_TIMEOUT_MS;

  const isConfigured = () => (
    isSafeEndpoint(endpoint)
    && Boolean(cleanString(publishableKey, 512))
    && typeof fetchImpl === "function"
  );

  const request = async (organizationUrl) => {
    if (!isConfigured()) {
      return result("unavailable", "transport_unconfigured");
    }

    const url = cleanString(organizationUrl, 700);
    const expectedOrganizationId = organizationIdFromRequestUrl(url);
    if (!url || !expectedOrganizationId) {
      return result("error", "invalid_request");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: publishableKey
        },
        body: JSON.stringify({ organizationUrl: url }),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store"
      });

      const payload = await readBoundedJsonResponse(
        response,
        YANDEX_PUBLIC_PRICES_MAX_RESPONSE_BYTES
      );

      if (payload === null) {
        return result("error", "malformed_transport_response");
      }

      const normalized = normalizeYandexPublicPricesResponse(payload);

      if (
        (normalized.kind === "prices" || normalized.kind === "empty")
        && normalized.organizationId !== expectedOrganizationId
      ) {
        return result("error", "malformed_transport_response");
      }

      if (
        response.status >= 500
        && normalized.kind !== "blocked"
        && normalized.kind !== "unavailable"
      ) {
        return result("unavailable", "transport_unavailable");
      }

      if (!response.ok && normalized.kind === "error") {
        return normalized;
      }

      return normalized;
    } catch {
      return result("unavailable", "transport_unavailable");
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({ isConfigured, request });
}

const defaultClient = createYandexPublicPricesClient();

export async function requestYandexPublicPrices(organizationUrl) {
  return defaultClient.request(organizationUrl);
}
