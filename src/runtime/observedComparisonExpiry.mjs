// Presentation lifetime only: prices, coverage, savings and recommendations
// remain the unchanged Core result. Callers supply the existing source age
// policy; this helper never treats an unsupported source as a fresh one.
export function observedComparisonExpiresAt(result, sourceMaxAgeMs) {
  if (result?.kind !== 'observed-price-comparison' || !Array.isArray(result.candidates)) return null;
  if (typeof sourceMaxAgeMs !== 'function') throw new TypeError('Observed expiry requires a source age policy');
  let earliest = null;
  for (const candidate of result.candidates) {
    for (const line of Array.isArray(candidate?.lines) ? candidate.lines : []) {
      if (line?.status !== OBSERVED_LINE_STATUS.PRICED) continue;
      const sourceId = line.provenance?.sourceId ?? candidate.sourceId;
      const maxAgeMs = sourceMaxAgeMs(sourceId);
      // A source with no supplied lifetime is outside this integration's
      // scope. It is never assigned a guessed retailer freshness interval.
      if (maxAgeMs === null || maxAgeMs === undefined) continue;
      const observedMs = typeof line.observedAt === 'string' ? Date.parse(line.observedAt) : NaN;
      if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0 || !Number.isFinite(observedMs)
          || !Number.isSafeInteger(observedMs + maxAgeMs)) return 0;
      const expiresAt = observedMs + maxAgeMs;
      earliest = earliest === null ? expiresAt : Math.min(earliest, expiresAt);
    }
  }
  return earliest;
}
import { OBSERVED_LINE_STATUS } from '../core/observed-price-core.mjs';

