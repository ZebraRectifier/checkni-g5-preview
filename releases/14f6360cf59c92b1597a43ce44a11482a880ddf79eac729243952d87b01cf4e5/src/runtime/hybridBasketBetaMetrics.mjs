export const HYBRID_BETA_METRICS_KEY =
  "checkni.hybrid.beta.metrics.v1";

const MAX_COUNTER = 1_000_000;
const MAX_LATENCY_SUM_MS = 60_000_000_000;

const KNOWN_ACTIONS = new Set([
  "manual_fallback",
  "clarification_edit",
  "pending_edit_cancelled",
  "draft_confirmed",
  "partial_found_only"
]);

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function emptySummary() {
  return {
    version: 1,
    totalEvents: 0,
    totalLatencyMs: 0,
    totalItems: 0,
    outcomes: {},
    reasons: {},
    actions: {}
  };
}

function safeCounter(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_COUNTER
    ? value
    : 0;
}

function safeLatencySum(value) {
  return Number.isFinite(value)
    && value >= 0
    && value <= MAX_LATENCY_SUM_MS
    ? Math.round(value)
    : 0;
}

function safeBucketMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result = {};
  for (const [key, count] of Object.entries(value)) {
    if (
      /^[a-z0-9_]{1,40}$/.test(key)
      && safeCounter(count) === count
    ) {
      result[key] = count;
    }
  }
  return result;
}

function normalizeSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptySummary();
  }

  return {
    version: 1,
    totalEvents: safeCounter(value.totalEvents),
    totalLatencyMs: safeLatencySum(value.totalLatencyMs),
    totalItems: safeCounter(value.totalItems),
    outcomes: safeBucketMap(value.outcomes),
    reasons: safeBucketMap(value.reasons),
    actions: safeBucketMap(value.actions)
  };
}

function increment(map, key) {
  map[key] = Math.min(
    MAX_COUNTER,
    safeCounter(map[key]) + 1
  );
}

function parseStored(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    return raw ? normalizeSummary(JSON.parse(raw)) : emptySummary();
  } catch {
    return emptySummary();
  }
}

function persist(storage, key, summary) {
  try {
    storage?.setItem?.(key, JSON.stringify(summary));
  } catch {
    // Beta metrics are best-effort and must never affect shopping.
  }
}

function freezeSummary(summary) {
  const totalEvents = summary.totalEvents;
  return Object.freeze({
    version: 1,
    totalEvents,
    averageLatencyMs: totalEvents === 0
      ? 0
      : Math.round(summary.totalLatencyMs / totalEvents),
    averageItems: totalEvents === 0
      ? 0
      : Math.round((summary.totalItems / totalEvents) * 100) / 100,
    outcomes: Object.freeze({ ...summary.outcomes }),
    reasons: Object.freeze({ ...summary.reasons }),
    actions: Object.freeze({ ...summary.actions })
  });
}

export function createHybridBetaMetricsStore(options = {}) {
  const storage = Object.hasOwn(options, "storage")
    ? options.storage
    : defaultStorage();
  const key = options.key ?? HYBRID_BETA_METRICS_KEY;
  let summary = parseStored(storage, key);

  const record = (event) => {
    if (
      !event
      || typeof event !== "object"
      || Array.isArray(event)
      || typeof event.outcome !== "string"
      || typeof event.reason !== "string"
      || !Number.isFinite(event.latencyMs)
      || event.latencyMs < 0
      || !Number.isInteger(event.itemCount)
      || event.itemCount < 0
    ) {
      return getSummary();
    }

    summary.totalEvents = Math.min(
      MAX_COUNTER,
      summary.totalEvents + 1
    );
    summary.totalLatencyMs = Math.min(
      MAX_LATENCY_SUM_MS,
      summary.totalLatencyMs + Math.round(event.latencyMs)
    );
    summary.totalItems = Math.min(
      MAX_COUNTER,
      summary.totalItems + event.itemCount
    );

    if (/^[a-z0-9_]{1,40}$/.test(event.outcome)) {
      increment(summary.outcomes, event.outcome);
    }
    if (/^[a-z0-9_]{1,40}$/.test(event.reason)) {
      increment(summary.reasons, event.reason);
    }

    persist(storage, key, summary);
    return getSummary();
  };

  const recordAction = (action) => {
    if (!KNOWN_ACTIONS.has(action)) return getSummary();

    increment(summary.actions, action);
    persist(storage, key, summary);
    return getSummary();
  };

  function getSummary() {
    return freezeSummary(summary);
  }

  const reset = () => {
    summary = emptySummary();
    try {
      storage?.removeItem?.(key);
    } catch {
      // Best-effort local beta diagnostics only.
    }
    return getSummary();
  };

  return Object.freeze({
    getSummary,
    record,
    recordAction,
    reset
  });
}
