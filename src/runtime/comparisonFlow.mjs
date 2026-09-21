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

  const getState = () => state;

  const invalidate = () => {
    requestVersion += 1;
    state = freezeState(COMPARISON_STATUS.IDLE);
    return state;
  };

  const run = async (surfaceBasket) => {
    if (!Array.isArray(surfaceBasket) || surfaceBasket.length === 0) {
      return invalidate();
    }

    const requestId = ++requestVersion;
    const snapshot = surfaceBasket.map((item) => ({ ...item }));
    state = freezeState(COMPARISON_STATUS.LOADING);

    try {
      const result = await compare(snapshot);

      if (requestId !== requestVersion) {
        return state;
      }

      state = result?.winner
        ? freezeState(COMPARISON_STATUS.SUCCESS, result)
        : freezeState(COMPARISON_STATUS.NO_WINNER);

      return state;
    } catch {
      if (requestId !== requestVersion) {
        return state;
      }

      state = freezeState(COMPARISON_STATUS.ERROR);
      return state;
    }
  };

  return Object.freeze({
    getState,
    invalidate,
    run
  });
}
