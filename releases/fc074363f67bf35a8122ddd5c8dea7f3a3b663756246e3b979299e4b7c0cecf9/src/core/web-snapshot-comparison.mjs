// Deterministic comparison over the dated web price snapshot.
//
// This is deliberately separate from observed-price-core: snapshot prices are
// region-unconfirmed and dated, so they never become live OBSERVED truth.
// Rules:
// - integer kopeks only; unknown != 0 (a missing price never counts as zero);
// - only stores that cover every basket line can be called cheapest;
// - savings are measured against the next-cheapest complete store only.

import {
  WEB_SNAPSHOT_CANONICAL_SIZES,
  WEB_SNAPSHOT_META,
  WEB_SNAPSHOT_OFFERS,
  WEB_SNAPSHOT_RETAILERS
} from "../data/webPriceSnapshot.mjs";

export const WEB_SNAPSHOT_CONCLUSION = Object.freeze({
  CHEAPEST: "cheapest",
  TIE: "tie",
  PARTIAL_ONLY: "partial-only",
  NO_DATA: "no-data"
});

const MAX_QUANTITY = 99;

function isBasketItem(item) {
  return Boolean(
    item
    && typeof item === "object"
    && typeof item.id === "string"
    && item.id !== ""
    && Number.isSafeInteger(item.quantity)
    && item.quantity >= 1
    && item.quantity <= MAX_QUANTITY
  );
}

export function snapshotLinePriceMinor(offer, canonicalSize) {
  if (
    !offer
    || !canonicalSize
    || offer.unit !== canonicalSize.unit
    || !Number.isSafeInteger(offer.priceMinor)
    || offer.priceMinor <= 0
    || !Number.isSafeInteger(offer.packSize)
    || offer.packSize <= 0
  ) {
    return null;
  }

  if (offer.packSize === canonicalSize.size) return offer.priceMinor;

  return Math.round((offer.priceMinor * canonicalSize.size) / offer.packSize);
}

function indexOffers(offers) {
  const byKey = new Map();
  for (const offer of offers) {
    byKey.set(`${offer.retailerId}\u0000${offer.canonicalProductId}`, offer);
  }
  return byKey;
}

export function compareWebSnapshot(basketItems, {
  offers = WEB_SNAPSHOT_OFFERS,
  retailers = WEB_SNAPSHOT_RETAILERS,
  canonicalSizes = WEB_SNAPSHOT_CANONICAL_SIZES,
  meta = WEB_SNAPSHOT_META
} = {}) {
  const items = Array.isArray(basketItems)
    ? basketItems.filter(isBasketItem)
    : [];

  if (items.length === 0) return null;

  const offerIndex = indexOffers(offers);

  const stores = retailers.map((retailer) => {
    const lines = items.map((item) => {
      const canonicalSize = canonicalSizes[item.id];
      const offer = offerIndex.get(`${retailer.id}\u0000${item.id}`);
      const unitMinor = snapshotLinePriceMinor(offer, canonicalSize);

      if (unitMinor === null) {
        return Object.freeze({
          canonicalProductId: item.id,
          productName: item.name ?? item.id,
          quantity: item.quantity,
          status: "unknown"
        });
      }

      return Object.freeze({
        canonicalProductId: item.id,
        productName: item.name ?? item.id,
        quantity: item.quantity,
        status: "priced",
        itemName: offer.itemName,
        sourceUrl: offer.sourceUrl,
        packPriceMinor: offer.priceMinor,
        unitMinor,
        recalculated: offer.packSize !== canonicalSize.size,
        lineMinor: unitMinor * item.quantity
      });
    });

    const priced = lines.filter((line) => line.status === "priced");
    const complete = priced.length === lines.length;

    return Object.freeze({
      retailerId: retailer.id,
      name: retailer.name,
      nameIn: retailer.nameIn ?? retailer.name,
      siteUrl: retailer.siteUrl,
      complete,
      coveredCount: priced.length,
      totalCount: lines.length,
      // A partial total is only the sum of known lines; it is never shown
      // as a basket total and never used for "cheapest".
      knownMinor: priced.reduce((sum, line) => sum + line.lineMinor, 0),
      totalMinor: complete
        ? priced.reduce((sum, line) => sum + line.lineMinor, 0)
        : null,
      lines: Object.freeze(lines)
    });
  });

  const completeStores = stores
    .filter((store) => store.complete)
    .sort((left, right) => (
      left.totalMinor - right.totalMinor
      || left.name.localeCompare(right.name, "ru")
    ));

  const partialStores = stores
    .filter((store) => !store.complete)
    .sort((left, right) => (
      right.coveredCount - left.coveredCount
      || left.name.localeCompare(right.name, "ru")
    ));

  let conclusion;

  if (completeStores.length === 0) {
    const anyPriced = stores.some((store) => store.coveredCount > 0);
    conclusion = Object.freeze({
      kind: anyPriced
        ? WEB_SNAPSHOT_CONCLUSION.PARTIAL_ONLY
        : WEB_SNAPSHOT_CONCLUSION.NO_DATA
    });
  } else if (
    completeStores.length > 1
    && completeStores[0].totalMinor === completeStores[1].totalMinor
  ) {
    conclusion = Object.freeze({
      kind: WEB_SNAPSHOT_CONCLUSION.TIE,
      totalMinor: completeStores[0].totalMinor,
      tiedIds: Object.freeze(
        completeStores
          .filter((store) => store.totalMinor === completeStores[0].totalMinor)
          .map((store) => store.retailerId)
      )
    });
  } else {
    const winner = completeStores[0];
    const runnerUp = completeStores[1] ?? null;
    conclusion = Object.freeze({
      kind: WEB_SNAPSHOT_CONCLUSION.CHEAPEST,
      winnerId: winner.retailerId,
      totalMinor: winner.totalMinor,
      runnerUpId: runnerUp?.retailerId ?? null,
      savingsMinor: runnerUp ? runnerUp.totalMinor - winner.totalMinor : null
    });
  }

  return Object.freeze({
    kind: "web-snapshot-comparison",
    meta,
    conclusion,
    stores: Object.freeze([...completeStores, ...partialStores])
  });
}
