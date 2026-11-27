import { getRetailerIdentity } from "../data/retailerRegistry.mjs";
export const YANDEX_PRODUCT_MAPPING_STORAGE_KEY =
  "checkni.surface.yandex-product-mapping.v1";
export const MAX_YANDEX_PRODUCT_MAPPINGS = 120;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, max) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function resolveStorage(explicitStorage) {
  if (explicitStorage !== undefined) return explicitStorage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readRows(storage, key) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRows(storage, key, rows) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

function normalizeContext(context) {
  if (!isRecord(context)) return null;

  const countryCode = cleanString(context.countryCode, 2)?.toUpperCase();
  const regionId = cleanString(context.regionId, 180);
  const regionName = cleanString(context.regionName, 240);
  const localityId = cleanString(context.localityId, 180);
  const localityName = cleanString(context.localityName, 240);
  const retailerId = cleanString(context.retailerId, 80);
  const retailer = retailerId ? getRetailerIdentity(retailerId) : null;

  if (
    countryCode !== "RU"
    || !regionId
    || !regionName
    || !localityId
    || !localityName
    || !retailer
  ) {
    return null;
  }

  return Object.freeze({
    countryCode: "RU",
    regionId,
    regionName,
    localityId,
    localityName,
    retailerId: retailer.id,
    locationId: `yandex-retailer:${retailer.id}:city:${localityId}`,
    locationLabel: `${retailer.name} · ${localityName}`
  });
}

export function normalizeYandexProductMapping(value) {
  if (!isRecord(value)) return null;

  const organizationId = cleanString(value.organizationId, 40);
  const sourceProductId = cleanString(value.sourceProductId, 180);
  const sourceProductName = cleanString(value.sourceProductName, 240);
  const canonicalProductId = cleanString(value.canonicalProductId, 180);
  const contextConfirmedAtMs = Date.parse(value.contextConfirmedAt);
  const mappedAtMs = Date.parse(value.mappedAt);

  if (
    !organizationId
    || !/^\d+$/.test(organizationId)
    || !sourceProductId
    || !sourceProductName
    || !canonicalProductId
    || !Number.isFinite(contextConfirmedAtMs)
    || !Number.isFinite(mappedAtMs)
    || Math.abs(contextConfirmedAtMs - mappedAtMs) > 60_000
  ) {
    return null;
  }

  const context = normalizeContext(value.context);
  if (!context) return null;

  return Object.freeze({
    organizationId,
    sourceProductId,
    sourceProductName,
    canonicalProductId,
    context,
    contextConfirmedAt: new Date(contextConfirmedAtMs).toISOString(),
    mappedAt: new Date(mappedAtMs).toISOString()
  });
}

function semanticKey(mapping) {
  return `${mapping.organizationId}|${mapping.sourceProductId}`;
}

function mappingTruthFingerprint(mapping) {
  return JSON.stringify([
    mapping.sourceProductName,
    mapping.canonicalProductId,
    mapping.context.countryCode,
    mapping.context.regionId,
    mapping.context.regionName,
    mapping.context.localityId,
    mapping.context.localityName,
    mapping.context.retailerId
  ]);
}

function newestMappingState(rows, keyValue) {
  const scoped = rows
    .filter((mapping) => semanticKey(mapping) === keyValue)
    .sort((a, b) => b.mappedAt.localeCompare(a.mappedAt));

  if (scoped.length === 0) {
    return { kind: "none", rows: [] };
  }

  const mappedAt = scoped[0].mappedAt;
  const newest = scoped.filter((mapping) => mapping.mappedAt === mappedAt);
  const facts = new Set(newest.map(mappingTruthFingerprint));

  if (facts.size > 1) {
    return { kind: "conflict", mappedAt, rows: newest };
  }

  return { kind: "coherent", mappedAt, rows: newest };
}

export function loadYandexProductMappings(options = {}) {
  const storage = resolveStorage(options.storage);
  const key = options.storageKey ?? YANDEX_PRODUCT_MAPPING_STORAGE_KEY;
  const normalized = readRows(storage, key)
    .map(normalizeYandexProductMapping)
    .filter(Boolean)
    .sort((a, b) => b.mappedAt.localeCompare(a.mappedAt));

  const latest = new Map();
  const conflicted = new Set();

  for (const mapping of normalized) {
    const keyValue = semanticKey(mapping);
    if (conflicted.has(keyValue)) continue;

    const current = latest.get(keyValue);
    if (!current) {
      latest.set(keyValue, mapping);
      continue;
    }

    if (current.mappedAt !== mapping.mappedAt) {
      continue;
    }

    const sameIdentity = (
      current.sourceProductName === mapping.sourceProductName
      && current.canonicalProductId === mapping.canonicalProductId
      && current.context.countryCode === mapping.context.countryCode
      && current.context.regionId === mapping.context.regionId
      && current.context.localityId === mapping.context.localityId
      && current.context.retailerId === mapping.context.retailerId
    );

    if (!sameIdentity) {
      latest.delete(keyValue);
      conflicted.add(keyValue);
    }
  }

  return Object.freeze(
    Array.from(latest.values()).slice(0, MAX_YANDEX_PRODUCT_MAPPINGS)
  );
}

export function saveYandexProductMapping(value, options = {}) {
  const mapping = normalizeYandexProductMapping(value);
  if (!mapping) {
    return Object.freeze({ kind: "rejected", reason: "invalid_mapping" });
  }

  const nowMs = options.nowMs ?? Date.now();
  const mappedAtMs = Date.parse(mapping.mappedAt);
  const contextConfirmedAtMs = Date.parse(mapping.contextConfirmedAt);
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(mappedAtMs)
    || !Number.isFinite(contextConfirmedAtMs)
    || mappedAtMs > nowMs
    || contextConfirmedAtMs > nowMs
  ) {
    return Object.freeze({ kind: "rejected", reason: "future_mapping" });
  }

  const storage = resolveStorage(options.storage);
  const key = options.storageKey ?? YANDEX_PRODUCT_MAPPING_STORAGE_KEY;
  const normalizedRows = readRows(storage, key)
    .map(normalizeYandexProductMapping)
    .filter(Boolean);
  const keyValue = semanticKey(mapping);
  const currentState = newestMappingState(normalizedRows, keyValue);
  const otherRows = normalizedRows.filter(
    (item) => semanticKey(item) !== keyValue
  );

  let selectedRows;
  let conflict = false;
  let authoritative = mapping;

  if (
    currentState.kind !== "none"
    && currentState.mappedAt > mapping.mappedAt
  ) {
    selectedRows = currentState.rows;
    authoritative = currentState.rows[0];
  } else if (
    currentState.kind !== "none"
    && currentState.mappedAt === mapping.mappedAt
  ) {
    const newest = currentState.rows.slice();
    const incomingFingerprint = mappingTruthFingerprint(mapping);
    const existingFingerprints = new Set(
      newest.map(mappingTruthFingerprint)
    );

    if (!existingFingerprints.has(incomingFingerprint)) {
      newest.push(mapping);
    }

    conflict = new Set(newest.map(mappingTruthFingerprint)).size > 1;
    selectedRows = newest;
    authoritative = conflict ? null : newest[0];
  } else {
    selectedRows = [mapping];
  }

  const rows = [...selectedRows, ...otherRows]
    .sort((a, b) => b.mappedAt.localeCompare(a.mappedAt))
    .slice(0, MAX_YANDEX_PRODUCT_MAPPINGS);

  if (!writeRows(storage, key, rows)) {
    return Object.freeze({ kind: "unavailable", reason: "storage_unavailable" });
  }

  if (conflict) {
    return Object.freeze({
      kind: "rejected",
      reason: "conflicting_mapping"
    });
  }

  return Object.freeze({
    kind: "accepted",
    organizationId: authoritative.organizationId,
    sourceProductId: authoritative.sourceProductId,
    canonicalProductId: authoritative.canonicalProductId,
    replacedByNewer: authoritative.mappedAt !== mapping.mappedAt,
    count: rows.length
  });
}

export function clearYandexProductMappings(options = {}) {
  const storage = resolveStorage(options.storage);
  const key = options.storageKey ?? YANDEX_PRODUCT_MAPPING_STORAGE_KEY;
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
