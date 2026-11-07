export const HYBRID_COMMIT_RESULT = Object.freeze({
  APPLIED: "applied",
  STALE: "stale",
  ALREADY_COMMITTED: "already_committed",
  MUTATION_FAILED: "mutation_failed"
});

function validRequestId(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isAsyncFunction(value) {
  return value?.constructor?.name === "AsyncFunction";
}

export function createHybridBasketRequestGate() {
  let currentRequestId = 0;
  let committedRequestId = null;

  const beginRequest = () => {
    currentRequestId += 1;
    committedRequestId = null;
    return currentRequestId;
  };

  const invalidate = () => {
    currentRequestId += 1;
    committedRequestId = null;
    return currentRequestId;
  };

  const isCurrent = (requestId) => (
    validRequestId(requestId)
    && requestId === currentRequestId
  );

  const commitLatest = (requestId, mutate, ...args) => {
    if (!validRequestId(requestId)) {
      throw new TypeError("hybrid request id is invalid");
    }
    if (typeof mutate !== "function") {
      throw new TypeError("hybrid mutation must be a function");
    }
    if (isAsyncFunction(mutate)) {
      throw new TypeError("hybrid mutation must be synchronous");
    }

    if (requestId !== currentRequestId) {
      return Object.freeze({
        kind: HYBRID_COMMIT_RESULT.STALE
      });
    }

    if (committedRequestId === requestId) {
      return Object.freeze({
        kind: HYBRID_COMMIT_RESULT.ALREADY_COMMITTED
      });
    }

    committedRequestId = requestId;

    try {
      const value = mutate(...args);

      if (
        value
        && typeof value === "object"
        && typeof value.then === "function"
      ) {
        return Object.freeze({
          kind: HYBRID_COMMIT_RESULT.MUTATION_FAILED,
          code: "async_mutation_not_allowed"
        });
      }

      return Object.freeze({
        kind: HYBRID_COMMIT_RESULT.APPLIED,
        value: value ?? null
      });
    } catch {
      return Object.freeze({
        kind: HYBRID_COMMIT_RESULT.MUTATION_FAILED,
        code: "mutation_failed"
      });
    }
  };

  const getCurrentRequestId = () => currentRequestId;

  return Object.freeze({
    beginRequest,
    commitLatest,
    getCurrentRequestId,
    invalidate,
    isCurrent
  });
}
