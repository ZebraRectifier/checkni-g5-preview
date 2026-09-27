const OUTCOME_BY_RESULT = Object.freeze({
  "proposal:local": "local_proposal",
  "proposal:ai": "ai_proposal",
  "clarification:ai": "clarification",
  "rejected:local": "local_reject",
  "rejected:ai": "ai_reject",
  "unavailable:ai": "ai_unavailable",
  "error:local": "local_error",
  "error:ai": "ai_error"
});

const SAFE_REASON = new Set([
  "semantic_intent",
  "commercial_constraint",
  "ambiguous_segment",
  "unresolved_segment",
  "identity_specification",
  "unit_quantity_ambiguous",
  "quantity_out_of_range",
  "context_correction",
  "prompt_injection",
  "partial_validation",
  "confirmation_required",
  "ai_proposal_rejected",
  "empty",
  "too_long"
]);

export const HYBRID_METRIC_MAX_LATENCY_MS = 60_000;

function finiteLatency(value) {
  return Number.isFinite(value)
    && value >= 0
    && value <= HYBRID_METRIC_MAX_LATENCY_MS;
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 50
    ? value
    : 0;
}

function safeReason(value) {
  return SAFE_REASON.has(value) ? value : "other";
}

function resultItemCount(result) {
  if (Array.isArray(result?.proposal?.items)) {
    return safeCount(result.proposal.items.length);
  }
  if (Array.isArray(result?.draftProposal?.items)) {
    return safeCount(result.draftProposal.items.length);
  }
  if (Array.isArray(result?.validation?.acceptedRows)) {
    return safeCount(result.validation.acceptedRows.length);
  }
  return 0;
}

export function createHybridMetricEvent({
  result,
  latencyMs,
  corrected = false
}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("hybrid metric result is invalid");
  }
  if (!finiteLatency(latencyMs)) {
    throw new TypeError("hybrid metric latency is invalid");
  }

  const key = `${String(result.kind)}:${String(result.source)}`;
  const outcome = OUTCOME_BY_RESULT[key] ?? "other";
  const reason = safeReason(
    result.triggerReason
      ?? result.reason
      ?? result.code
      ?? null
  );

  return Object.freeze({
    outcome,
    reason,
    latencyMs: Math.round(latencyMs),
    itemCount: resultItemCount(result),
    corrected: corrected === true
  });
}

export function aggregateHybridMetricEvents(events) {
  if (!Array.isArray(events)) {
    throw new TypeError("hybrid metric events must be an array");
  }

  const outcomes = new Map();
  const reasons = new Map();
  let corrected = 0;
  let totalLatency = 0;

  for (const event of events) {
    if (
      !event
      || typeof event !== "object"
      || Array.isArray(event)
      || typeof event.outcome !== "string"
      || typeof event.reason !== "string"
      || !finiteLatency(event.latencyMs)
      || !Number.isInteger(event.itemCount)
      || event.itemCount < 0
      || typeof event.corrected !== "boolean"
    ) {
      throw new TypeError("hybrid metric event is invalid");
    }

    outcomes.set(
      event.outcome,
      (outcomes.get(event.outcome) ?? 0) + 1
    );
    reasons.set(
      event.reason,
      (reasons.get(event.reason) ?? 0) + 1
    );
    if (event.corrected) corrected += 1;
    totalLatency += event.latencyMs;
  }

  return Object.freeze({
    total: events.length,
    corrected,
    correctionPercent: events.length === 0
      ? 0
      : Math.round((corrected / events.length) * 10_000) / 100,
    averageLatencyMs: events.length === 0
      ? 0
      : Math.round(totalLatency / events.length),
    outcomes: Object.freeze(Object.fromEntries(
      [...outcomes.entries()].sort(([left], [right]) => (
        left.localeCompare(right)
      ))
    )),
    reasons: Object.freeze(Object.fromEntries(
      [...reasons.entries()].sort(([left], [right]) => (
        left.localeCompare(right)
      ))
    ))
  });
}
