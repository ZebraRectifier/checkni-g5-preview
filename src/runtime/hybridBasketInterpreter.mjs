import {
  HYBRID_BASKET_RESULT,
  HYBRID_BASKET_SOURCE,
  resolveHybridBasketProposal,
  snapshotHybridCatalog
} from "../intelligence/hybridBasketResolver.mjs";
import { normalizeShoppingAdviceResponse } from "../intelligence/shoppingAdviceContract.mjs";

export const HYBRID_CATALOG_STAGE = Object.freeze({
  LOCAL: "local",
  LIVE: "live"
});

function decorate(result, catalogSnapshot, details = {}) {
  return Object.freeze({
    ...result,
    catalogSnapshot,
    catalogStage: details.catalogStage ?? HYBRID_CATALOG_STAGE.LOCAL,
    liveCatalogAttempted: details.liveCatalogAttempted === true
  });
}

function isLocalTerminal(result) {
  return (
    result.kind === HYBRID_BASKET_RESULT.PROPOSAL
      && result.source === HYBRID_BASKET_SOURCE.LOCAL
  ) || (
    result.kind === HYBRID_BASKET_RESULT.REJECTED
      && result.source === HYBRID_BASKET_SOURCE.LOCAL
  ) || (
    result.kind === HYBRID_BASKET_RESULT.ERROR
      && result.source === HYBRID_BASKET_SOURCE.LOCAL
  ) || (
    // Local intent drafts ("на завтрак", "для борща") wait for the user's
    // confirmation; they do not need the live catalogue or AI.
    result.kind === HYBRID_BASKET_RESULT.CLARIFICATION
      && result.source === HYBRID_BASKET_SOURCE.LOCAL
  );
}

function isLocalFallbackWithoutAi(result) {
  return (
    result.kind === HYBRID_BASKET_RESULT.UNAVAILABLE
    && result.source === HYBRID_BASKET_SOURCE.AI
    && result.code === "ai_unconfigured"
  );
}

async function localOnly(
  text,
  catalogSnapshot,
  priceHints,
  resolveCommercialRequest
) {
  return resolveHybridBasketProposal(
    text,
    catalogSnapshot,
    {
      ...(priceHints instanceof Map ? { priceHints } : {}),
      ...(typeof resolveCommercialRequest === "function"
        ? { resolveCommercialRequest }
        : {})
    }
  );
}

function safeLiveCatalog(value) {
  try {
    return snapshotHybridCatalog(value);
  } catch {
    return null;
  }
}

export async function interpretHybridBasketText(
  text,
  localCatalog,
  options = {}
) {
  const localSnapshot = snapshotHybridCatalog(localCatalog);
  const localResult = await localOnly(
    text,
    localSnapshot,
    options.priceHints,
    options.resolveCommercialRequest
  );

  if (isLocalTerminal(localResult)) {
    return decorate(localResult, localSnapshot);
  }

  if (!isLocalFallbackWithoutAi(localResult)) {
    return decorate(
      Object.freeze({
        kind: HYBRID_BASKET_RESULT.ERROR,
        source: HYBRID_BASKET_SOURCE.LOCAL,
        code: "unexpected_local_result"
      }),
      localSnapshot
    );
  }

  // The conversational shell can ask its existing advice provider to explain
  // or clarify an unresolved phrase. One advice call replaces the strict SKU
  // proposal call; a catalog outage must not prevent an ordinary conversation.
  // Undefined declines advice for a concrete product request, preserving its
  // live-catalog -> validated proposal path. Null means advice was unavailable.
  if (typeof options.requestConversationAdvice === "function") {
    let answer;
    try { answer = await options.requestConversationAdvice(text); } catch { answer = null; }
    if (answer !== undefined) {
      const reply = normalizeShoppingAdviceResponse(answer);
      return decorate(Object.freeze({ kind: HYBRID_BASKET_RESULT.CLARIFICATION,
      source: HYBRID_BASKET_SOURCE.AI, reason: "conversation", triggerReason: "smalltalk",
      conversationAdvice: true,
      assistantReply: Object.freeze({ headline: reply ? "Давай разберёмся." : "Продолжим подбор.",
        message: reply?.message ?? "Сервис советов сейчас не ответил. На сколько человек и дней нужны покупки?",
        actionLabel: "Продолжить", mascotState: "curious" }) }), localSnapshot);
    }
  }

  const resolveLiveCatalog = options.resolveLiveCatalog;
  let selectedSnapshot = localSnapshot;
  let catalogStage = HYBRID_CATALOG_STAGE.LOCAL;
  let liveCatalogAttempted = false;

  if (typeof resolveLiveCatalog === "function") {
    liveCatalogAttempted = true;

    try {
      const liveCandidate = safeLiveCatalog(
        await resolveLiveCatalog(text)
      );

      if (liveCandidate !== null) {
        selectedSnapshot = liveCandidate;
        catalogStage = HYBRID_CATALOG_STAGE.LIVE;

        const liveLocalResult = await localOnly(
          text,
          selectedSnapshot,
          options.priceHints,
          options.resolveCommercialRequest
        );

        if (isLocalTerminal(liveLocalResult)) {
          return decorate(
            liveLocalResult,
            selectedSnapshot,
            {
              catalogStage,
              liveCatalogAttempted
            }
          );
        }

        if (!isLocalFallbackWithoutAi(liveLocalResult)) {
          return decorate(
            Object.freeze({
              kind: HYBRID_BASKET_RESULT.ERROR,
              source: HYBRID_BASKET_SOURCE.LOCAL,
              code: "unexpected_live_local_result"
            }),
            selectedSnapshot,
            {
              catalogStage,
              liveCatalogAttempted
            }
          );
        }
      }
    } catch {
      selectedSnapshot = localSnapshot;
      catalogStage = HYBRID_CATALOG_STAGE.LOCAL;
    }
  }

  const aiResult = await resolveHybridBasketProposal(
    text,
    selectedSnapshot,
    {
      requestAiProposal: options.requestAiProposal,
      ...(typeof options.resolveCommercialRequest === "function"
        ? { resolveCommercialRequest: options.resolveCommercialRequest }
        : {}),
      ...(options.priceHints instanceof Map
        ? { priceHints: options.priceHints }
        : {})
    }
  );

  return decorate(
    aiResult,
    selectedSnapshot,
    {
      catalogStage,
      liveCatalogAttempted
    }
  );
}
