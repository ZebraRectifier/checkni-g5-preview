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
  getContext = () => null,
  getResultExpiresAt = () => null,
  now = () => Date.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  onExpire = () => {},
  onReceiptInvalidated = () => {}
} = {}) {
  if (typeof compare !== "function") {
    throw new TypeError("comparison flow requires a compare function");
  }
  if ([getContext, getResultExpiresAt, now, schedule, cancel, onExpire, onReceiptInvalidated].some(value => typeof value !== "function")) {
    throw new TypeError("comparison expiry requires lifecycle functions");
  }

  let requestVersion = 0;
  let state = freezeState(COMPARISON_STATUS.IDLE);
  let pendingRun = null;
  let expiresAt = null;
  let expiryTimer = null;
  let receipt = null;
  const basketKey = rows => JSON.stringify(Array.isArray(rows) ? rows.map(({ id, name, unit, quantity }) => ({ id, name, unit, quantity })) : null);
  const contextSnapshot = () => {
    try {
      const value = getContext();
      if (!value || typeof value !== "object") return null;
      const key = JSON.stringify(value);
      const freeze = item => {
        if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); }
        return item;
      };
      return { key, value: freeze(JSON.parse(key)) };
    } catch { return null; }
  };
  const clearReceipt = () => {
    if (!receipt) return;
    receipt = null;
    try { onReceiptInvalidated(); } catch { /* Presentation cannot change comparison truth. */ }
  };

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
      clearReceipt();
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
    clearReceipt();
    return state;
  };

  const run = (surfaceBasket) => {
    if (!Array.isArray(surfaceBasket) || surfaceBasket.length === 0) {
      return Promise.resolve(invalidate());
    }

    const snapshot = surfaceBasket.map((item) => ({ ...item }));
    const context = contextSnapshot();
    const requestKey = JSON.stringify([snapshot, context?.key ?? null]);

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
    clearReceipt();

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
        if (context?.key !== contextSnapshot()?.key) return invalidate();

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
          if (state.status === COMPARISON_STATUS.SUCCESS && context) receipt = Object.freeze({
            result, context: context.value, basketKey: basketKey(snapshot), expiresAt
          });
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

  const getCurrentComparison = surfaceBasket => {
    checkExpiry();
    if (state.status !== COMPARISON_STATUS.SUCCESS || !receipt) return null;
    if (receipt.basketKey !== basketKey(surfaceBasket) || JSON.stringify(receipt.context) !== contextSnapshot()?.key) {
      invalidate(); return null;
    }
    return receipt;
  };

  return Object.freeze({
    getState,
    checkExpiry,
    getCurrentComparison,
    invalidate,
    run
  });
}
