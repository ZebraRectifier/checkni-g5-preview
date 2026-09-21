import {
  PROPOSAL_STATUS,
  validateBasketProposal
} from "../core/ai-basket-proposal.mjs";

export const BASKET_PROPOSAL_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  SUCCESS: "success",
  PARTIAL: "partial",
  REJECTED: "rejected",
  UNAVAILABLE: "unavailable",
  ERROR: "error"
});

export const MAX_NATURAL_LANGUAGE_LENGTH = 300;

function freezeState(status, details = {}) {
  return Object.freeze({
    status,
    validation: details.validation ?? null,
    mergeRejectedRows: details.mergeRejectedRows ?? [],
    inputReason: details.inputReason ?? null
  });
}

function isTypedProviderResult(value, type) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && value.kind === type
  );
}

export function createBasketProposalFlow(propose, applyValidatedBasket) {
  if (typeof propose !== "function") {
    throw new TypeError("basket proposal flow requires a proposal function");
  }
  if (typeof applyValidatedBasket !== "function") {
    throw new TypeError("basket proposal flow requires an apply function");
  }

  let requestVersion = 0;
  let state = freezeState(BASKET_PROPOSAL_STATUS.IDLE);

  const getState = () => state;

  const invalidate = () => {
    requestVersion += 1;
    state = freezeState(BASKET_PROPOSAL_STATUS.IDLE);
    return state;
  };

  const run = async (text) => {
    const normalizedText = typeof text === "string" ? text.trim() : "";

    if (!normalizedText) {
      requestVersion += 1;
      state = freezeState(BASKET_PROPOSAL_STATUS.REJECTED, {
        inputReason: "empty"
      });
      return state;
    }

    if (normalizedText.length > MAX_NATURAL_LANGUAGE_LENGTH) {
      requestVersion += 1;
      state = freezeState(BASKET_PROPOSAL_STATUS.REJECTED, {
        inputReason: "too_long"
      });
      return state;
    }

    const requestId = ++requestVersion;
    state = freezeState(BASKET_PROPOSAL_STATUS.LOADING);

    try {
      const providerResult = await propose(normalizedText);

      if (requestId !== requestVersion) {
        return state;
      }

      if (isTypedProviderResult(providerResult, "unavailable")) {
        state = freezeState(BASKET_PROPOSAL_STATUS.UNAVAILABLE);
        return state;
      }

      if (isTypedProviderResult(providerResult, "error")) {
        state = freezeState(BASKET_PROPOSAL_STATUS.ERROR);
        return state;
      }

      const proposalPayload = isTypedProviderResult(providerResult, "proposal")
        ? providerResult.proposal
        : providerResult;
      const validation = validateBasketProposal(proposalPayload);

      if (validation.status === PROPOSAL_STATUS.REJECTED) {
        state = freezeState(BASKET_PROPOSAL_STATUS.REJECTED, { validation });
        return state;
      }

      const mergeResult = applyValidatedBasket(validation.basket) ?? {};
      const mergeRejectedRows = Array.isArray(mergeResult.rejectedRows)
        ? mergeResult.rejectedRows
        : [];

      const status =
        validation.status === PROPOSAL_STATUS.PARTIAL
        || mergeRejectedRows.length > 0
          ? BASKET_PROPOSAL_STATUS.PARTIAL
          : BASKET_PROPOSAL_STATUS.SUCCESS;

      state = freezeState(status, {
        validation,
        mergeRejectedRows
      });
      return state;
    } catch {
      if (requestId !== requestVersion) {
        return state;
      }

      state = freezeState(BASKET_PROPOSAL_STATUS.ERROR);
      return state;
    }
  };

  return Object.freeze({
    getState,
    invalidate,
    run
  });
}
