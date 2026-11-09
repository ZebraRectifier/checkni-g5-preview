import {
  validateUserEvidenceObservation
} from "./userEvidence.mjs";

export const LOCAL_USER_EVIDENCE_STORAGE_KEY =
  "checkni.surface.user-price-evidence.v1";
export const MAX_LOCAL_USER_EVIDENCE_RECORDS = 200;
export const LOCAL_USER_EVIDENCE_RETENTION_MS = 24 * 60 * 60 * 1000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveStorage(explicitStorage) {
  if (explicitStorage !== undefined) return explicitStorage;

  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validTimePolicy(nowMs, retentionMs) {
  return (
    Number.isFinite(nowMs)
    && Number.isFinite(retentionMs)
    && retentionMs >= 0
  );
}

function readArray(storage, key) {
  if (!storage) return [];

  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArray(storage, key, rows) {
  if (!storage) return false;

  try {
    storage.setItem(key, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

function acceptedEntry(input, { nowMs, retentionMs }) {
  if (!isRecord(input)) return null;

  const accepted = validateUserEvidenceObservation(input);
  if (accepted.kind !== "accepted") return null;

  const observedAtMs = Date.parse(accepted.observation.observedAt);
  if (!Number.isFinite(observedAtMs)) return null;
  if (observedAtMs > nowMs) return null;
  if (nowMs - observedAtMs > retentionMs) return null;

  return Object.freeze({
    input: Object.freeze(clone(input)),
    observation: accepted.observation,
    match: accepted.match,
    observedAtMs
  });
}

function sortNewestFirst(left, right) {
  if (left.observedAtMs !== right.observedAtMs) {
    return right.observedAtMs - left.observedAtMs;
  }

  return left.observation.evidenceId.localeCompare(
    right.observation.evidenceId,
    "en"
  );
}

function semanticEvidenceKey(entry) {
  return [
    entry.observation.context?.locationId ?? "",
    entry.match.canonicalProductId
  ].join("|");
}

function semanticTruthFingerprint(entry) {
  const observation = entry.observation;
  const context = observation.context ?? {};

  return JSON.stringify([
    observation.priceMinor,
    observation.currency ?? null,
    observation.availability ?? null,
    observation.salesChannel ?? null,
    observation.priceCondition ?? null,
    observation.conditionNote ?? null,
    context.countryCode ?? null,
    context.regionId ?? null,
    context.localityId ?? null,
    context.locationId ?? null,
    context.storeId ?? null,
    context.storeName ?? null
  ]);
}

function newestSemanticEntries(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    const key = semanticEvidenceKey(entry);
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  const latest = [];

  for (const bucket of grouped.values()) {
    const ordered = bucket.slice().sort(sortNewestFirst);
    const newestAt = ordered[0]?.observedAtMs;
    if (!Number.isFinite(newestAt)) continue;

    const newest = ordered.filter(
      (entry) => entry.observedAtMs === newestAt
    );
    const facts = new Set(newest.map(semanticTruthFingerprint));

    if (facts.size !== 1) {
      continue;
    }

    latest.push(newest[0]);
  }

  return latest.sort(sortNewestFirst);
}

export function loadLocalUserEvidence(options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("local user evidence options must be an object");
  }

  const storage = resolveStorage(options.storage);
  const storageKey =
    options.storageKey ?? LOCAL_USER_EVIDENCE_STORAGE_KEY;
  const nowMs = options.nowMs ?? Date.now();
  const retentionMs =
    options.retentionMs ?? LOCAL_USER_EVIDENCE_RETENTION_MS;

  if (typeof storageKey !== "string" || !storageKey.trim()) {
    throw new TypeError("local user evidence storageKey is invalid");
  }
  if (!validTimePolicy(nowMs, retentionMs)) {
    throw new TypeError("local user evidence time policy is invalid");
  }

  const accepted = newestSemanticEntries(
    readArray(storage, storageKey)
      .map((input) => acceptedEntry(input, { nowMs, retentionMs }))
      .filter(Boolean)
  ).slice(0, MAX_LOCAL_USER_EVIDENCE_RECORDS);

  return Object.freeze(accepted);
}

export function saveLocalUserEvidence(input, options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("local user evidence options must be an object");
  }

  const storage = resolveStorage(options.storage);
  const storageKey =
    options.storageKey ?? LOCAL_USER_EVIDENCE_STORAGE_KEY;
  const nowMs = options.nowMs ?? Date.now();
  const retentionMs =
    options.retentionMs ?? LOCAL_USER_EVIDENCE_RETENTION_MS;

  if (!validTimePolicy(nowMs, retentionMs)) {
    throw new TypeError("local user evidence time policy is invalid");
  }

  const next = acceptedEntry(input, { nowMs, retentionMs });
  if (!next) {
    const validation = isRecord(input)
      ? validateUserEvidenceObservation(input)
      : { kind: "rejected", reason: "invalid_shape" };

    return Object.freeze({
      kind: "rejected",
      reason: validation.reason ?? "invalid_evidence"
    });
  }

  const nextKey = semanticEvidenceKey(next);
  const existing = loadLocalUserEvidence({
    storage,
    storageKey,
    nowMs,
    retentionMs
  }).filter((entry) => (
    entry.observation.evidenceId !== next.observation.evidenceId
  ));

  const merged = newestSemanticEntries([next, ...existing])
    .slice(0, MAX_LOCAL_USER_EVIDENCE_RECORDS);
  const selectedForKey = merged.find(
    (entry) => semanticEvidenceKey(entry) === nextKey
  );
  const rows = merged.map((entry) => entry.input);

  if (!writeArray(storage, storageKey, rows)) {
    return Object.freeze({
      kind: "unavailable",
      reason: "storage_unavailable"
    });
  }

  return Object.freeze({
    kind: "accepted",
    evidenceId:
      selectedForKey?.observation.evidenceId
      ?? next.observation.evidenceId,
    replacedByNewer: (
      selectedForKey?.observation.evidenceId
      !== next.observation.evidenceId
    ),
    count: rows.length
  });
}

export function clearLocalUserEvidence(options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("local user evidence options must be an object");
  }

  const storage = resolveStorage(options.storage);
  const storageKey =
    options.storageKey ?? LOCAL_USER_EVIDENCE_STORAGE_KEY;

  if (!storage) return false;

  try {
    storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}
