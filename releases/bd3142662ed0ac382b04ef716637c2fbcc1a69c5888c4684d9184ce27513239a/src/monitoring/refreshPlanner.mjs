import {
  MONITOR_DECISION,
  decideObservationRefresh
} from "../runtime/zeroCostMonitoringPolicy.mjs";
import { SENSOR_SOURCES } from "../sensors/sourceRegistry.mjs";

export function planSensorRefreshes({
  sources = SENSOR_SOURCES,
  observationsBySource = {},
  failuresBySource = {},
  nowMs = Date.now(),
  maxAgeMs
} = {}) {
  return Object.freeze(sources.map((source) => {
    if (source.capabilities.automatedObservation !== true) {
      return Object.freeze({
        sourceId: source.id,
        decision: MONITOR_DECISION.SOURCE_DISABLED,
        reason: "automated_observation_not_proven",
        retryAfterMs: null
      });
    }

    const refresh = decideObservationRefresh({
      observation: observationsBySource[source.id] ?? null,
      lastFailure: failuresBySource[source.id] ?? null,
      nowMs,
      maxAgeMs,
      sourceMonitoringEnabled: true
    });

    return Object.freeze({
      sourceId: source.id,
      decision: refresh.decision,
      reason: null,
      retryAfterMs: refresh.retryAfterMs
    });
  }));
}

export function getRefreshableSourceIds(plan) {
  return Object.freeze(
    plan
      .filter((item) => item.decision === MONITOR_DECISION.REFRESH_ALLOWED)
      .map((item) => item.sourceId)
  );
}
