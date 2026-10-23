import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRetailCatalogClient, normalizeRetailRow } from "../src/ports/retailCatalogPort.mjs";
import { loadSelectedRetailCatalogOffers } from "../src/ports/selectedRetailCatalogOffersPort.mjs";
import { createSelectedAddressComparisonPort } from "../src/ports/comparisonPort.mjs";
import { createSelectedStoreScope } from "../src/observations/selectedStoreScope.mjs";
import { getReviewedRetailBasketIdentity } from "../src/catalog/reviewedRetailBasket.mjs";
import { confirmBetaRetailIdentity, clearBetaRetailIdentityConfirmation } from "../src/ports/betaRetailPricesPort.mjs";
import { METRO_CATALOG_PRICE_MAX_AGE_MS, metroCatalogLineMaxAgeMs } from "../src/observations/retailCatalogFreshnessPolicy.mjs";

beforeEach(() => { clearBetaRetailIdentityConfirmation(); confirmBetaRetailIdentity(); });

const nowMs = Date.parse("2026-10-13T17:00:00Z");
const scope = () => createSelectedStoreScope({ metro: "10", magnit: "777312", globus: "5011" });
const specs = [
  ["241097", "milk-25-900", "Молоко Простоквашино пастеризованное 2.5%, 930мл", "930 мл", "moloko-prostokvashino-pasterizovannoye-2-5-930ml", 10600],
  ["241096", "kefir-1l", "Кефир Простоквашино 2.5%, 930г", "930 г", "kefir-prostokvashino-25-930g", 11100],
  ["644791", "butter-825-180", "Масло сливочное Брест-Литовск 82.5%, 180г", "180 г", "brest-litovskoe-825-180g-bzmzh", 22900]
];
const basket = specs.map(([, id]) => ({ ...getReviewedRetailBasketIdentity(id), quantity: 1 }));
const coreBasket = basket.map(({ quantity, ...product }) => ({ product, quantity }));
function row(index = 0, overrides = {}) {
  const [source_product_id, , name, weight_text, path, price_minor] = specs[index];
  const source_url = `https://online.metro-cc.ru/products/${path}`;
  return { retailer_id: "metro", store_id: "metro-address-c5gsqz", store_name: "METRO · Ленинградское ш. 71Г",
    locality_id: "city-moscow", locality_name: "Москва", source_product_id, name, weight_text, price_minor,
    currency: "RUB", availability: "unknown", product_url: source_url, source_url,
    price_condition: "regular", sales_channel: "online", minimum_quantity: 1, quantity_semantics: {},
    scope_binding: "same-source", binding_id: "metro-address-c5gsqz", scope_evidence_url: source_url,
    location_label: "125445, г. Москва, Ленинградское ш., д.71Г",
    observed_at: new Date(nowMs - 60000).toISOString(), ...overrides };
}
function loader(rows, capture = []) {
  return (core, selected) => loadSelectedRetailCatalogOffers(core, selected, { nowMs,
    createCatalogClient: options => createRetailCatalogClient({ ...options,
      fetchImpl: async url => { capture.push(new URL(url)); return new Response(JSON.stringify(rows)); } }) });
}

test("selected catalogue supplies the reviewed basket to Core with actual price/time and unknown stock", async () => {
  const urls = [];
  const port = createSelectedAddressComparisonPort(scope, {
    loadObservedOffers: async () => [], loadCatalogOffers: loader(specs.map((_, i) => row(i)), urls)
  });
  const result = await port.compare(basket);
  assert.equal(result.conclusion.kind, "observed-total-only");
  assert.equal(result.conclusion.totalMinor, 44600);
  assert.equal(result.savingsMinor, null);
  assert.equal(result.candidates.length, 1);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get("store_id"), "eq.metro-address-c5gsqz");
  assert.equal(urls[0].searchParams.get("source_product_id"), "in.(241097,241096,644791)");
  assert.equal(urls[0].searchParams.get("limit"), "3");
  const offers = await loader([row()])(coreBasket, scope());
  assert.equal(offers[0].observedAt, row().observed_at);
  assert.equal(offers[0].availability, "unknown");
});

test("missing basket rows cannot become a complete basket or zero-priced products", async () => {
  const result = await createSelectedAddressComparisonPort(scope, {
    loadObservedOffers: async () => [], loadCatalogOffers: loader([row()])
  }).compare(basket);
  assert.equal(result.conclusion.kind, "insufficient-coverage");
  assert.equal(result.savingsMinor, null);
});

test("stale, future, wrong pack/store/address and unqualified commercial evidence fail closed", async () => {
  for (const patch of [
    { observed_at: new Date(nowMs - METRO_CATALOG_PRICE_MAX_AGE_MS - 1).toISOString() },
    { observed_at: new Date(nowMs + 1).toISOString() },
    { weight_text: "900 мл" }, { source_product_id: "241098" },
    { store_id: "metro-address-other" }, { location_label: "Ленинградское ш., 71Г корпус 2" },
    { price_condition: "public-online" }, { minimum_quantity: null }, { minimum_quantity: 2 },
    { sales_channel: "store" }, { scope_binding: "separate-source" },
    { scope_evidence_url: "https://online.metro-cc.ru/dynamic/other" },
    { quantity_semantics: { kind: "multibuy", minimum_quantity: 2 } }, { quantity_semantics: null }
  ]) assert.deepEqual(await loader([row(0, patch)])(coreBasket, scope()), [], JSON.stringify(patch));
});

test("explicit saved-catalogue policy admits original source times through one hour and marks only strict admissions", async () => {
  for (const elapsed of [300001, 12 * 60000, METRO_CATALOG_PRICE_MAX_AGE_MS]) {
    const observedAt = new Date(nowMs - elapsed).toISOString();
    const offers = await loader([row(0, { observed_at: observedAt })])(coreBasket, scope());
    assert.equal(offers.length, 1); assert.equal(offers[0].observedAt, observedAt);
    const result = await createSelectedAddressComparisonPort(scope, {
      loadObservedOffers: async () => [], loadCatalogOffers: async () => offers
    }).compare([basket[0]]);
    const candidate = result.candidates[0]; const line = candidate.lines[0];
    assert.equal(metroCatalogLineMaxAgeMs(line.provenance.sourceId, line, candidate, nowMs), 3600000);
    assert.equal(result.conclusion.totalMinor, 10600); assert.equal(candidate.availability, "unknown");
  }
  for (const patch of [{ price_minor: 0 }, { currency: "USD" }, { availability: "available" },
    { price_condition: "loyalty" }, { minimum_quantity: 2 }, { quantity_semantics: { minimum_quantity: 2 } }]) {
    assert.deepEqual(await loader([row(0, patch)])(coreBasket, scope()), [], JSON.stringify(patch));
  }
});

test("unreviewed basket identity and unsupported retailer selections never start catalogue requests", async () => {
  const urls = [];
  const load = loader([row()], urls);
  assert.deepEqual(await load([{ product: { id: "milk-25-900", name: "Молоко 2,5%", unit: "900 мл" }, quantity: 1 }], scope()), []);
  assert.deepEqual(await load(coreBasket, createSelectedStoreScope({ magnit: "777312", globus: "5011" })), []);
  assert.deepEqual(await load(coreBasket, createSelectedStoreScope({ metro: "unknown" })), []);
  assert.equal(urls.length, 0);
});

test("catalogue price comparison waits for the existing explicit identity confirmation", async () => {
  clearBetaRetailIdentityConfirmation();
  const urls = [];
  assert.deepEqual(await loader([row() ], urls)(coreBasket, scope()), []);
  assert.equal(urls.length, 0);
  confirmBetaRetailIdentity();
  assert.equal((await loader([row()], urls)(coreBasket, scope())).length, 1);
  assert.equal(urls.length, 1);
});

test("address changes during catalogue loading reject the captured comparison", async () => {
  let selection = { metro: "10" }, release;
  const pendingRows = new Promise(resolve => { release = resolve; });
  const port = createSelectedAddressComparisonPort(() => createSelectedStoreScope(selection), {
    loadObservedOffers: async () => [], loadCatalogOffers: async (core, captured) => {
      await pendingRows;
      return loader([row()])(core, captured);
    }
  });
  const pending = port.compare(basket);
  selection = { metro: "2" };
  release();
  await assert.rejects(pending, /addresses changed/);
});

test("catalogue transport failure preserves admitted observations from the existing loader", async () => {
  const existing = await loader([row()])(coreBasket, scope());
  const port = createSelectedAddressComparisonPort(scope, {
    loadObservedOffers: async () => existing, loadCatalogOffers: async () => { throw Error("offline"); }
  });
  const result = await port.compare([basket[0]]);
  assert.equal(result.conclusion.totalMinor, 10600);
});

test("exact source ID lookup rejects query injection and malformed inputs without requesting", async () => {
  let calls = 0;
  const client = createRetailCatalogClient({ retailerId: "metro", fetchImpl: async () => { calls++; } });
  for (const ids of [null, [], ["241097),name.eq.fake"], Array(41).fill("241097"), [2]]) {
    assert.equal((await client.bySourceProductIds(ids)).code, "invalid_request");
  }
  assert.equal(calls, 0);
  assert.equal(normalizeRetailRow(row(), "metro").comparisonEvidence, undefined);
});
