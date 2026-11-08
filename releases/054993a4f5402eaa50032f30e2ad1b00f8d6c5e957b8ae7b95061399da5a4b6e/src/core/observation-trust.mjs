import {
  OBSERVATION_GRANULARITY,
  PUBLIC_PAGE_OBSERVATION_KIND
} from "../adapters/publicPageObservationAdapter.mjs";
import { getRetailerIdentity } from "../data/retailerRegistry.mjs";
import {
  MATCH_METHOD,
  MATCH_STATUS
} from "../matching/productMatch.mjs";
import { getSensorSource } from "../sensors/sourceRegistry.mjs";
import {
  COMMUNITY_EVIDENCE_SOURCE,
  USER_EVIDENCE_KIND,
  USER_EVIDENCE_PRICE_CONDITION,
  USER_EVIDENCE_SOURCE_ID
} from "../observations/userEvidence.mjs";

export const OBSERVATION_DISPOSITION = Object.freeze({
  ACCEPTED: "accepted",
  HISTORICAL_ONLY: "historical-only",
  REJECTED: "rejected",
  CONFLICT: "conflict"
});

export const OBSERVATION_FRESHNESS = Object.freeze({
  CURRENT: "current",
  STALE: "stale",
  FUTURE: "future",
  INVALID: "invalid"
});

export const OBSERVATION_TEMPORAL_CLASS = Object.freeze({
  CURRENT: "current",
  HISTORICAL: "historical"
});

export const LOCATION_TRUTH_LEVEL = Object.freeze({
  UNKNOWN: "unknown",
  REGION: "region",
  CITY: "city",
  STORE: "store"
});

export const OBSERVATION_AVAILABILITY = Object.freeze({
  UNKNOWN: "unknown",
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable"
});

export const OBSERVATION_SALES_CHANNEL = Object.freeze({
  ONLINE: "online",
  STORE: "store",
  UNKNOWN: "unknown"
});

export const OBSERVATION_PROOF_TYPE = Object.freeze({
  PUBLIC_PAGE: "public-page",
  OPEN_DATA: "open-data",
  RECEIPT: "receipt",
  PRICE_TAG: "price-tag",
  SHOP_IMPORT: "shop-import",
  USER_CONFIRMATION: "user-confirmation",
  OTHER: "other"
});

export const OBSERVATION_REASON = Object.freeze({
  CURRENT_OBSERVATION: "current_observation",
  SOURCE_HISTORICAL_ONLY: "source_historical_only",
  STALE_OBSERVATION: "stale_observation",
  RECEIPT_IS_HISTORICAL: "receipt_is_historical",
  MATCH_NOT_EXACT: "match_not_exact",
  UNPROVEN_EXACT_STORE_CONTEXT: "unproven_exact_store_context",
  UNRESOLVED_PRICE_CONDITION: "unresolved_price_condition",
  INVALID_OBSERVATION: "invalid_observation",
  UNKNOWN_SOURCE: "unknown_source",
  UNKNOWN_RETAILER: "unknown_retailer",
  SOURCE_MISMATCH: "source_mismatch",
  MATCH_NOT_CONFIRMED: "match_not_confirmed",
  PRODUCT_MISMATCH: "product_mismatch",
  MISSING_PRICE: "missing_price",
  INVALID_PRICE: "invalid_price",
  INVALID_QUANTITY: "invalid_quantity",
  INVALID_TIMESTAMP: "invalid_timestamp",
  FUTURE_TIMESTAMP: "future_timestamp",
  INVALID_SOURCE_URL: "invalid_source_url",
  INVALID_LOCATION: "invalid_location",
  INVALID_AVAILABILITY: "invalid_availability",
  INVALID_SALES_CHANNEL: "invalid_sales_channel",
  UNPROVEN_AVAILABILITY: "unproven_availability",
  INVALID_FRESHNESS_POLICY: "invalid_freshness_policy",
  LOCATION_SCOPE_MISMATCH: "location_scope_mismatch",
  MULTIPLE_LOCATION_CONTEXTS: "multiple_location_contexts",
  CONFLICTING_OBSERVATIONS: "conflicting_observations",
  NO_ADMISSIBLE_OBSERVATION: "no_admissible_observation"
});

export const LOCATION_TRUTH_RANK = Object.freeze({
  [LOCATION_TRUTH_LEVEL.UNKNOWN]: 0,
  [LOCATION_TRUTH_LEVEL.REGION]: 1,
  [LOCATION_TRUTH_LEVEL.CITY]: 2,
  [LOCATION_TRUTH_LEVEL.STORE]: 3
});

const HISTORICAL_PRICE_EVIDENCE_KIND = "historical-price-evidence";
const MAX_OBSERVATION_QUANTITY = 99;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, { required = false, max = 500 } = {}) {
  if (value == null || value === "") return required ? null : undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sourceResolverFrom(options) {
  return typeof options.sourceResolver === "function"
    ? options.sourceResolver
    : getSensorSource;
}

function normalizeSourceUrl(rawUrl, source) {
  if (typeof rawUrl !== "string") return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (source?.origin && url.origin !== source.origin) return null;
  return url.href;
}

function normalizeObservedTime(observation) {
  const raw = observation?.observedAt ?? (
    typeof observation?.observedDate === "string"
      ? observation.observedDate + "T00:00:00.000Z"
      : null
  );

  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;

  return Object.freeze({
    ms,
    iso: new Date(ms).toISOString()
  });
}

function normalizeQuantity(value) {
  if (value == null) return 1;
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value <= 0
    || value > MAX_OBSERVATION_QUANTITY
  ) {
    return null;
  }
  return value;
}

function normalizeAvailability(value, source) {
  const availability = value == null
    ? OBSERVATION_AVAILABILITY.UNKNOWN
    : value;

  if (!Object.values(OBSERVATION_AVAILABILITY).includes(availability)) {
    return { ok: false, reason: OBSERVATION_REASON.INVALID_AVAILABILITY };
  }

  if (
    availability !== OBSERVATION_AVAILABILITY.UNKNOWN
    && source?.capabilities?.stockObservation !== true
  ) {
    return { ok: false, reason: OBSERVATION_REASON.UNPROVEN_AVAILABILITY };
  }

  return { ok: true, availability };
}

function normalizeSalesChannel(value) {
  if (value == null) {
    return {
      ok: true,
      salesChannel: OBSERVATION_SALES_CHANNEL.UNKNOWN
    };
  }

  if (!Object.values(OBSERVATION_SALES_CHANNEL).includes(value)) {
    return {
      ok: false,
      reason: OBSERVATION_REASON.INVALID_SALES_CHANNEL
    };
  }

  return { ok: true, salesChannel: value };
}

function proofTypeFrom(observation) {
  if (observation?.kind === PUBLIC_PAGE_OBSERVATION_KIND) {
    return OBSERVATION_PROOF_TYPE.PUBLIC_PAGE;
  }

  const raw = observation?.proof?.type;
  if (raw === "RECEIPT") return OBSERVATION_PROOF_TYPE.RECEIPT;
  if (raw === "PRICE_TAG") return OBSERVATION_PROOF_TYPE.PRICE_TAG;
  if (raw === "SHOP_IMPORT") return OBSERVATION_PROOF_TYPE.SHOP_IMPORT;
  if (raw === "USER_CONFIRMATION") return OBSERVATION_PROOF_TYPE.USER_CONFIRMATION;

  if (observation?.kind === HISTORICAL_PRICE_EVIDENCE_KIND) {
    return OBSERVATION_PROOF_TYPE.OPEN_DATA;
  }

  return OBSERVATION_PROOF_TYPE.OTHER;
}

function normalizeLocation(observation, source) {
  if (observation?.kind === HISTORICAL_PRICE_EVIDENCE_KIND) {
    const location = isRecord(observation.location) ? observation.location : {};
    const osmId = Number.isSafeInteger(location.osmId) && location.osmId >= 0
      ? location.osmId
      : null;
    const osmType = cleanString(location.osmType, { max: 32 });
    const locationId = Number.isSafeInteger(location.locationId) && location.locationId >= 0
      ? String(location.locationId)
      : null;
    const label = cleanString(
      location.displayName ?? location.name ?? location.brand,
      { max: 500 }
    );

    if (location.type === "OSM" && osmId != null && osmType) {
      const canonicalId = `osm:${osmType.toLowerCase()}:${osmId}`;
      return Object.freeze({
        level: LOCATION_TRUTH_LEVEL.STORE,
        id: canonicalId,
        scopeKey: `store:${canonicalId}`,
        sourceLocationId: locationId,
        storeId: null,
        label
      });
    }

    return Object.freeze({
      level: LOCATION_TRUTH_LEVEL.UNKNOWN,
      id: locationId ? `${source.id}:${locationId}` : null,
      scopeKey: `unknown:${source.id}:${locationId ?? observation.sourceUrl ?? "evidence"}`,
      sourceLocationId: locationId,
      storeId: null,
      label
    });
  }

  const granularity = observation?.granularity;
  const context = isRecord(observation?.context) ? observation.context : {};
  const explicitLocationId = cleanString(context.locationId, { max: 180 });
  const storeId = cleanString(context.storeId, { max: 180 });
  const label = cleanString(
    context.locationLabel ?? context.storeName,
    { max: 500 }
  );

  if (granularity === OBSERVATION_GRANULARITY.EXACT_STORE) {
    if (!storeId) return null;
    const id = explicitLocationId ?? `${source.id}:store:${storeId}`;
    return Object.freeze({
      level: LOCATION_TRUTH_LEVEL.STORE,
      id,
      scopeKey: `store:${id}`,
      sourceLocationId: explicitLocationId,
      storeId,
      label
    });
  }

  if (
    granularity === OBSERVATION_GRANULARITY.CITY
    || granularity === OBSERVATION_GRANULARITY.LOCATION
  ) {
    if (!label) return null;
    const id = explicitLocationId ?? `${source.id}:city:${label}`;
    return Object.freeze({
      level: LOCATION_TRUTH_LEVEL.CITY,
      id,
      scopeKey: `city:${id}`,
      sourceLocationId: explicitLocationId,
      storeId: null,
      label
    });
  }

  if (granularity === OBSERVATION_GRANULARITY.REGION) {
    if (!label) return null;
    const id = explicitLocationId ?? `${source.id}:region:${label}`;
    return Object.freeze({
      level: LOCATION_TRUTH_LEVEL.REGION,
      id,
      scopeKey: `region:${id}`,
      sourceLocationId: explicitLocationId,
      storeId: null,
      label
    });
  }

  if (
    granularity === OBSERVATION_GRANULARITY.PAGE
    || granularity === OBSERVATION_GRANULARITY.UNKNOWN
    || granularity == null
  ) {
    return Object.freeze({
      level: LOCATION_TRUTH_LEVEL.UNKNOWN,
      id: null,
      scopeKey: `unknown:${source.id}:${observation.sourceUrl ?? "page"}`,
      sourceLocationId: null,
      storeId: null,
      label
    });
  }

  return null;
}

function normalizeMatch(observation, match) {
  if (!isRecord(match)) {
    return { ok: false, reason: OBSERVATION_REASON.MATCH_NOT_CONFIRMED };
  }

  if (match.sourceId !== observation.sourceId) {
    return { ok: false, reason: OBSERVATION_REASON.SOURCE_MISMATCH };
  }

  if (match.status !== MATCH_STATUS.CONFIRMED) {
    return { ok: false, reason: OBSERVATION_REASON.MATCH_NOT_CONFIRMED };
  }

  const canonicalProductId = cleanString(match.canonicalProductId, {
    required: true,
    max: 180
  });
  if (!canonicalProductId) {
    return { ok: false, reason: OBSERVATION_REASON.PRODUCT_MISMATCH };
  }

  const observationCanonicalId = cleanString(
    observation?.product?.canonicalProductId,
    { max: 180 }
  );
  if (
    observationCanonicalId
    && observationCanonicalId !== canonicalProductId
  ) {
    return { ok: false, reason: OBSERVATION_REASON.PRODUCT_MISMATCH };
  }

  const matchSourceProductId = cleanString(match.sourceProductId, { max: 180 });
  const observationSourceProductId = cleanString(
    observation?.product?.sourceProductId,
    { max: 180 }
  );

  if (
    matchSourceProductId
    && observationSourceProductId
    && matchSourceProductId !== observationSourceProductId
  ) {
    return { ok: false, reason: OBSERVATION_REASON.PRODUCT_MISMATCH };
  }

  const exactCanonicalMatch = (
    match.confidence === 1
    && (
      match.method === MATCH_METHOD.CANONICAL_ID
      || match.method === MATCH_METHOD.BARCODE
      || match.method === MATCH_METHOD.USER_CONFIRMED
    )
  );

  return {
    ok: true,
    canonicalProductId,
    matchQuality: Object.freeze({
      method: match.method,
      confidence: match.confidence,
      exactCanonicalMatch
    })
  };
}

function reject(reason, details = {}) {
  return Object.freeze({
    disposition: OBSERVATION_DISPOSITION.REJECTED,
    comparisonUsable: false,
    reason,
    selectedObservation: null,
    provenance: null,
    freshness: details.freshness ?? null,
    temporalClass: details.temporalClass ?? null,
    locationTruthLevel: details.locationTruthLevel ?? LOCATION_TRUTH_LEVEL.UNKNOWN,
    ...details
  });
}

function stableProvenanceKey(value) {
  return JSON.stringify([
    value.sourceId ?? "",
    value.evidenceRef ?? "",
    value.sourceUrl ?? "",
    value.observedAt ?? "",
    value.priceMinor ?? null,
    value.availability ?? "",
    value.priceCondition ?? "",
    value.salesChannel ?? ""
  ]);
}

function sortEvaluations(a, b) {
  const aObservation = a.selectedObservation;
  const bObservation = b.selectedObservation;

  if (!aObservation && !bObservation) {
    return compareText(a.reason ?? "", b.reason ?? "");
  }
  if (!aObservation) return 1;
  if (!bObservation) return -1;

  if (aObservation.location.scopeKey !== bObservation.location.scopeKey) {
    return compareText(
      aObservation.location.scopeKey,
      bObservation.location.scopeKey
    );
  }

  if (aObservation.observedAt !== bObservation.observedAt) {
    return aObservation.observedAt > bObservation.observedAt ? -1 : 1;
  }

  return compareText(
    stableProvenanceKey(a.provenance),
    stableProvenanceKey(b.provenance)
  );
}

function targetScopeKey(targetLocation) {
  if (!targetLocation) return null;
  if (!isRecord(targetLocation)) return undefined;

  const level = targetLocation.level;
  if (!Object.values(LOCATION_TRUTH_LEVEL).includes(level)) return undefined;

  if (level === LOCATION_TRUTH_LEVEL.UNKNOWN) {
    const sourceId = cleanString(targetLocation.sourceId, { max: 180 });
    const sourceUrl = cleanString(targetLocation.sourceUrl, { max: 500 });
    if (!sourceId || !sourceUrl) return undefined;
    return `unknown:${sourceId}:${sourceUrl}`;
  }

  const locationId = cleanString(targetLocation.locationId, {
    required: true,
    max: 240
  });
  if (!locationId) return undefined;
  return `${level}:${locationId}`;
}

function chooseNewest(evaluations, disposition) {
  const eligible = evaluations
    .filter((item) => item.disposition === disposition)
    .sort(sortEvaluations);

  if (eligible.length === 0) return null;

  const newestAt = eligible[0].selectedObservation.observedAt;
  const newest = eligible.filter(
    (item) => item.selectedObservation.observedAt === newestAt
  );

  const commercialFacts = new Set(
    newest.map((item) => JSON.stringify([
      item.selectedObservation.priceMinor,
      item.selectedObservation.availability,
      item.selectedObservation.retailerId ?? null,
      item.selectedObservation.salesChannel ?? null,
      item.selectedObservation.priceCondition ?? null,
      item.selectedObservation.currency ?? null,
      item.selectedObservation.quantity ?? null,
      item.provenance?.proof?.conditionNote ?? null
    ]))
  );

  if (commercialFacts.size > 1) {
    return Object.freeze({
      conflict: true,
      newestAt,
      evaluations: newest
    });
  }

  return newest
    .slice()
    .sort((a, b) => compareText(
      stableProvenanceKey(a.provenance),
      stableProvenanceKey(b.provenance)
    ))[0];
}

export function evaluateObservation({
  observation,
  match,
  nowMs = Date.now(),
  maxAgeMs,
  sourceResolver
} = {}) {
  if (!isRecord(observation)) {
    return reject(OBSERVATION_REASON.INVALID_OBSERVATION);
  }

  const resolveSource = sourceResolverFrom({ sourceResolver });
  const isUserEvidence = observation.kind === USER_EVIDENCE_KIND;
  const source = isUserEvidence
    && observation.sourceId === USER_EVIDENCE_SOURCE_ID
    ? COMMUNITY_EVIDENCE_SOURCE
    : resolveSource(observation.sourceId);
  if (!source) {
    return reject(OBSERVATION_REASON.UNKNOWN_SOURCE);
  }

  if (!Number.isFinite(nowMs)) {
    return reject(OBSERVATION_REASON.INVALID_FRESHNESS_POLICY);
  }

  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    return reject(OBSERVATION_REASON.INVALID_FRESHNESS_POLICY);
  }

  const sourceUrl = isUserEvidence
    ? null
    : normalizeSourceUrl(observation.sourceUrl, source);
  if (!isUserEvidence && !sourceUrl) {
    return reject(OBSERVATION_REASON.INVALID_SOURCE_URL);
  }

  const time = normalizeObservedTime(observation);
  if (!time) {
    return reject(OBSERVATION_REASON.INVALID_TIMESTAMP);
  }

  if (time.ms > nowMs) {
    return reject(OBSERVATION_REASON.FUTURE_TIMESTAMP, {
      freshness: Object.freeze({
        state: OBSERVATION_FRESHNESS.FUTURE,
        ageMs: time.ms - nowMs,
        maxAgeMs
      })
    });
  }

  if (observation.priceMinor == null) {
    return reject(OBSERVATION_REASON.MISSING_PRICE);
  }
  if (
    !Number.isSafeInteger(observation.priceMinor)
    || observation.priceMinor <= 0
  ) {
    return reject(OBSERVATION_REASON.INVALID_PRICE);
  }

  const quantity = normalizeQuantity(observation.quantity);
  if (quantity == null) {
    return reject(OBSERVATION_REASON.INVALID_QUANTITY);
  }

  const matchResult = normalizeMatch(observation, match);
  if (!matchResult.ok) {
    return reject(matchResult.reason);
  }

  const rawRetailerId = observation?.context?.retailerId;
  const retailerId = cleanString(rawRetailerId, { max: 80 }) ?? null;
  if (rawRetailerId != null && !retailerId) {
    return reject(OBSERVATION_REASON.UNKNOWN_RETAILER);
  }
  const retailer = retailerId ? getRetailerIdentity(retailerId) : null;
  if (retailerId && !retailer) {
    return reject(OBSERVATION_REASON.UNKNOWN_RETAILER);
  }

  const availabilityResult = normalizeAvailability(
    observation.availability,
    source
  );
  if (!availabilityResult.ok) {
    return reject(availabilityResult.reason);
  }

  const salesChannelResult = normalizeSalesChannel(observation.salesChannel);
  if (!salesChannelResult.ok) {
    return reject(salesChannelResult.reason);
  }

  const location = normalizeLocation(observation, source);
  if (!location) {
    return reject(OBSERVATION_REASON.INVALID_LOCATION);
  }

  const ageMs = nowMs - time.ms;
  const freshnessState = ageMs <= maxAgeMs
    ? OBSERVATION_FRESHNESS.CURRENT
    : OBSERVATION_FRESHNESS.STALE;
  const freshness = Object.freeze({
    state: freshnessState,
    ageMs,
    maxAgeMs
  });

  const proofType = proofTypeFrom(observation);
  const evidenceRef = cleanString(
    observation.evidenceId
      ?? (
        observation.proof?.proofId != null
          ? `${source.id}:proof:${observation.proof.proofId}`
          : sourceUrl
      ),
    { required: true, max: 700 }
  );

  const provenance = Object.freeze({
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl,
    evidenceRef,
    observedAt: time.iso,
    sourceProductId: cleanString(
      observation?.product?.sourceProductId,
      { max: 180 }
    ),
    proofType,
    proof: isRecord(observation.proof)
      ? Object.freeze({ ...observation.proof })
      : null,
    license: isRecord(observation.license)
      ? Object.freeze({ ...observation.license })
      : isRecord(source.license)
        ? Object.freeze({ ...source.license })
        : null,
    consent: isRecord(observation.consent)
      ? Object.freeze({ ...observation.consent })
      : null,
    priceCondition: cleanString(observation.priceCondition, { max: 64 }) ?? null,
    salesChannel: salesChannelResult.salesChannel
  });

  const normalized = Object.freeze({
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl,
    evidenceRef,
    originalKind: observation.kind ?? null,
    canonicalProductId: matchResult.canonicalProductId,
    sourceProductId: provenance.sourceProductId,
    observedAt: time.iso,
    priceMinor: observation.priceMinor,
    currency: observation.currency ?? "RUB",
    quantity,
    availability: availabilityResult.availability,
    retailerId,
    retailerName: retailer?.name ?? null,
    location,
    proofType,
    priceCondition: cleanString(observation.priceCondition, { max: 64 }) ?? null,
    salesChannel: salesChannelResult.salesChannel,
    match: matchResult.matchQuality
  });

  const historicalReasons = [];

  if (
    observation.kind === HISTORICAL_PRICE_EVIDENCE_KIND
    || source.capabilities?.historicalPriceRead === true
      && source.capabilities?.automatedObservation !== true
      && observation.kind !== PUBLIC_PAGE_OBSERVATION_KIND
  ) {
    historicalReasons.push(OBSERVATION_REASON.SOURCE_HISTORICAL_ONLY);
  }

  if (proofType === OBSERVATION_PROOF_TYPE.RECEIPT) {
    historicalReasons.push(OBSERVATION_REASON.RECEIPT_IS_HISTORICAL);
  }

  if (
    isUserEvidence
    && observation.priceCondition === USER_EVIDENCE_PRICE_CONDITION.UNKNOWN
  ) {
    historicalReasons.push(OBSERVATION_REASON.UNRESOLVED_PRICE_CONDITION);
  }

  if (freshnessState === OBSERVATION_FRESHNESS.STALE) {
    historicalReasons.push(OBSERVATION_REASON.STALE_OBSERVATION);
  }

  if (!matchResult.matchQuality.exactCanonicalMatch) {
    historicalReasons.push(OBSERVATION_REASON.MATCH_NOT_EXACT);
  }

  if (
    location.level === LOCATION_TRUTH_LEVEL.STORE
    && observation.kind === PUBLIC_PAGE_OBSERVATION_KIND
    && source.capabilities?.exactStoreContext !== true
  ) {
    historicalReasons.push(OBSERVATION_REASON.UNPROVEN_EXACT_STORE_CONTEXT);
  }

  const historicalOnly = historicalReasons.length > 0;
  const reason = historicalOnly
    ? historicalReasons[0]
    : OBSERVATION_REASON.CURRENT_OBSERVATION;

  return Object.freeze({
    disposition: historicalOnly
      ? OBSERVATION_DISPOSITION.HISTORICAL_ONLY
      : OBSERVATION_DISPOSITION.ACCEPTED,
    comparisonUsable: !historicalOnly,
    reason,
    reasons: Object.freeze(historicalReasons),
    selectedObservation: normalized,
    provenance,
    freshness,
    temporalClass: historicalOnly
      ? OBSERVATION_TEMPORAL_CLASS.HISTORICAL
      : OBSERVATION_TEMPORAL_CLASS.CURRENT,
    locationTruthLevel: location.level
  });
}

export function fuseObservationCandidates({
  candidates,
  canonicalProductId,
  targetLocation = null,
  nowMs = Date.now(),
  maxAgeMs,
  sourceResolver
} = {}) {
  if (!Array.isArray(candidates)) {
    return reject(OBSERVATION_REASON.INVALID_OBSERVATION);
  }

  const targetKey = targetScopeKey(targetLocation);
  if (targetKey === undefined) {
    return reject(OBSERVATION_REASON.INVALID_LOCATION);
  }

  const evaluations = candidates
    .map((candidate) => evaluateObservation({
      observation: candidate?.observation,
      match: candidate?.match,
      nowMs,
      maxAgeMs,
      sourceResolver
    }))
    .sort(sortEvaluations);

  const productScoped = evaluations.filter((evaluation) => (
    !canonicalProductId
    || evaluation.selectedObservation?.canonicalProductId === canonicalProductId
  ));

  const accepted = productScoped.filter(
    (evaluation) => evaluation.disposition === OBSERVATION_DISPOSITION.ACCEPTED
  );
  const historical = productScoped.filter(
    (evaluation) => evaluation.disposition === OBSERVATION_DISPOSITION.HISTORICAL_ONLY
  );

  let scopedAccepted = accepted;
  let scopedHistorical = historical;

  if (targetKey) {
    scopedAccepted = accepted.filter(
      (evaluation) => evaluation.selectedObservation.location.scopeKey === targetKey
    );
    scopedHistorical = historical.filter(
      (evaluation) => evaluation.selectedObservation.location.scopeKey === targetKey
    );
  } else {
    const acceptedScopes = new Set(
      accepted.map((evaluation) => evaluation.selectedObservation.location.scopeKey)
    );
    if (acceptedScopes.size > 1) {
      return Object.freeze({
        disposition: OBSERVATION_DISPOSITION.CONFLICT,
        comparisonUsable: false,
        reason: OBSERVATION_REASON.MULTIPLE_LOCATION_CONTEXTS,
        selectedObservation: null,
        provenance: Object.freeze(
          accepted.map((evaluation) => evaluation.provenance)
        ),
        freshness: null,
        temporalClass: null,
        locationTruthLevel: LOCATION_TRUTH_LEVEL.UNKNOWN,
        evaluations: Object.freeze(evaluations)
      });
    }

    const historicalScopes = new Set(
      historical.map((evaluation) => evaluation.selectedObservation.location.scopeKey)
    );
    if (acceptedScopes.size === 0 && historicalScopes.size > 1) {
      return Object.freeze({
        disposition: OBSERVATION_DISPOSITION.CONFLICT,
        comparisonUsable: false,
        reason: OBSERVATION_REASON.MULTIPLE_LOCATION_CONTEXTS,
        selectedObservation: null,
        provenance: Object.freeze(
          historical.map((evaluation) => evaluation.provenance)
        ),
        freshness: null,
        temporalClass: OBSERVATION_TEMPORAL_CLASS.HISTORICAL,
        locationTruthLevel: LOCATION_TRUTH_LEVEL.UNKNOWN,
        evaluations: Object.freeze(evaluations)
      });
    }
  }

  const selectedCurrent = chooseNewest(
    scopedAccepted,
    OBSERVATION_DISPOSITION.ACCEPTED
  );

  if (selectedCurrent?.conflict) {
    return Object.freeze({
      disposition: OBSERVATION_DISPOSITION.CONFLICT,
      comparisonUsable: false,
      reason: OBSERVATION_REASON.CONFLICTING_OBSERVATIONS,
      selectedObservation: null,
      provenance: Object.freeze(
        selectedCurrent.evaluations.map((evaluation) => evaluation.provenance)
      ),
      freshness: null,
      temporalClass: OBSERVATION_TEMPORAL_CLASS.CURRENT,
      locationTruthLevel:
        selectedCurrent.evaluations[0]?.locationTruthLevel
        ?? LOCATION_TRUTH_LEVEL.UNKNOWN,
      evaluations: Object.freeze(evaluations)
    });
  }

  if (selectedCurrent) {
    return Object.freeze({
      ...selectedCurrent,
      evaluations: Object.freeze(evaluations)
    });
  }

  const selectedHistorical = chooseNewest(
    scopedHistorical,
    OBSERVATION_DISPOSITION.HISTORICAL_ONLY
  );

  if (selectedHistorical?.conflict) {
    return Object.freeze({
      disposition: OBSERVATION_DISPOSITION.CONFLICT,
      comparisonUsable: false,
      reason: OBSERVATION_REASON.CONFLICTING_OBSERVATIONS,
      selectedObservation: null,
      provenance: Object.freeze(
        selectedHistorical.evaluations.map((evaluation) => evaluation.provenance)
      ),
      freshness: null,
      temporalClass: OBSERVATION_TEMPORAL_CLASS.HISTORICAL,
      locationTruthLevel:
        selectedHistorical.evaluations[0]?.locationTruthLevel
        ?? LOCATION_TRUTH_LEVEL.UNKNOWN,
      evaluations: Object.freeze(evaluations)
    });
  }

  if (selectedHistorical) {
    return Object.freeze({
      ...selectedHistorical,
      comparisonUsable: false,
      evaluations: Object.freeze(evaluations)
    });
  }

  return Object.freeze({
    disposition: OBSERVATION_DISPOSITION.REJECTED,
    comparisonUsable: false,
    reason: targetKey
      && (accepted.length > 0 || historical.length > 0)
      ? OBSERVATION_REASON.LOCATION_SCOPE_MISMATCH
      : OBSERVATION_REASON.NO_ADMISSIBLE_OBSERVATION,
    selectedObservation: null,
    provenance: null,
    freshness: null,
    temporalClass: null,
    locationTruthLevel: targetLocation?.level ?? LOCATION_TRUTH_LEVEL.UNKNOWN,
    evaluations: Object.freeze(evaluations)
  });
}
