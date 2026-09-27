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
export const MAX_RUNTIME_PROPOSAL_CATALOG_ITEMS = 50;

function freezeState(status, details = {}) {
  return Object.freeze({
    status,
    validation: details.validation ?? null,
    mergeRejectedRows: details.mergeRejectedRows ?? [],
    inputReason: details.inputReason ?? null
  });
}

function isAsyncFunction(value) {
  return value?.constructor?.name === "AsyncFunction";
}

function isThenable(value) {
  return Boolean(
    value
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function"
  );
}

function isTypedProviderResult(value, type) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && value.kind === type
  );
}

function snapshotRuntimeCatalog(catalog) {
  if (
    !Array.isArray(catalog)
    || catalog.length === 0
    || catalog.length > MAX_RUNTIME_PROPOSAL_CATALOG_ITEMS
  ) {
    throw new TypeError("runtime proposal catalog is invalid");
  }

  const seen = new Set();
  const snapshot = catalog.map((product) => {
    if (!product || typeof product !== "object" || Array.isArray(product)) {
      throw new TypeError("runtime proposal catalog product is invalid");
    }

    const { id, name, unit } = product;
    if (
      ![id, name, unit].every((value) => (
        typeof value === "string"
        && value.length > 0
        && value.trim() === value
      ))
      || seen.has(id)
    ) {
      throw new TypeError("runtime proposal catalog product is invalid");
    }

    seen.add(id);
    return Object.freeze({ id, name, unit });
  });

  return Object.freeze(snapshot);
}

export function createBasketProposalFlow(propose, applyValidatedBasket, options = {}) {
  if (typeof propose !== "function") {
    throw new TypeError("basket proposal flow requires a proposal function");
  }
  if (typeof applyValidatedBasket !== "function") {
    throw new TypeError("basket proposal flow requires an apply function");
  }
  if (isAsyncFunction(applyValidatedBasket)) {
    throw new TypeError("basket proposal mutation must be synchronous");
  }
  if (
    options.resolveCatalog != null
    && typeof options.resolveCatalog !== "function"
  ) {
    throw new TypeError("basket proposal flow catalog resolver must be a function");
  }

  const resolveCatalog = options.resolveCatalog ?? null;
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
      let runtimeCatalog = null;
      if (resolveCatalog) {
        runtimeCatalog = snapshotRuntimeCatalog(
          await resolveCatalog(normalizedText)
        );

        if (requestId !== requestVersion) {
          return state;
        }
      }

      const providerResult = runtimeCatalog
        ? await propose(normalizedText, runtimeCatalog)
        : await propose(normalizedText);

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
      const validation = validateBasketProposal(
        proposalPayload,
        runtimeCatalog ? { catalog: runtimeCatalog } : undefined
      );

      if (validation.status === PROPOSAL_STATUS.REJECTED) {
        state = freezeState(BASKET_PROPOSAL_STATUS.REJECTED, { validation });
        return state;
      }

      let mergeResult;
      try {
        const applied = applyValidatedBasket(validation.basket);
        if (isThenable(applied)) {
          state = freezeState(BASKET_PROPOSAL_STATUS.ERROR);
          return state;
        }
        mergeResult = applied ?? {};
      } catch {
        if (requestId !== requestVersion) {
          return state;
        }
        state = freezeState(BASKET_PROPOSAL_STATUS.ERROR);
        return state;
      }

      if (requestId !== requestVersion) {
        return state;
      }

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
