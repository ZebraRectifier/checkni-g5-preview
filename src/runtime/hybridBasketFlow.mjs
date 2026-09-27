import {
  PROPOSAL_STATUS,
  validateBasketProposal
} from "../core/ai-basket-proposal.mjs";
import {
  HYBRID_DRAFT_CONFIRMATION,
  confirmHybridBasketDraft
} from "../intelligence/hybridBasketConfirmation.mjs";
import {
  createHybridMetricEvent
} from "../intelligence/hybridBasketMetrics.mjs";
import {
  presentHybridBasketResult
} from "../intelligence/hybridBasketPresentation.mjs";
import {
  HYBRID_COMMIT_RESULT,
  createHybridBasketRequestGate
} from "./hybridBasketRequestGate.mjs";

export const HYBRID_BASKET_FLOW_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  SUCCESS: "success",
  PARTIAL: "partial",
  CLARIFICATION: "clarification",
  REJECTED: "rejected",
  UNAVAILABLE: "unavailable",
  ERROR: "error"
});

export const MAX_HYBRID_NATURAL_LANGUAGE_LENGTH = 300;

function freezeState(status, details = {}) {
  return Object.freeze({
    status,
    result: details.result ?? null,
    presentation: details.presentation ?? null,
    validation: details.validation ?? null,
    mergeRejectedRows: Object.freeze(
      Array.isArray(details.mergeRejectedRows)
        ? [...details.mergeRejectedRows]
        : []
    ),
    inputReason: details.inputReason ?? null
  });
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function emitMetric(onMetric, result, latencyMs) {
  if (typeof onMetric !== "function") return;

  try {
    onMetric(createHybridMetricEvent({
      result,
      latencyMs
    }));
  } catch {
    // Metrics must never break the shopping flow.
  }
}

function mergeStatus(validation, mergeRejectedRows) {
  return (
    validation?.status === PROPOSAL_STATUS.PARTIAL
    || mergeRejectedRows.length > 0
  )
    ? HYBRID_BASKET_FLOW_STATUS.PARTIAL
    : HYBRID_BASKET_FLOW_STATUS.SUCCESS;
}

function pendingIntentKey(value) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedMergeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({ rejectedRows: Object.freeze([]) });
  }

  return Object.freeze({
    rejectedRows: Object.freeze(
      Array.isArray(value.rejectedRows)
        ? [...value.rejectedRows]
        : []
    )
  });
}

export function createHybridBasketFlow(options = {}) {
  const {
    loader,
    localCatalog,
    resolveLiveCatalog,
    requestAiProposal,
    applyValidatedBasket,
    onMetric,
    now = defaultNow
  } = options;

  if (!loader || typeof loader.load !== "function") {
    throw new TypeError("hybrid basket flow requires a lazy interpreter loader");
  }
  if (!Array.isArray(localCatalog) || localCatalog.length === 0) {
    throw new TypeError("hybrid basket flow requires a local catalog");
  }
  if (
    resolveLiveCatalog != null
    && typeof resolveLiveCatalog !== "function"
  ) {
    throw new TypeError("hybrid live catalog resolver must be a function");
  }
  if (
    requestAiProposal != null
    && typeof requestAiProposal !== "function"
  ) {
    throw new TypeError("hybrid AI proposal requester must be a function");
  }
  if (typeof applyValidatedBasket !== "function") {
    throw new TypeError("hybrid basket flow requires a basket mutation function");
  }
  if (applyValidatedBasket?.constructor?.name === "AsyncFunction") {
    throw new TypeError("hybrid basket mutation must be synchronous");
  }
  if (typeof now !== "function") {
    throw new TypeError("hybrid basket flow clock must be a function");
  }

  const gate = createHybridBasketRequestGate();
  let state = freezeState(HYBRID_BASKET_FLOW_STATUS.IDLE);
  let pendingClarification = null;
  let pendingRun = null;

  const getState = () => state;

  const invalidate = () => {
    gate.invalidate();
    pendingClarification = null;
    pendingRun = null;
    state = freezeState(HYBRID_BASKET_FLOW_STATUS.IDLE);
    return state;
  };

  const preload = async () => {
    if (typeof loader.preload === "function") {
      return loader.preload();
    }
    return loader.load();
  };

  const applyProposal = (
    requestId,
    validation,
    result
  ) => {
    const commit = gate.commitLatest(
      requestId,
      applyValidatedBasket,
      validation.basket
    );

    if (commit.kind === HYBRID_COMMIT_RESULT.STALE) {
      return state;
    }

    if (
      commit.kind === HYBRID_COMMIT_RESULT.MUTATION_FAILED
      || commit.kind === HYBRID_COMMIT_RESULT.ALREADY_COMMITTED
    ) {
      state = freezeState(HYBRID_BASKET_FLOW_STATUS.ERROR, {
        result
      });
      return state;
    }

    const mergeResult = normalizedMergeResult(commit.value);
    state = freezeState(
      mergeStatus(validation, mergeResult.rejectedRows),
      {
        result,
        presentation: presentHybridBasketResult(result),
        validation,
        mergeRejectedRows: mergeResult.rejectedRows
      }
    );
    return state;
  };

  const run = (text) => {
    const normalizedText = typeof text === "string"
      ? text.trim()
      : "";

    if (!normalizedText) {
      gate.invalidate();
      pendingClarification = null;
      pendingRun = null;
      state = freezeState(HYBRID_BASKET_FLOW_STATUS.REJECTED, {
        inputReason: "empty"
      });
      return Promise.resolve(state);
    }

    if (normalizedText.length > MAX_HYBRID_NATURAL_LANGUAGE_LENGTH) {
      gate.invalidate();
      pendingClarification = null;
      pendingRun = null;
      state = freezeState(HYBRID_BASKET_FLOW_STATUS.REJECTED, {
        inputReason: "too_long"
      });
      return Promise.resolve(state);
    }

    const intentKey = pendingIntentKey(normalizedText);
    if (
      pendingRun
      && pendingRun.promise
      && pendingRun.intentKey === intentKey
      && gate.isCurrent(pendingRun.requestId)
    ) {
      return pendingRun.promise;
    }

    const requestId = gate.beginRequest();
    pendingClarification = null;
    const started = now();
    state = freezeState(HYBRID_BASKET_FLOW_STATUS.LOADING);

    const pendingToken = {
      intentKey,
      requestId,
      promise: null
    };
    pendingRun = pendingToken;

    const executionPromise = (async () => {
      try {
        const moduleValue = await loader.load();

      if (!gate.isCurrent(requestId)) {
        return state;
      }

      const result = await moduleValue.interpretHybridBasketText(
        normalizedText,
        localCatalog,
        {
          resolveLiveCatalog,
          requestAiProposal
        }
      );

      if (!gate.isCurrent(requestId)) {
        return state;
      }

      const latencyMs = Math.max(0, now() - started);
      emitMetric(onMetric, result, latencyMs);

      if (result.kind === "proposal") {
        return applyProposal(
          requestId,
          result.validation,
          result
        );
      }

      if (result.kind === "clarification") {
        pendingClarification = Object.freeze({
          requestId,
          result
        });
        state = freezeState(
          HYBRID_BASKET_FLOW_STATUS.CLARIFICATION,
          {
            result,
            presentation: presentHybridBasketResult(result),
            validation: result.validation
          }
        );
        return state;
      }

      if (result.kind === "unavailable") {
        state = freezeState(
          HYBRID_BASKET_FLOW_STATUS.UNAVAILABLE,
          {
            result,
            presentation: presentHybridBasketResult(result)
          }
        );
        return state;
      }

      if (result.kind === "rejected") {
        state = freezeState(
          HYBRID_BASKET_FLOW_STATUS.REJECTED,
          {
            result,
            presentation: presentHybridBasketResult(result)
          }
        );
        return state;
      }

      state = freezeState(
        HYBRID_BASKET_FLOW_STATUS.ERROR,
        {
          result,
          presentation: presentHybridBasketResult(result)
        }
      );
      return state;
      } catch {
        if (!gate.isCurrent(requestId)) {
          return state;
        }

        state = freezeState(HYBRID_BASKET_FLOW_STATUS.ERROR);
        return state;
      } finally {
        if (
          pendingRun === pendingToken
        ) {
          pendingRun = null;
        }
      }
    })();

    pendingToken.promise = executionPromise;
    return executionPromise;
  };

  const confirm = (mode) => {
    if (
      !pendingClarification
      || state.status !== HYBRID_BASKET_FLOW_STATUS.CLARIFICATION
      || !gate.isCurrent(pendingClarification.requestId)
    ) {
      return state;
    }

    if (
      mode !== HYBRID_DRAFT_CONFIRMATION.CONFIRM_ALL
      && mode !== HYBRID_DRAFT_CONFIRMATION.ADD_FOUND_ONLY
    ) {
      return state;
    }

    const confirmed = confirmHybridBasketDraft(
      pendingClarification.result,
      mode
    );

    if (confirmed.kind !== "proposal") {
      return state;
    }

    const validation = validateBasketProposal(
      confirmed.proposal,
      confirmed.catalogSnapshot
        ? { catalog: confirmed.catalogSnapshot }
        : undefined
    );

    if (validation.status !== PROPOSAL_STATUS.ACCEPTED) {
      state = freezeState(HYBRID_BASKET_FLOW_STATUS.ERROR, {
        result: pendingClarification.result
      });
      pendingClarification = null;
      return state;
    }

    const current = pendingClarification;
    pendingClarification = null;

    return applyProposal(
      current.requestId,
      validation,
      Object.freeze({
        kind: "proposal",
        source: current.result.source,
        proposal: confirmed.proposal,
        validation,
        triggerReason: current.result.triggerReason ?? null,
        catalogSnapshot: confirmed.catalogSnapshot ?? null
      })
    );
  };

  return Object.freeze({
    confirm,
    getState,
    invalidate,
    preload,
    run
  });
}
