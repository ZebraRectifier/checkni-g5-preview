import test from "node:test";
import assert from "node:assert/strict";
import { compareObservedBasket } from "../src/core/observed-price-core.mjs";
import { getReviewedRetailBasketIdentity } from "../src/catalog/reviewedRetailBasket.mjs";
import { normalizeBetaRetailPricesResponse } from "../src/ports/betaRetailPricesPort.mjs";
import { BETA_RETAIL_PRICE_MAX_AGE_MS, loadBetaRetailObservedOffers } from "../src/ports/observedOffersPort.mjs";
import { observedComparisonExpiresAt } from "../src/runtime/observedComparisonExpiry.mjs";
import { CATALOG_FRESHNESS_PROOF_KEY as KEY, METRO_CATALOG_PRICE_MAX_AGE_MS as HOUR,
  LIVE_BETA_RESULT_MAX_AGE_MS, markAdmittedMetroCatalogOffer, metroCatalogLineMaxAgeMs } from "../src/observations/retailCatalogFreshnessPolicy.mjs";

const START = Date.parse("2026-10-22T17:00:00.000Z");
const identity = getReviewedRetailBasketIdentity("milk-25-900");
const basket = [{ product: identity, quantity: 1 }];
function liveOffer() {
  const response = normalizeBetaRetailPricesResponse({ kind: "insufficient", refreshedAt: new Date(START).toISOString(), offers: [{
    sourceId: "metro-public-live", sourceName: "METRO · публичный каталог",
    sourceUrl: "https://online.metro-cc.ru/products/moloko-prostokvashino-pasterizovannoye-2-5-930ml",
    observedAt: new Date(START).toISOString(), granularity: "exact-store", locationTruthLevel: "store",
    locationId: "metro:metro-address-c5gsqz", countryCode: "RU", regionId: "77", regionName: "Москва",
    localityId: "moscow", localityName: "Москва", retailerId: "metro", canonicalProductId: identity.id,
    sourceProductId: "241097", sourceProductName: identity.name, unitPriceMinor: 10600, currency: "RUB",
    priceCondition: "regular", salesChannel: "online", minimumQuantity: 1, storeId: "metro-address-c5gsqz",
    storeName: "METRO", locationLabel: "125445, г. Москва, Ленинградское ш., д.71Г", availability: "unknown"
  }] });
  assert.equal(response.offers?.length, 1);
  return response.offers[0];
}
const core = offers => compareObservedBasket({ basket, offers });
const age = (result, now = START) => {
  const candidate = result.candidates[0]; const line = candidate.lines[0];
  return metroCatalogLineMaxAgeMs(line.provenance.sourceId, line, candidate, now);
};
const deadline = result => observedComparisonExpiresAt(result, (id, line, candidate) =>
  metroCatalogLineMaxAgeMs(id, line, candidate, START) ?? BETA_RETAIL_PRICE_MAX_AGE_MS);

test("only admitted catalogue provenance survives unchanged Core with its fixed named hour policy", () => {
  const live = liveOffer(); const marked = markAdmittedMetroCatalogOffer(live); const result = core([marked]);
  assert.equal(HOUR, 3600000); assert.equal(BETA_RETAIL_PRICE_MAX_AGE_MS, 300000);
  assert.equal(LIVE_BETA_RESULT_MAX_AGE_MS, BETA_RETAIL_PRICE_MAX_AGE_MS);
  assert.equal(age(result), HOUR); assert.equal(deadline(result), START + HOUR);
  assert.equal(result.candidates[0].lines[0].observedAt, live.observedAt);
  assert.equal(result.conclusion.totalMinor, 10600); assert.equal(result.candidates[0].availability, "unknown");
  assert.deepEqual(Object.keys(marked).filter(key => key !== "provenance").sort(), Object.keys(live).sort());
  for (const [key, value] of Object.entries(live)) assert.deepEqual(marked[key], value, key);
  assert.ok(Object.isFrozen(marked.provenance.proof[KEY]));
});

test("absent catalogue proof stays live; null/malformed/mismatched/future or caller TTL proofs fail closed", () => {
  assert.equal(age(core([liveOffer()])), undefined);
  const valid = core([markAdmittedMetroCatalogOffer(liveOffer())]);
  for (const value of [null, [], {}, "hour", { ...valid.candidates[0].lines[0].provenance.proof[KEY], maxAgeMs: 86400000 }]) {
    const copy = structuredClone(valid); copy.candidates[0].lines[0].provenance.proof[KEY] = value;
    assert.ok(Number.isNaN(age(copy))); assert.equal(deadline(copy), 0);
  }
  for (const [field, value] of [["version", 2], ["policyId", "24-hours"], ["storeId", "metro-other"],
    ["productId", "kefir-1l"], ["sourceProductId", "241096"], ["sourceUrl", "https://online.metro-cc.ru/other"],
    ["observedAt", new Date(START - 1).toISOString()]]) {
    const copy = structuredClone(valid); copy.candidates[0].lines[0].provenance.proof[KEY][field] = value;
    assert.ok(Number.isNaN(age(copy)), field); assert.equal(deadline(copy), 0);
  }
  for (const change of [r => { r.candidates[0].retailerId = "magnit"; },
    r => { r.candidates[0].sourceId = "magnit-public-live"; },
    r => { r.candidates[0].lines[0].sourceUrl = "https://online.metro-cc.ru/other"; },
    r => { r.candidates[0].lines[0].observedAt = "invalid"; }]) {
    const copy = structuredClone(valid); change(copy); assert.ok(Number.isNaN(age(copy))); assert.equal(deadline(copy), 0);
  }
  assert.ok(Number.isNaN(age(valid, START - 1))); assert.ok(Number.isNaN(age(valid, NaN)));
});

test("same-time duplicates use only Core's surviving provenance, never a side map that extends live Beta", () => {
  const live = liveOffer(); const saved = markAdmittedMetroCatalogOffer(live);
  const firstLive = core([live, saved]); const firstSaved = core([saved, live]);
  assert.equal(firstLive.candidates[0].lines.length, 1); assert.equal(firstSaved.candidates[0].lines.length, 1);
  assert.equal(deadline(firstLive), START + 300000); assert.equal(deadline(firstSaved), START + HOUR);
  assert.equal(firstLive.conclusion.totalMinor, firstSaved.conclusion.totalMinor);
  // Equal-time commercial disagreements remain Core conflicts, not saved prices.
  const conflict = core([saved, { ...live, unitPriceMinor: 10500 }]);
  assert.equal(conflict.conclusion.kind, "insufficient-coverage");
  assert.equal(conflict.candidates[0].lines[0].status, "conflict-observation");
});

test("unchanged live Beta loader still rejects METRO observations at five minutes plus one", async () => {
  const offer = liveOffer();
  for (const [elapsed, count] of [[300000, 1], [300001, 0], [HOUR, 0]]) {
    const offers = await loadBetaRetailObservedOffers(basket, { nowMs: START + elapsed,
      requestBetaRetailPrices: async () => ({ kind: "insufficient", refreshedAt: offer.observedAt, offers: [offer] }) });
    assert.equal(offers.length, count); assert.equal(offers[0]?.provenance?.proof?.[KEY], undefined);
  }
});
