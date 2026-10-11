import { BASKET_PROPOSAL_ENDPOINT, BASKET_PROPOSAL_PUBLISHABLE_KEY, BASKET_PROPOSAL_TIMEOUT_MS } from "./basketProposalPort.mjs";
import { normalizeShoppingAdviceRequest, normalizeShoppingAdviceResponse } from "../intelligence/shoppingAdviceContract.mjs";

export function createShoppingAdviceClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? BASKET_PROPOSAL_ENDPOINT;
  const key = options.publishableKey ?? BASKET_PROPOSAL_PUBLISHABLE_KEY;
  return async input => {
    const request = normalizeShoppingAdviceRequest(input);
    if (!request || new TextEncoder().encode(JSON.stringify(request)).length > 8192) return { kind: "error", code: "invalid_request" };
    if (typeof fetchImpl !== "function" || !String(endpoint).startsWith("https://") || typeof key !== "string" || !key) return { kind: "unavailable", code: "transport_unconfigured" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? BASKET_PROPOSAL_TIMEOUT_MS);
    try {
      const response = await fetchImpl(endpoint, { method: "POST", credentials: "omit", cache: "no-store",
        headers: { "Content-Type": "application/json", apikey: key }, body: JSON.stringify(request), signal: controller.signal });
      if (!response.ok) return { kind: "unavailable", code: response.status === 429 ? "rate_limited" : "provider_unavailable" };
      const reader = response.body?.getReader();
      if (!reader) return { kind: "error", code: "malformed_response" };
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 16384) { await reader.cancel(); return { kind: "error", code: "malformed_response" }; }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      return normalizeShoppingAdviceResponse(value, request.context) ?? { kind: "error", code: "invalid_advice" };
    } catch { return { kind: "unavailable", code: controller.signal.aborted ? "provider_timeout" : "transport_unavailable" }; }
    finally { clearTimeout(timer); }
  };
}
export const requestShoppingAdvice = createShoppingAdviceClient();
