export const COMPARISON_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  SUCCESS: "success",
  NO_WINNER: "no-winner",
  ERROR: "error"
});

function freezeState(status, result = null) {
  return Object.freeze({ status, result });
}

export function createComparisonFlow(compare) {
  if (typeof compare !== "function") {
    throw new TypeError("comparison flow requires a compare function");
  }

  let requestVersion = 0;
  let state = freezeState(COMPARISON_STATUS.IDLE);
  let pendingRun = null;

  const getState = () => state;

  const invalidate = () => {
    requestVersion += 1;
    pendingRun = null;
    state = freezeState(COMPARISON_STATUS.IDLE);
    return state;
  };

  const run = (surfaceBasket) => {
    if (!Array.isArray(surfaceBasket) || surfaceBasket.length === 0) {
      return Promise.resolve(invalidate());
    }

    const snapshot = surfaceBasket.map((item) => ({ ...item }));
    const requestKey = JSON.stringify(snapshot);

    if (
      pendingRun
      && pendingRun.requestKey === requestKey
      && state.status === COMPARISON_STATUS.LOADING
    ) {
      return pendingRun.promise;
    }

    const requestId = ++requestVersion;
    state = freezeState(COMPARISON_STATUS.LOADING);

    const token = {
      requestId,
      requestKey,
      promise: null
    };
    pendingRun = token;

    const executionPromise = (async () => {
      try {
        const result = await compare(snapshot);

        if (requestId !== requestVersion) {
          return state;
        }

        const hasAuthoritativeObservedConclusion = (
          result?.kind === "observed-price-comparison"
          && typeof result?.conclusion?.kind === "string"
        );

        state = (result?.winner || hasAuthoritativeObservedConclusion)
          ? freezeState(COMPARISON_STATUS.SUCCESS, result)
          : freezeState(COMPARISON_STATUS.NO_WINNER);

        return state;
      } catch {
        if (requestId !== requestVersion) {
          return state;
        }

        state = freezeState(COMPARISON_STATUS.ERROR);
        return state;
      } finally {
        if (pendingRun === token) {
          pendingRun = null;
        }
      }
    })();

    token.promise = executionPromise;
    return executionPromise;
  };

  return Object.freeze({
    getState,
    invalidate,
    run
  });
}
