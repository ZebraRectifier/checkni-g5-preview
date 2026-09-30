import {
  HYBRID_BASKET_RESULT,
  HYBRID_BASKET_SOURCE,
  resolveHybridBasketProposal,
  snapshotHybridCatalog
} from "../intelligence/hybridBasketResolver.mjs";

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

async function localOnly(text, catalogSnapshot, priceHints) {
  return resolveHybridBasketProposal(
    text,
    catalogSnapshot,
    priceHints instanceof Map ? { priceHints } : {}
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
  const localResult = await localOnly(text, localSnapshot, options.priceHints);

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
          options.priceHints
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
