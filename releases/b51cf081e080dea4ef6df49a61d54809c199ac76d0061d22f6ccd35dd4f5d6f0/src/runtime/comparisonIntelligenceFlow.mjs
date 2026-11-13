import { buildComparisonContext } from "../intelligence/comparisonContext.mjs";
import { validateComparisonIntelligenceProposal } from "../intelligence/comparisonProposal.mjs";

export const COMPARISON_INTELLIGENCE_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  SUCCESS: "success",
  REJECTED: "rejected",
  UNAVAILABLE: "unavailable",
  ERROR: "error"
});

function freezeState(status, details = {}) {
  return Object.freeze({
    status,
    context: details.context ?? null,
    plan: details.plan ?? null,
    reason: details.reason ?? null
  });
}

function typed(value, kind) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && value.kind === kind
  );
}

export function createComparisonIntelligenceFlow(propose) {
  if (typeof propose !== "function") {
    throw new TypeError("comparison intelligence requires a proposal function");
  }

  let version = 0;
  let state = freezeState(COMPARISON_INTELLIGENCE_STATUS.IDLE);

  const getState = () => state;

  const invalidate = () => {
    version += 1;
    state = freezeState(COMPARISON_INTELLIGENCE_STATUS.IDLE);
    return state;
  };

  const run = async (comparison) => {
    const requestId = ++version;
    let context;

    try {
      context = buildComparisonContext(comparison);
    } catch {
      state = freezeState(COMPARISON_INTELLIGENCE_STATUS.ERROR, {
        reason: "invalid_comparison"
      });
      return state;
    }

    state = freezeState(COMPARISON_INTELLIGENCE_STATUS.LOADING, { context });

    try {
      const providerResult = await propose(context);

      if (requestId !== version) return state;

      if (typed(providerResult, "unavailable")) {
        state = freezeState(COMPARISON_INTELLIGENCE_STATUS.UNAVAILABLE, {
          context,
          reason: providerResult.code ?? "provider_unavailable"
        });
        return state;
      }

      if (typed(providerResult, "error")) {
        state = freezeState(COMPARISON_INTELLIGENCE_STATUS.ERROR, {
          context,
          reason: providerResult.code ?? "provider_error"
        });
        return state;
      }

      const proposal = typed(providerResult, "proposal")
        ? providerResult.proposal
        : providerResult;

      const validation = validateComparisonIntelligenceProposal(context, proposal);

      if (validation.kind !== "accepted") {
        state = freezeState(COMPARISON_INTELLIGENCE_STATUS.REJECTED, {
          context,
          reason: validation.reason
        });
        return state;
      }

      state = freezeState(COMPARISON_INTELLIGENCE_STATUS.SUCCESS, {
        context,
        plan: validation.plan
      });
      return state;
    } catch {
      if (requestId !== version) return state;
      state = freezeState(COMPARISON_INTELLIGENCE_STATUS.UNAVAILABLE, {
        context,
        reason: "provider_unavailable"
      });
      return state;
    }
  };

  return Object.freeze({
    getState,
    invalidate,
    run
  });
}
