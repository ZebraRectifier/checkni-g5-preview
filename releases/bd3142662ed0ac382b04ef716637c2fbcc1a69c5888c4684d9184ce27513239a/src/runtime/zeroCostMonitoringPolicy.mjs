import { isObservationFresh } from "../adapters/publicPageObservationAdapter.mjs";

export const MONITORING_MODE = Object.freeze({
  ON_DEMAND: "on-demand"
});

export const MONITOR_DECISION = Object.freeze({
  REUSE_FRESH: "reuse-fresh",
  REFRESH_ALLOWED: "refresh-allowed",
  COOLDOWN: "cooldown",
  SOURCE_DISABLED: "source-disabled"
});

export const BLOCKING_FAILURE = Object.freeze({
  HTTP_403: "http-403",
  HTTP_429: "http-429",
  CAPTCHA: "captcha",
  ACCESS_BLOCKED: "access-blocked"
});

export const ZERO_COST_MONITORING_POLICY = Object.freeze({
  mode: MONITORING_MODE.ON_DEMAND,
  incrementalBudgetRub: 0,
  requiresOutreach: false,
  scheduledPolling: false,
  paidApisAllowed: false,
  paidBrowsersAllowed: false,
  paidProxiesAllowed: false,
  captchaBypassAllowed: false,
  authHarvestingAllowed: false,
  maxRefreshAttemptsPerUserRequest: 1,
  defaultCooldownMs: 6 * 60 * 60 * 1000
});

const BLOCKING_FAILURES = new Set(Object.values(BLOCKING_FAILURE));

function validTimestamp(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function decideObservationRefresh({
  observation = null,
  nowMs = Date.now(),
  maxAgeMs,
  sourceMonitoringEnabled = true,
  lastFailure = null,
  cooldownMs = ZERO_COST_MONITORING_POLICY.defaultCooldownMs
} = {}) {
  if (!sourceMonitoringEnabled) {
    return Object.freeze({
      decision: MONITOR_DECISION.SOURCE_DISABLED,
      retryAfterMs: null
    });
  }

  if (
    observation
    && isObservationFresh(observation, { nowMs, maxAgeMs })
  ) {
    return Object.freeze({
      decision: MONITOR_DECISION.REUSE_FRESH,
      retryAfterMs: null
    });
  }

  if (
    lastFailure
    && BLOCKING_FAILURES.has(lastFailure.code)
    && Number.isFinite(cooldownMs)
    && cooldownMs >= 0
  ) {
    const failedAtMs = validTimestamp(lastFailure.at);
    if (failedAtMs != null && failedAtMs <= nowMs) {
      const elapsed = nowMs - failedAtMs;
      if (elapsed < cooldownMs) {
        return Object.freeze({
          decision: MONITOR_DECISION.COOLDOWN,
          retryAfterMs: cooldownMs - elapsed
        });
      }
    }
  }

  return Object.freeze({
    decision: MONITOR_DECISION.REFRESH_ALLOWED,
    retryAfterMs: null
  });
}

export function canUsePaidMonitoring() {
  return false;
}

export function canRequirePartnerOutreach() {
  return false;
}
