import { getRetailerIdentity } from "../data/retailerRegistry.mjs";
import {
  OBSERVATION_DISPOSITION,
  evaluateObservation
} from "../core/observation-trust.mjs";

export const OBSERVED_OFFER_AVAILABILITY = "unknown";

function reject(reason) {
  return Object.freeze({ kind: "rejected", reason });
}

export function createObservedOffer({
  observation,
  match,
  nowMs = Date.now(),
  maxAgeMs,
  sourceResolver
} = {}) {
  const evaluation = evaluateObservation({
    observation,
    match,
    nowMs,
    maxAgeMs,
    sourceResolver
  });

  if (
    evaluation.disposition !== OBSERVATION_DISPOSITION.ACCEPTED
    || evaluation.comparisonUsable !== true
  ) {
    return reject(evaluation.reason);
  }

  const selected = evaluation.selectedObservation;
  const context = observation.context ?? {};
  const minimumQuantity = observation.minimumQuantity === undefined
    ? 1
    : observation.minimumQuantity;
  const retailer = selected.retailerId
    ? getRetailerIdentity(selected.retailerId)
    : null;

  if (selected.retailerId && !retailer) {
    return reject("unknown_retailer");
  }

  return Object.freeze({
    kind: "accepted",
    offer: Object.freeze({
      sourceId: selected.sourceId,
      sourceName: selected.sourceName,
      sourceUrl: selected.sourceUrl,
      observedAt: selected.observedAt,
      granularity: observation.granularity,
      locationTruthLevel: selected.location.level,
      locationId: selected.location.id,
      countryCode: context.countryCode ?? null,
      regionId: context.regionId ?? null,
      regionName: context.regionName ?? null,
      localityId: context.localityId ?? null,
      localityName: context.localityName ?? null,
      retailerId: retailer?.id ?? null,
      retailerName: retailer?.name ?? null,
      canonicalProductId: selected.canonicalProductId,
      sourceProductId: selected.sourceProductId,
      sourceProductName: observation.product?.name,
      unitPriceMinor: selected.priceMinor,
      currency: selected.currency,
      minimumQuantity,
      priceCondition: selected.priceCondition ?? null,
      salesChannel: selected.salesChannel,
      storeId: context.storeId,
      storeName: context.storeName,
      locationLabel: context.locationLabel,
      availability: selected.availability,
      provenance: Object.freeze({
        ...evaluation.provenance,
        minimumQuantity
      }),
      freshness: evaluation.freshness
    })
  });
}
