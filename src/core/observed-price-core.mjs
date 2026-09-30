import { getRetailerIdentity } from "../data/retailerRegistry.mjs";
import { normalizeBasket } from "./basket-core.mjs";
import {
  LOCATION_TRUTH_LEVEL,
  LOCATION_TRUTH_RANK,
  OBSERVATION_AVAILABILITY,
  OBSERVATION_REASON
} from "./observation-trust.mjs";

export const OBSERVED_LINE_STATUS = Object.freeze({
  PRICED: "priced-observation",
  UNKNOWN_PRICE: "unknown-price",
  CONFLICT: "conflict-observation"
});

export const OBSERVED_COMPARISON_CONCLUSION = Object.freeze({
  CHEAPEST_PROVEN: "cheapest-proven",
  LOWEST_TIE: "lowest-tie",
  OBSERVED_TOTAL_ONLY: "observed-total-only",
  INSUFFICIENT_COVERAGE: "insufficient-coverage"
});

const OBSERVED_PRICE_CONDITION = Object.freeze({
  REGULAR: "regular",
  LOYALTY: "loyalty",
  PROMO: "promo",
  UNKNOWN: "unknown"
});

const OBSERVED_SALES_CHANNEL = Object.freeze({
  ONLINE: "online",
  STORE: "store",
  UNKNOWN: "unknown"
});

const NON_COMPARABLE_PRICE_CONDITIONS = new Set([
  OBSERVED_PRICE_CONDITION.LOYALTY,
  OBSERVED_PRICE_CONDITION.PROMO,
  OBSERVED_PRICE_CONDITION.UNKNOWN
]);

function normalizeMinimumQuantity(value) {
  if (value === undefined) return 1;
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 99) {
    throw new TypeError("observed offer minimumQuantity is invalid");
  }
  return value;
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function cleanGeoString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeCountryCode(value) {
  const normalized = cleanGeoString(value);
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

function normalizePriceCondition(value) {
  if (value == null) return null;
  const normalized = cleanGeoString(value);
  if (
    !normalized
    || !Object.values(OBSERVED_PRICE_CONDITION).includes(normalized)
  ) {
    throw new TypeError("observed offer priceCondition is invalid");
  }
  return normalized;
}

function sumMinor(amounts, label) {
  return amounts.reduce((sum, value) => {
    const next = sum + value;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new TypeError(label + " must be a non-negative safe integer");
    }
    return next;
  }, 0);
}

function lineTotal(unitPriceMinor, quantity) {
  const total = Math.round(unitPriceMinor * quantity);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new TypeError("observed line total must be a non-negative safe integer");
  }
  return total;
}

function inferTruthLevel(offer) {
  if (Object.values(LOCATION_TRUTH_LEVEL).includes(offer.locationTruthLevel)) {
    return offer.locationTruthLevel;
  }

  if (offer.granularity === "exact-store") return LOCATION_TRUTH_LEVEL.STORE;
  if (offer.granularity === "city" || offer.granularity === "location") {
    return LOCATION_TRUTH_LEVEL.CITY;
  }
  if (offer.granularity === "region") return LOCATION_TRUTH_LEVEL.REGION;
  return LOCATION_TRUTH_LEVEL.UNKNOWN;
}

function locationScopeKey(offer) {
  const level = offer.locationTruthLevel;

  if (level === LOCATION_TRUTH_LEVEL.STORE) {
    const id = offer.locationId ?? (
      offer.storeId ? `${offer.sourceId}:store:${offer.storeId}` : null
    );
    return id ? `store:${id}` : `store:${offer.sourceId}:unknown`;
  }

  if (level === LOCATION_TRUTH_LEVEL.CITY) {
    const id = offer.locationId ?? (
      offer.locationLabel ? `${offer.sourceId}:city:${offer.locationLabel}` : null
    );
    return id ? `city:${id}` : `city:${offer.sourceId}:unknown`;
  }

  if (level === LOCATION_TRUTH_LEVEL.REGION) {
    const id = offer.locationId ?? (
      offer.locationLabel ? `${offer.sourceId}:region:${offer.locationLabel}` : null
    );
    return id ? `region:${id}` : `region:${offer.sourceId}:unknown`;
  }

  if (offer.storeName) {
    return `${offer.sourceId}::merchant:${offer.storeName}`;
  }

  return `unknown:${offer.sourceId}:${offer.sourceUrl ?? "page"}`;
}

function contextKey(offer) {
  return locationScopeKey(offer);
}

function contextId(offer) {
  return locationScopeKey(offer);
}

function contextName(offer) {
  if (offer.locationTruthLevel === LOCATION_TRUTH_LEVEL.STORE) {
    return offer.storeName ?? offer.locationLabel ?? offer.sourceName;
  }
  if (offer.locationLabel) return `${offer.locationLabel} · ${offer.sourceName}`;
  if (offer.storeName) return `${offer.storeName} · ${offer.sourceName}`;
  return offer.sourceName;
}

function normalizeProvenance(offer) {
  const provenance = offer.provenance && typeof offer.provenance === "object"
    ? offer.provenance
    : {
        sourceId: offer.sourceId,
        sourceName: offer.sourceName,
        sourceUrl: offer.sourceUrl,
        evidenceRef: offer.sourceUrl,
        observedAt: offer.observedAt,
        sourceProductId: offer.sourceProductId ?? null,
        proofType: "public-page",
        proof: null
      };

  return Object.freeze({
    sourceId: provenance.sourceId ?? offer.sourceId,
    sourceName: provenance.sourceName ?? offer.sourceName,
    sourceUrl: provenance.sourceUrl ?? offer.sourceUrl,
    evidenceRef: provenance.evidenceRef ?? offer.sourceUrl,
    observedAt: provenance.observedAt ?? offer.observedAt,
    sourceProductId: provenance.sourceProductId ?? offer.sourceProductId ?? null,
    proofType: provenance.proofType ?? "public-page",
    proof: provenance.proof ?? null,
    license: provenance.license ?? null,
    priceCondition: provenance.priceCondition ?? offer.priceCondition ?? null,
    conditionNote:
      provenance.proof?.conditionNote
      ?? provenance.conditionNote
      ?? offer.conditionNote
      ?? null,
    salesChannel: provenance.salesChannel ?? offer.salesChannel,
    minimumQuantity:
      provenance.minimumQuantity
      ?? offer.minimumQuantity
      ?? null
  });
}

function normalizeSalesChannel(value) {
  if (value == null) return OBSERVED_SALES_CHANNEL.UNKNOWN;
  if (!Object.values(OBSERVED_SALES_CHANNEL).includes(value)) {
    throw new TypeError("observed offer salesChannel is invalid");
  }
  return value;
}

function requireObservedOffer(offer) {
  if (!offer || typeof offer !== "object") {
    throw new TypeError("observed offer must be an object");
  }
  if (typeof offer.sourceId !== "string" || !offer.sourceId.trim()) {
    throw new TypeError("observed offer sourceId is required");
  }
  if (typeof offer.sourceName !== "string" || !offer.sourceName.trim()) {
    throw new TypeError("observed offer sourceName is required");
  }
  if (
    typeof offer.canonicalProductId !== "string"
    || !offer.canonicalProductId.trim()
  ) {
    throw new TypeError("observed offer canonicalProductId is required");
  }
  if (!Number.isSafeInteger(offer.unitPriceMinor) || offer.unitPriceMinor <= 0) {
    throw new TypeError("observed offer unitPriceMinor must be a positive safe integer");
  }
  if (offer.currency !== "RUB") {
    throw new TypeError("observed offer currency must be RUB");
  }
  if (!Object.values(OBSERVATION_AVAILABILITY).includes(offer.availability)) {
    throw new TypeError("observed offer availability is invalid");
  }
  if (!Number.isFinite(Date.parse(offer.observedAt))) {
    throw new TypeError("observed offer observedAt is required");
  }

  const locationTruthLevel = inferTruthLevel(offer);
  const retailerId = cleanGeoString(offer.retailerId);
  if (offer.retailerId != null && !retailerId) {
    throw new TypeError("observed offer retailerId is invalid");
  }
  const retailer = retailerId ? getRetailerIdentity(retailerId) : null;
  if (retailerId && !retailer) {
    throw new TypeError("observed offer retailerId is unknown");
  }
  const countryCode = normalizeCountryCode(offer.countryCode);
  const regionId = cleanGeoString(offer.regionId);
  const regionName = cleanGeoString(offer.regionName);
  const localityId = cleanGeoString(offer.localityId);
  const localityName = cleanGeoString(offer.localityName);
  const priceCondition = normalizePriceCondition(offer.priceCondition);
  const salesChannel = normalizeSalesChannel(offer.salesChannel);
  const minimumQuantity = normalizeMinimumQuantity(offer.minimumQuantity);
  const conditionNote = cleanGeoString(
    offer.conditionNote
      ?? offer.provenance?.proof?.conditionNote
      ?? offer.provenance?.conditionNote
  );
  const priceConditionComparable =
    priceCondition === OBSERVED_PRICE_CONDITION.REGULAR
    || (
      priceCondition === OBSERVED_PRICE_CONDITION.PROMO
      && offer.priceConditionComparable === true
    );

  return Object.freeze({
    sourceId: offer.sourceId,
    sourceName: offer.sourceName,
    sourceUrl: offer.sourceUrl ?? null,
    observedAt: new Date(Date.parse(offer.observedAt)).toISOString(),
    granularity: offer.granularity ?? null,
    locationTruthLevel,
    locationId: offer.locationId ?? null,
    countryCode,
    regionId,
    regionName,
    localityId,
    localityName,
    retailerId: retailer?.id ?? null,
    retailerName: retailer?.name ?? null,
    canonicalProductId: offer.canonicalProductId,
    sourceProductId: offer.sourceProductId ?? null,
    sourceProductName: offer.sourceProductName ?? null,
    unitPriceMinor: offer.unitPriceMinor,
    currency: "RUB",
    priceCondition,
    priceConditionComparable,
    conditionNote,
    salesChannel,
    minimumQuantity,
    storeId: offer.storeId ?? null,
    storeName: offer.storeName ?? null,
    locationLabel: offer.locationLabel ?? null,
    availability: offer.availability,
    provenance: normalizeProvenance(offer),
    freshness: offer.freshness ?? null
  });
}

function stableOfferKey(offer) {
  return JSON.stringify([
    contextKey(offer),
    offer.canonicalProductId,
    offer.observedAt,
    offer.sourceId,
    offer.sourceName,
    offer.sourceUrl ?? "",
    offer.granularity ?? "",
    offer.locationTruthLevel ?? "",
    offer.locationId ?? "",
    offer.countryCode ?? "",
    offer.regionId ?? "",
    offer.regionName ?? "",
    offer.localityId ?? "",
    offer.localityName ?? "",
    offer.retailerId ?? "",
    offer.retailerName ?? "",
    offer.storeId ?? "",
    offer.storeName ?? "",
    offer.locationLabel ?? "",
    offer.unitPriceMinor,
    offer.priceCondition ?? "",
    offer.priceConditionComparable === true ? "comparable" : "not-comparable",
    offer.conditionNote ?? "",
    offer.salesChannel ?? "",
    offer.minimumQuantity ?? "",
    offer.availability
  ]);
}

function hasEqualTimeTruthConflict(a, b) {
  return [
    "locationTruthLevel",
    "locationId",
    "countryCode",
    "regionId",
    "localityId",
    "retailerId",
    "storeId",
    "priceCondition",
    "priceConditionComparable",
    "conditionNote",
    "salesChannel",
    "minimumQuantity"
  ].some((key) => (a?.[key] ?? null) !== (b?.[key] ?? null));
}

function conflictFrom(...inputOffers) {
  const unique = new Map();
  for (const offer of inputOffers.flat()) {
    unique.set(stableOfferKey(offer), offer);
  }
  const offers = Array.from(unique.values()).sort((left, right) => (
    compareText(stableOfferKey(left), stableOfferKey(right))
  ));

  return Object.freeze({
    kind: "conflict",
    reason: OBSERVATION_REASON.CONFLICTING_OBSERVATIONS,
    observedAt: offers[0].observedAt,
    canonicalProductId: offers[0].canonicalProductId,
    provenance: Object.freeze(offers.map((offer) => offer.provenance)),
    offers: Object.freeze(offers)
  });
}

function newestOffer(existing, incoming) {
  if (!existing) {
    return Object.freeze({ kind: "selected", offer: incoming });
  }

  if (existing.kind === "conflict") {
    const conflictMs = Date.parse(existing.observedAt);
    const incomingMs = Date.parse(incoming.observedAt);
    if (incomingMs > conflictMs) {
      return Object.freeze({ kind: "selected", offer: incoming });
    }
    if (incomingMs < conflictMs) return existing;
    return conflictFrom(existing.offers ?? [], incoming);
  }

  const current = existing.offer;
  const currentMs = Date.parse(current.observedAt);
  const incomingMs = Date.parse(incoming.observedAt);

  if (incomingMs > currentMs) {
    return Object.freeze({ kind: "selected", offer: incoming });
  }
  if (incomingMs < currentMs) return existing;

  if (
    incoming.unitPriceMinor !== current.unitPriceMinor
    || incoming.availability !== current.availability
    || hasEqualTimeTruthConflict(current, incoming)
  ) {
    return conflictFrom(current, incoming);
  }

  return compareText(stableOfferKey(incoming), stableOfferKey(current)) < 0
    ? Object.freeze({ kind: "selected", offer: incoming })
    : existing;
}

function createGeographyAccumulator() {
  return {
    countryCode: { values: new Set(), missing: false },
    regionId: { values: new Set(), missing: false },
    regionName: { values: new Set(), missing: false },
    localityId: { values: new Set(), missing: false },
    localityName: { values: new Set(), missing: false }
  };
}

function recordGeoValue(slot, value) {
  if (value == null) {
    slot.missing = true;
    return;
  }
  slot.values.add(value);
}

function recordGeography(accumulator, offer) {
  recordGeoValue(accumulator.countryCode, offer.countryCode);
  recordGeoValue(accumulator.regionId, offer.regionId);
  recordGeoValue(accumulator.regionName, offer.regionName);
  recordGeoValue(accumulator.localityId, offer.localityId);
  recordGeoValue(accumulator.localityName, offer.localityName);
}

function resolvedGeoValue(slot) {
  if (slot.missing || slot.values.size !== 1) return null;
  return slot.values.values().next().value;
}

function resolveGeography(accumulator) {
  const slots = Object.values(accumulator);
  const conflict = slots.some((slot) => slot.values.size > 1);

  return Object.freeze({
    countryCode: resolvedGeoValue(accumulator.countryCode),
    regionId: resolvedGeoValue(accumulator.regionId),
    regionName: resolvedGeoValue(accumulator.regionName),
    localityId: resolvedGeoValue(accumulator.localityId),
    localityName: resolvedGeoValue(accumulator.localityName),
    conflict
  });
}

function selectedConsensusValue(offers, key) {
  if (!Array.isArray(offers) || offers.length === 0) return null;

  const values = new Set();
  let missing = false;
  for (const offer of offers) {
    const value = offer?.[key] ?? null;
    if (value == null) {
      missing = true;
    } else {
      values.add(value);
    }
  }

  if (missing || values.size !== 1) return null;
  return values.values().next().value;
}

function selectedIdentityConflict(offers) {
  for (const key of ["retailerId", "storeId"]) {
    const values = new Set(
      offers
        .map((offer) => offer?.[key] ?? null)
        .filter((value) => value != null)
    );
    if (values.size > 1) return true;
  }
  return false;
}

function selectedCandidateIdentity(selectedOffers, sources) {
  const locationTruthLevel = selectedConsensusValue(
    selectedOffers,
    "locationTruthLevel"
  );
  const locationId = selectedConsensusValue(selectedOffers, "locationId");
  const retailerId = selectedConsensusValue(selectedOffers, "retailerId");
  const retailerName = selectedConsensusValue(selectedOffers, "retailerName");
  const storeId = selectedConsensusValue(selectedOffers, "storeId");
  const storeName = selectedConsensusValue(selectedOffers, "storeName");
  const locationLabel = selectedConsensusValue(selectedOffers, "locationLabel");
  const granularity = selectedConsensusValue(selectedOffers, "granularity");
  const singleSourceName = sources.length === 1 ? sources[0].sourceName : null;

  let candidateName = null;
  if (locationTruthLevel === LOCATION_TRUTH_LEVEL.STORE) {
    candidateName = storeName ?? locationLabel ?? singleSourceName;
  } else if (
    locationTruthLevel === LOCATION_TRUTH_LEVEL.CITY
    || locationTruthLevel === LOCATION_TRUTH_LEVEL.REGION
  ) {
    candidateName = locationLabel
      ? singleSourceName
        ? `${locationLabel} · ${singleSourceName}`
        : locationLabel
      : singleSourceName;
  } else {
    candidateName = storeName ?? locationLabel ?? singleSourceName;
  }

  return Object.freeze({
    candidateName: candidateName ?? retailerName ?? "Наблюдаемый вариант",
    conflict: selectedIdentityConflict(selectedOffers),
    retailerId,
    retailerName,
    locationTruthLevel,
    locationId,
    storeId,
    storeName,
    locationLabel,
    granularity
  });
}

function groupOffers(offers) {
  if (!Array.isArray(offers)) {
    throw new TypeError("observed offers must be an array");
  }

  const normalized = offers
    .map(requireObservedOffer)
    .sort((a, b) => compareText(stableOfferKey(a), stableOfferKey(b)));

  const groups = new Map();

  for (const offer of normalized) {
    const key = contextKey(offer);
    const existing = groups.get(key) ?? {
      candidateId: contextId(offer),
      candidateName: contextName(offer),
      locationTruthLevel: offer.locationTruthLevel,
      locationId: offer.locationId,
      storeId: offer.storeId,
      storeName: offer.storeName,
      locationLabel: offer.locationLabel,
      granularity: offer.granularity,
      offerMap: new Map()
    };

    existing.offerMap.set(
      offer.canonicalProductId,
      newestOffer(existing.offerMap.get(offer.canonicalProductId), offer)
    );
    groups.set(key, existing);
  }

  return Array.from(groups.values()).sort(
    (a, b) => compareText(a.candidateId, b.candidateId)
  );
}

function buildCandidateBasket(basket, group) {
  const lines = basket.map((item) => {
    const selected = group.offerMap.get(item.product.id);

    if (!selected) {
      return {
        productId: item.product.id,
        quantity: item.quantity,
        unit: item.product.unit,
        status: OBSERVED_LINE_STATUS.UNKNOWN_PRICE,
        reason: "missing_observation",
        unitPriceMinor: null,
        lineTotalMinor: null,
        priceCondition: null,
        priceConditionComparable: false,
        salesChannel: OBSERVED_SALES_CHANNEL.UNKNOWN,
        availability: OBSERVATION_AVAILABILITY.UNKNOWN,
        observedAt: null,
        sourceUrl: null,
        provenance: null
      };
    }

    if (selected.kind === "conflict") {
      return {
        productId: item.product.id,
        quantity: item.quantity,
        unit: item.product.unit,
        status: OBSERVED_LINE_STATUS.CONFLICT,
        reason: selected.reason,
        unitPriceMinor: null,
        lineTotalMinor: null,
        priceCondition: null,
        priceConditionComparable: false,
        salesChannel: OBSERVED_SALES_CHANNEL.UNKNOWN,
        availability: OBSERVATION_AVAILABILITY.UNKNOWN,
        observedAt: selected.observedAt,
        sourceUrl: null,
        provenance: selected.provenance
      };
    }

    const observed = selected.offer;
    const minimumQuantity = observed.minimumQuantity;
    if (
      minimumQuantity == null
      || item.quantity < minimumQuantity
    ) {
      return {
        productId: item.product.id,
        quantity: item.quantity,
        unit: item.product.unit,
        status: OBSERVED_LINE_STATUS.UNKNOWN_PRICE,
        reason: minimumQuantity == null
          ? "minimum_quantity_unproven"
          : "minimum_quantity_not_met",
        unitPriceMinor: null,
        lineTotalMinor: null,
        priceCondition: observed.priceCondition,
        priceConditionComparable: observed.priceConditionComparable,
        conditionNote: observed.conditionNote,
        salesChannel: observed.salesChannel,
        minimumQuantity,
        availability: OBSERVATION_AVAILABILITY.UNKNOWN,
        observedAt: observed.observedAt,
        sourceUrl: observed.sourceUrl,
        provenance: observed.provenance
      };
    }

    return {
      productId: item.product.id,
      quantity: item.quantity,
      unit: item.product.unit,
      status: OBSERVED_LINE_STATUS.PRICED,
      reason: null,
      unitPriceMinor: observed.unitPriceMinor,
      lineTotalMinor: lineTotal(observed.unitPriceMinor, item.quantity),
      priceCondition: observed.priceCondition,
      priceConditionComparable: observed.priceConditionComparable,
      conditionNote: observed.conditionNote,
      salesChannel: observed.salesChannel,
      minimumQuantity,
      availability: observed.availability,
      observedAt: observed.observedAt,
      sourceUrl: observed.sourceUrl,
      provenance: observed.provenance
    };
  });

  const priced = lines.filter((line) => line.status === OBSERVED_LINE_STATUS.PRICED);
  const coveredItems = priced.length;
  const totalItems = basket.length;
  const completePriceCoverage = coveredItems === totalItems;
  const knownSubtotalMinor = sumMinor(
    priced.map((line) => line.lineTotalMinor),
    "observed candidate subtotal"
  );
  const selectedOffers = basket
    .map((item) => group.offerMap.get(item.product.id))
    .filter((selected) => selected?.kind === "selected")
    .map((selected) => selected.offer);

  const selectedSourceMap = new Map();
  const selectedGeography = createGeographyAccumulator();
  for (const offer of selectedOffers) {
    selectedSourceMap.set(offer.sourceId, offer.sourceName);
    recordGeography(selectedGeography, offer);
  }

  const sources = Array.from(selectedSourceMap.entries())
    .sort(([a], [b]) => compareText(a, b))
    .map(([sourceId, sourceName]) => Object.freeze({ sourceId, sourceName }));
  const geography = resolveGeography(selectedGeography);
  const identity = selectedCandidateIdentity(selectedOffers, sources);
  const priceConditions = Object.freeze(
    Array.from(
      new Set(
        priced.map((line) => (
          line.priceCondition ?? OBSERVED_PRICE_CONDITION.UNKNOWN
        ))
      )
    ).sort(compareText)
  );
  const priceConditionDetails = Object.freeze(
    Array.from(
      new Set(
        priced
          .map((line) => line.conditionNote)
          .filter((value) => typeof value === "string" && value)
      )
    ).sort(compareText)
  );
  const salesChannels = Object.freeze(
    Array.from(new Set(priced.map((line) => line.salesChannel))).sort(compareText)
  );
  const salesChannel = selectedConsensusValue(selectedOffers, "salesChannel");
  const contextCoherent = !geography.conflict && !identity.conflict;

  return {
    candidateId: group.candidateId,
    candidateName: identity.candidateName,
    sourceId: sources.length === 1 ? sources[0].sourceId : null,
    sourceName: sources.length === 1 ? sources[0].sourceName : null,
    sources,
    retailerId: identity.retailerId,
    retailerName: identity.retailerName,
    storeId: identity.storeId,
    storeName: identity.storeName,
    locationId: identity.locationId,
    locationLabel: identity.locationLabel,
    granularity: identity.granularity,
    locationTruthLevel: identity.locationTruthLevel,
    countryCode: geography.countryCode,
    regionId: geography.regionId,
    regionName: geography.regionName,
    localityId: geography.localityId,
    localityName: geography.localityName,
    geography,
    availability: OBSERVATION_AVAILABILITY.UNKNOWN,
    priceConditions,
    priceConditionDetails,
    contextCoherent,
    salesChannel,
    salesChannels,
    lines,
    knownSubtotalMinor,
    totalMinor: completePriceCoverage ? knownSubtotalMinor : null,
    priceCoverage: {
      coveredItems,
      totalItems,
      ratio: coveredItems / totalItems
    },
    completePriceCoverage
  };
}

function comparisonScopeFor(candidate) {
  const geography = candidate.geography;
  if (
    !geography
    || geography.conflict
    || geography.countryCode !== "RU"
  ) {
    return null;
  }

  if (candidate.locationTruthLevel === LOCATION_TRUTH_LEVEL.STORE) {
    if (
      !geography.regionId
      || !geography.regionName
      || !geography.localityId
      || !geography.localityName
    ) {
      return null;
    }

    return Object.freeze({
      key: `store-locality:RU:${geography.regionId}:${geography.localityId}`,
      truthLevel: LOCATION_TRUTH_LEVEL.STORE,
      countryCode: "RU",
      regionId: geography.regionId,
      regionName: geography.regionName,
      localityId: geography.localityId,
      localityName: geography.localityName
    });
  }

  if (candidate.locationTruthLevel === LOCATION_TRUTH_LEVEL.CITY) {
    if (
      !geography.regionId
      || !geography.regionName
      || !geography.localityId
      || !geography.localityName
    ) {
      return null;
    }

    return Object.freeze({
      key: `locality:RU:${geography.regionId}:${geography.localityId}`,
      truthLevel: LOCATION_TRUTH_LEVEL.CITY,
      countryCode: "RU",
      regionId: geography.regionId,
      regionName: geography.regionName,
      localityId: geography.localityId,
      localityName: geography.localityName
    });
  }

  if (candidate.locationTruthLevel === LOCATION_TRUTH_LEVEL.REGION) {
    if (!geography.regionId || !geography.regionName) return null;

    return Object.freeze({
      key: `region:RU:${geography.regionId}`,
      truthLevel: LOCATION_TRUTH_LEVEL.REGION,
      countryCode: "RU",
      regionId: geography.regionId,
      regionName: geography.regionName,
      localityId: null,
      localityName: null
    });
  }

  return null;
}

function compareCompleteCandidates(a, b) {
  const aRank = LOCATION_TRUTH_RANK[a.locationTruthLevel] ?? 0;
  const bRank = LOCATION_TRUTH_RANK[b.locationTruthLevel] ?? 0;

  if (aRank !== bRank) return bRank - aRank;
  if (a.totalMinor !== b.totalMinor) return a.totalMinor - b.totalMinor;
  return compareText(a.candidateId, b.candidateId);
}

export function compareObservedBasket({ basket, offers } = {}) {
  const normalizedBasket = normalizeBasket(basket);
  const groups = groupOffers(offers);
  const candidates = groups.map((group) => buildCandidateBasket(normalizedBasket, group));

  const complete = candidates
    .filter((candidate) => (
      candidate.completePriceCoverage
      && candidate.contextCoherent
    ))
    .sort(compareCompleteCandidates);
  const hasIncoherentComplete = candidates.some((candidate) => (
    candidate.completePriceCoverage
    && !candidate.contextCoherent
  ));

  const winnerCandidate = complete[0] ?? null;
  const winner = winnerCandidate == null
    ? null
    : {
        candidateId: winnerCandidate.candidateId,
        candidateName: winnerCandidate.candidateName,
        sourceId: winnerCandidate.sourceId,
        sourceName: winnerCandidate.sourceName,
        sources: winnerCandidate.sources,
        retailerId: winnerCandidate.retailerId,
        retailerName: winnerCandidate.retailerName,
        storeId: winnerCandidate.storeId,
        storeName: winnerCandidate.storeName,
        locationId: winnerCandidate.locationId,
        locationLabel: winnerCandidate.locationLabel,
        granularity: winnerCandidate.granularity,
        locationTruthLevel: winnerCandidate.locationTruthLevel,
        countryCode: winnerCandidate.countryCode,
        regionId: winnerCandidate.regionId,
        regionName: winnerCandidate.regionName,
        localityId: winnerCandidate.localityId,
        localityName: winnerCandidate.localityName,
        geography: winnerCandidate.geography,
        availability: OBSERVATION_AVAILABILITY.UNKNOWN,
        priceConditions: winnerCandidate.priceConditions,
        priceConditionDetails: winnerCandidate.priceConditionDetails,
        salesChannel: winnerCandidate.salesChannel,
        salesChannels: winnerCandidate.salesChannels,
        totalMinor: winnerCandidate.totalMinor,
        priceCoverage: winnerCandidate.priceCoverage
      };

  const completeScopes = complete.map((candidate) => comparisonScopeFor(candidate));
  const firstScope = completeScopes[0] ?? null;
  const hasConditionalPriceContext = complete.some((candidate) => (
    candidate.priceConditions.length > 1
    || candidate.lines.some((line) => {
      if (line.status !== OBSERVED_LINE_STATUS.PRICED) return false;
      const condition =
        line.priceCondition ?? OBSERVED_PRICE_CONDITION.UNKNOWN;
      return (
        NON_COMPARABLE_PRICE_CONDITIONS.has(condition)
        && !(
          condition === OBSERVED_PRICE_CONDITION.PROMO
          && line.priceConditionComparable === true
        )
      );
    })
  ));
  const hasMixedSalesChannel = complete.some((candidate) => (
    candidate.salesChannels.length > 1
    || candidate.salesChannel == null
    || candidate.salesChannel === OBSERVED_SALES_CHANNEL.UNKNOWN
  )) || new Set(complete.map((candidate) => candidate.salesChannel)).size > 1;
  const comparableComplete = (
    complete.length >= 2
    && !hasConditionalPriceContext
    && !hasMixedSalesChannel
    && firstScope !== null
    && completeScopes.every((scope) => (
      scope !== null
      && scope.key === firstScope.key
      && scope.truthLevel === firstScope.truthLevel
    ))
  );
  const uniqueCheapest = (
    comparableComplete
    && complete[0].totalMinor < complete[1].totalMinor
  );
  const lowestTie = (
    comparableComplete
    && complete[0].totalMinor === complete[1].totalMinor
  );

  const savingsMinor = uniqueCheapest
    ? complete[1].totalMinor - complete[0].totalMinor
    : null;

  let conclusion;
  if (complete.length === 0) {
    conclusion = Object.freeze({
      kind: OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE,
      reason: hasIncoherentComplete
        ? "incomparable_geography_or_truth_level"
        : "no_complete_candidate",
      candidateId: null,
      totalMinor: null,
      savingsMinor: null,
      comparisonScope: null
    });
  } else if (
    complete.length === 1
    && complete[0].priceConditions.length > 1
  ) {
    conclusion = Object.freeze({
      kind: OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE,
      reason: "conditional_price_context",
      candidateId: null,
      totalMinor: null,
      savingsMinor: null,
      comparisonScope: null
    });
  } else if (
    complete.length === 1
    && complete[0].salesChannels.length > 1
  ) {
    conclusion = Object.freeze({
      kind: OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE,
      reason: "mixed_sales_channel",
      candidateId: null,
      totalMinor: null,
      savingsMinor: null,
      comparisonScope: null
    });
  } else if (complete.length === 1) {
    conclusion = Object.freeze({
      kind: OBSERVED_COMPARISON_CONCLUSION.OBSERVED_TOTAL_ONLY,
      reason: "single_complete_candidate",
      candidateId: winnerCandidate.candidateId,
      totalMinor: winnerCandidate.totalMinor,
      savingsMinor: null,
      comparisonScope: firstScope
    });
  } else if (hasConditionalPriceContext) {
    conclusion = Object.freeze({
      kind: OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE,
      reason: "conditional_price_context",
      candidateId: null,
      totalMinor: null,
      savingsMinor: null,
      comparisonScope: null
    });
  } else if (hasMixedSalesChannel) {
    conclusion = Object.freeze({
      kind: OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE,
      reason: "mixed_sales_channel",
      candidateId: null,
      totalMinor: null,
      savingsMinor: null,
      comparisonScope: null
    });
  } else if (uniqueCheapest) {
    conclusion = Object.freeze({
      kind: OBSERVED_COMPARISON_CONCLUSION.CHEAPEST_PROVEN,
      reason: "comparable_complete_candidates",
      candidateId: winnerCandidate.candidateId,
      totalMinor: winnerCandidate.totalMinor,
      savingsMinor,
      comparisonScope: firstScope
    });
  } else if (lowestTie) {
    const candidateIds = complete
      .filter((candidate) => candidate.totalMinor === winnerCandidate.totalMinor)
      .map((candidate) => candidate.candidateId);

    conclusion = Object.freeze({
      kind: OBSERVED_COMPARISON_CONCLUSION.LOWEST_TIE,
      reason: "equal_lowest_total",
      candidateId: null,
      candidateIds: Object.freeze(candidateIds),
      totalMinor: winnerCandidate.totalMinor,
      savingsMinor: null,
      comparisonScope: firstScope
    });
  } else {
    conclusion = Object.freeze({
      kind: OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE,
      reason: "incomparable_geography_or_truth_level",
      candidateId: null,
      totalMinor: null,
      savingsMinor: null,
      comparisonScope: null
    });
  }

  return {
    kind: "observed-price-comparison",
    basket: normalizedBasket,
    candidates,
    winner,
    savingsMinor,
    conclusion
  };
}
