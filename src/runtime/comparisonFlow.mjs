export const COMPARISON_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  SUCCESS: "success",
  STALE: "stale",
  NO_WINNER: "no-winner",
  ERROR: "error"
});

function freezeState(status, result = null) {
  return Object.freeze({ status, result });
}

export function createComparisonFlow(compare, {
  getResultExpiresAt = () => null,
  now = () => Date.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  onExpire = () => {}
} = {}) {
  if (typeof compare !== "function") {
    throw new TypeError("comparison flow requires a compare function");
  }
  if ([getResultExpiresAt, now, schedule, cancel, onExpire].some(value => typeof value !== "function")) {
    throw new TypeError("comparison expiry requires lifecycle functions");
  }

  let requestVersion = 0;
  let state = freezeState(COMPARISON_STATUS.IDLE);
  let pendingRun = null;
  let expiresAt = null;
  let expiryTimer = null;

  const clearExpiry = () => {
    if (expiryTimer !== null) cancel(expiryTimer);
    expiryTimer = null;
    expiresAt = null;
  };

  const checkExpiry = () => {
    if (state.status === COMPARISON_STATUS.SUCCESS && expiresAt !== null && now() > expiresAt) {
      clearExpiry();
      requestVersion += 1;
      state = freezeState(COMPARISON_STATUS.STALE);
      onExpire();
    }
    return state;
  };

  const armExpiry = () => {
    if (expiresAt === null || state.status !== COMPARISON_STATUS.SUCCESS) return;
    // Accepted observations include their exact age boundary. Invalidate on
    // the first millisecond beyond it, including after a suspended timer.
    const delay = Math.min(2_147_483_647, Math.max(1, expiresAt - now() + 1));
    const version = requestVersion;
    expiryTimer = schedule(() => {
      if (version !== requestVersion) return;
      expiryTimer = null;
      checkExpiry();
      armExpiry();
    }, delay);
  };

  const getState = () => checkExpiry();

  const invalidate = () => {
    clearExpiry();
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
    clearExpiry();
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

        if (state.status === COMPARISON_STATUS.SUCCESS) {
          const deadline = getResultExpiresAt(result);
          expiresAt = deadline === null ? null : Number.isSafeInteger(deadline) ? deadline : 0;
          checkExpiry();
          armExpiry();
        }

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
    checkExpiry,
    invalidate,
    run
  });
}
