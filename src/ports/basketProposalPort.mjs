import { MOCK_CATALOG } from "../data/mockCatalog.mjs";

export const BASKET_PROPOSAL_ENDPOINT = "https://cxpneczhczashanbetgj.supabase.co/functions/v1/ai-basket-proposal";
export const BASKET_PROPOSAL_PUBLISHABLE_KEY = "sb_publishable_yyIT9Clu4jTphSdVLCVWFA_KQsZZ2rt";
export const BASKET_PROPOSAL_TIMEOUT_MS = 7_000;
export const MAX_BROWSER_PROPOSAL_RESPONSE_BYTES = 65_536;
export const MAX_BROWSER_PROPOSAL_TEXT_LENGTH = 300;
export const MAX_BROWSER_CATALOG_ITEMS = 50;

function result(kind, code) {
  return Object.freeze(code ? { kind, code } : { kind });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalString(value) {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value;
}

function isSafeEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint === "") return false;

  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeCatalog(catalog) {
  if (
    !Array.isArray(catalog)
    || catalog.length === 0
    || catalog.length > MAX_BROWSER_CATALOG_ITEMS
  ) {
    return null;
  }

  const seen = new Set();
  const hints = [];

  for (const product of catalog) {
    if (
      !isRecord(product)
      || !isCanonicalString(product.id)
      || !isCanonicalString(product.name)
      || !isCanonicalString(product.unit)
      || seen.has(product.id)
    ) {
      return null;
    }

    seen.add(product.id);
    hints.push({
      id: product.id,
      name: product.name,
      unit: product.unit
    });
  }

  return hints;
}

function normalizeRequest(text, catalog) {
  if (
    typeof text !== "string"
    || text.trim() === ""
    || text.length > MAX_BROWSER_PROPOSAL_TEXT_LENGTH
  ) {
    return null;
  }

  const hints = normalizeCatalog(catalog);
  if (!hints) return null;

  return {
    text: text.trim(),
    catalog: hints
  };
}

async function readBoundedJsonResponse(
  response,
  maxBytes = MAX_BROWSER_PROPOSAL_RESPONSE_BYTES
) {
  const declaredLength = response.headers?.get?.("Content-Length");
  if (
    declaredLength !== null
    && declaredLength !== undefined
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
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

    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(decoded);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function normalizeTransportResult(value) {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return result("error", "malformed_transport_response");
  }

  if (value.kind === "proposal") {
    if (
      Object.keys(value).length !== 2
      || !Object.hasOwn(value, "proposal")
    ) {
      return result("error", "malformed_transport_response");
    }

    return Object.freeze({
      kind: "proposal",
      proposal: value.proposal
    });
  }

  if (value.kind === "unavailable" || value.kind === "error") {
    if (
      Object.keys(value).some((key) => key !== "kind" && key !== "code")
      || (Object.hasOwn(value, "code") && !isCanonicalString(value.code))
    ) {
      return result("error", "malformed_transport_response");
    }

    return Object.freeze({
      kind: value.kind,
      ...(value.code ? { code: value.code } : {})
    });
  }

  return result("error", "malformed_transport_response");
}

export function createBasketProposalClient(options = {}) {
  const endpoint = options.endpoint ?? BASKET_PROPOSAL_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? BASKET_PROPOSAL_TIMEOUT_MS;
  const catalog = options.catalog ?? MOCK_CATALOG;
  const publishableKey = options.publishableKey ?? BASKET_PROPOSAL_PUBLISHABLE_KEY;

  const isConfigured = () => (
    isSafeEndpoint(endpoint)
    && isCanonicalString(publishableKey)
    && typeof fetchImpl === "function"
  );

  const request = async (text) => {
    if (!isConfigured()) {
      return result("unavailable", "transport_unconfigured");
    }

    const body = normalizeRequest(text, catalog);
    if (!body) return result("error", "invalid_request");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: publishableKey
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store"
      });

      if (response.status === 429 || response.status >= 500) {
        return result("unavailable", "provider_unavailable");
      }

      if (!response.ok) {
        return result("error", "transport_rejected_request");
      }

      const payload = await readBoundedJsonResponse(response);
      if (payload === null) {
        return result("error", "malformed_transport_response");
      }

      return normalizeTransportResult(payload);
    } catch {
      return result("unavailable", "transport_unavailable");
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({
    isConfigured,
    request
  });
}

const defaultClient = createBasketProposalClient();

export function isBasketProposalConfigured() {
  return defaultClient.isConfigured();
}

export async function requestBasketProposal(text) {
  return defaultClient.request(text);
}

export {
  normalizeTransportResult,
  readBoundedJsonResponse
};
