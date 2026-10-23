import test from 'node:test';
import assert from 'node:assert/strict';
import { observedComparisonExpiresAt } from '../src/runtime/observedComparisonExpiry.mjs';
import { COMPARISON_STATUS, createComparisonFlow } from '../src/runtime/comparisonFlow.mjs';
import { compareObservedBasket, OBSERVED_LINE_STATUS } from '../src/core/observed-price-core.mjs';
import { loadSelectedGlobusCatalogOffers, GLOBUS_CATALOG_PRICE_MAX_AGE_MS } from '../src/ports/selectedGlobusCatalogOffersPort.mjs';
import { getReviewedRetailBasketIdentity } from '../src/catalog/reviewedRetailBasket.mjs';
import { createSelectedStoreScope } from '../src/observations/selectedStoreScope.mjs';
import { resolveGlobusMoscowRegionStore } from '../src/data/globusMoscowRegionStores.mjs';
import { buildObservedResultModel } from '../src/components/ComparisonResult.mjs';
import { loadSelectedRetailCatalogOffers } from '../src/ports/selectedRetailCatalogOffersPort.mjs';
import { confirmBetaRetailIdentity } from '../src/ports/betaRetailPricesPort.mjs';
import { BETA_RETAIL_PRICE_MAX_AGE_MS } from '../src/ports/observedOffersPort.mjs';
import { metroCatalogLineMaxAgeMs } from '../src/observations/retailCatalogFreshnessPolicy.mjs';

const START = Date.parse('2026-10-16T00:00:00.000Z');
const HOUR = 3600000;
const SOURCE = 'globus-physical-catalog';
const basket = [{ id: 'reviewed-product', name: 'Synthetic fixture', unit: '1 шт', quantity: 1 }];
const policy = id => id === SOURCE ? HOUR : null;
const expiry = result => observedComparisonExpiresAt(result, policy);
const line = (observedAt = START, sourceId = SOURCE) => ({ status: OBSERVED_LINE_STATUS.PRICED,
  observedAt: new Date(observedAt).toISOString(), provenance: { sourceId } });
function resultAt(observedAt = START) {
  return { kind: 'observed-price-comparison', winner: { storeId: 'globus-store-5020', totalMinor: 9000 },
    savingsMinor: 1000, conclusion: { kind: 'cheapest-proven', totalMinor: 9000, savingsMinor: 1000 },
    candidates: [
      { sourceId: SOURCE, lines: [line(observedAt)] },
      { sourceId: SOURCE, lines: [line(observedAt + 1000)] }
    ] };
}
function clock() {
  let current = START; let sequence = 0;
  const tasks = new Map(); const scheduled = [];
  return { now: () => current, tasks, scheduled,
    schedule(callback, delay) { const id = ++sequence; const task = { id, callback, delay, due: current + delay };
      tasks.set(id, task); scheduled.push(task); return id; },
    cancel(id) { tasks.delete(id); },
    advance(milliseconds, { runTimers = true } = {}) {
      current += milliseconds;
      if (!runTimers) return;
      for (;;) {
        const task = [...tasks.values()].find(task => task.due <= current);
        if (!task) break;
        tasks.delete(task.id); task.callback();
      }
    }
  };
}
function flowFor(time, compare, onExpire = () => {}) {
  return createComparisonFlow(compare, { now: time.now, schedule: time.schedule,
    cancel: time.cancel, getResultExpiresAt: expiry, onExpire });
}

test('actual selected-source admission and unchanged Core result expire with its real line schema', async () => {
  const identity = getReviewedRetailBasketIdentity('globus-kefir-prostokvashino-32-930g');
  const coreBasket = [{ product: identity, quantity: 1 }];
  const scope = createSelectedStoreScope({ globus: '5011', globusCompare: '5020' });
  const sourceUrl = 'https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965';
  // Synthetic prices are passed through the production source validator and
  // Core, so this regression cannot invent a different candidate line status.
  const offers = await loadSelectedGlobusCatalogOffers(coreBasket, scope, { nowMs: START,
    createCatalogClient: ({ store }) => ({ bySourceProductIds: async () => ({ kind: 'catalog', products: [{
      retailerId: 'globus', sourceProductId: '000000000000027692_ST', name: 'Кефир Простоквашино 3,2%, 930г',
      unit: identity.unit, basketProductId: identity.id,
      productUrl: 'https://www.globus.ru/products/kefir-prostokvashino-32-930g-27692_ST/',
      sourceUrl, observedAt: new Date(START).toISOString(), storeName: store.name,
      priceMinor: store.officialStoreId === '5011' ? 14999 : 13999,
      currency: 'RUB', priceCondition: 'regular', availability: 'unknown',
      comparisonEvidence: { storeId: `globus-store-${store.officialStoreId}`, locationLabel: store.address,
        salesChannel: 'store', minimumQuantity: 1, scopeBinding: 'same-source', bindingId: store.bindingId,
        scopeEvidenceUrl: sourceUrl,
        quantitySemantics: { packageType: 'piece', basketStep: 1, basketMinVolume: 1, unitPriceText: '1 шт' } }
    }] }) }) });
  assert.equal(offers.length, 2);
  assert.ok(offers.every(offer => offer.freshness.maxAgeMs === GLOBUS_CATALOG_PRICE_MAX_AGE_MS));
  const result = compareObservedBasket({ basket: coreBasket, offers });
  assert.equal(result.conclusion.kind, 'cheapest-proven');
  assert.equal(result.candidates[0].lines[0].status, 'priced-observation');
  assert.equal(expiry(result), START + GLOBUS_CATALOG_PRICE_MAX_AGE_MS);
  const model = buildObservedResultModel(result);
  assert.equal(model.totalLabel, '139,99 ₽');
  assert.equal(model.navigation.url, resolveGlobusMoscowRegionStore('5020').officialUrl);
  const time = clock(); const flow = flowFor(time, async () => result);
  await flow.run([{ ...identity, quantity: 1 }]);
  time.advance(GLOBUS_CATALOG_PRICE_MAX_AGE_MS + 1);
  assert.equal(flow.getState().status, COMPARISON_STATUS.STALE);
  assert.equal(buildObservedResultModel(flow.getState().result), null, 'stale total/savings/navigation has no result to render');
});

test('earliest exact source row, including the competing store, bounds the displayed conclusion', () => {
  const result = resultAt(); result.candidates[1].lines.push(line(START - 120000));
  const original = structuredClone(result);
  assert.equal(expiry(result), START - 120000 + HOUR);
  assert.deepEqual(result, original, 'lifetime extraction must not recalculate or mutate Core facts');
});

test('only priced observations from an explicitly supplied source age policy have a deadline', () => {
  const result = resultAt(); result.candidates[0].lines.push({ status: 'unknown-price', observedAt: 'invalid' });
  assert.equal(expiry(result), START + HOUR);
  assert.equal(observedComparisonExpiresAt(result, () => null), null);
  assert.equal(expiry({ winner: { totalMinor: 1 } }), null, 'demo/mock keeps its existing contract');
  assert.equal(expiry({ kind: 'observed-price-comparison', candidates: [{ lines: [] }] }), null);
});

test('missing source timestamps or invalid supplied lifetimes cannot produce an unbounded scoped result', () => {
  for (const observedAt of [undefined, 'invalid']) {
    const result = resultAt(); result.candidates[0].lines[0].observedAt = observedAt;
    assert.equal(expiry(result), 0);
  }
  for (const age of [-1, NaN, Infinity]) assert.equal(observedComparisonExpiresAt(resultAt(), () => age), 0);
});

test('idle displayed winner/savings are cleared one millisecond beyond the inclusive one-hour boundary', async () => {
  const time = clock(); const result = resultAt(); let expired = 0;
  const flow = flowFor(time, async () => result, () => { expired++; });
  await flow.run(basket);
  assert.equal(flow.getState().result, result);
  time.advance(HOUR);
  assert.equal(flow.getState().status, COMPARISON_STATUS.SUCCESS);
  assert.equal(expired, 0);
  time.advance(1);
  assert.equal(flow.getState().status, COMPARISON_STATUS.STALE);
  assert.equal(flow.getState().result, null, 'all stale commercial facts and result-derived next actions disappear');
  assert.equal(expired, 1); assert.equal(time.tasks.size, 0);
  assert.deepEqual(basket, [{ id: 'reviewed-product', name: 'Synthetic fixture', unit: '1 шт', quantity: 1 }]);
});

test('focus/resume check catches suspended timers and does not restart the source lifetime', async () => {
  const time = clock(); let expired = 0;
  const flow = flowFor(time, async () => resultAt(), () => { expired++; });
  await flow.run(basket);
  time.advance(2 * HOUR, { runTimers: false });
  assert.equal(flow.checkExpiry().status, COMPARISON_STATUS.STALE);
  assert.equal(flow.getState().result, null); assert.equal(expired, 1); assert.equal(time.tasks.size, 0);
  flow.checkExpiry(); assert.equal(expired, 1);
});

test('getState prevents a stale winner action even before a delayed browser timer callback runs', async () => {
  const time = clock(); const flow = flowFor(time, async () => resultAt());
  await flow.run(basket); time.advance(HOUR + 1, { runTimers: false });
  assert.equal(flow.getState().status, COMPARISON_STATUS.STALE);
  assert.equal(flow.getState().result, null);
});

test('a delayed compare response cannot publish an already expired observation', async () => {
  const time = clock(); let resolve; let expired = 0;
  const flow = flowFor(time, () => new Promise(done => { resolve = done; }), () => { expired++; });
  const pending = flow.run(basket);
  time.advance(HOUR + 1); resolve(resultAt());
  assert.equal((await pending).status, COMPARISON_STATUS.STALE);
  assert.equal(flow.getState().result, null); assert.equal(expired, 1); assert.equal(time.tasks.size, 0);
});

test('a manually retried comparison admits only the new result and uses its original source time', async () => {
  const time = clock(); let result = resultAt(); const flow = flowFor(time, async () => result);
  await flow.run(basket); time.advance(HOUR + 1);
  assert.equal(flow.getState().status, COMPARISON_STATUS.STALE);
  result = resultAt(time.now() - 60000); await flow.run(basket);
  assert.equal(flow.getState().status, COMPARISON_STATUS.SUCCESS);
  time.advance(HOUR - 60000); assert.equal(flow.getState().status, COMPARISON_STATUS.SUCCESS);
  time.advance(1); assert.equal(flow.getState().status, COMPARISON_STATUS.STALE);
});

test('basket/address invalidation cancels timers; cancelled callbacks cannot overwrite a newer comparison', async () => {
  const time = clock(); let result = resultAt(START - HOUR + 1000); let expired = 0;
  const flow = flowFor(time, async () => result, () => { expired++; });
  await flow.run(basket); const obsolete = time.scheduled[0].callback;
  flow.invalidate(); assert.equal(time.tasks.size, 0);
  result = resultAt(START - HOUR + 5000); await flow.run(basket);
  time.advance(2000, { runTimers: false }); obsolete();
  assert.equal(flow.getState().status, COMPARISON_STATUS.SUCCESS);
  assert.equal(flow.getState().result, result); assert.equal(expired, 0); assert.equal(time.tasks.size, 1);
  time.advance(3001); assert.equal(flow.getState().status, COMPARISON_STATUS.STALE); assert.equal(expired, 1);
});

test('a newer in-flight comparison clears the previous deadline and rejects older pending completions', async () => {
  const time = clock(); const resolvers = [];
  const flow = flowFor(time, () => new Promise(done => { resolvers.push(done); }));
  const first = flow.run(basket); const second = flow.run([{ ...basket[0], quantity: 2 }]);
  resolvers[0](resultAt(START - HOUR)); await first;
  assert.equal(flow.getState().status, COMPARISON_STATUS.LOADING); assert.equal(time.tasks.size, 0);
  const newest = resultAt(); resolvers[1](newest); await second;
  assert.equal(flow.getState().result, newest); assert.equal(time.tasks.size, 1);
});

test('a failed refresh clears the previous deadline and result without resurrecting stale commercial facts', async () => {
  const time = clock(); let fail = false;
  const flow = flowFor(time, async () => { if (fail) throw Error('transport'); return resultAt(); });
  await flow.run(basket); fail = true; await flow.run(basket);
  assert.equal(flow.getState().status, COMPARISON_STATUS.ERROR); assert.equal(time.tasks.size, 0);
  time.advance(2 * HOUR); assert.equal(flow.getState().result, null);
});

test('unconfigured source/demo result keeps the existing flow contract and creates no idle timer', async () => {
  const time = clock(); const result = resultAt(); result.candidates.forEach(candidate => {
    candidate.lines.forEach(row => { row.provenance.sourceId = 'another-source'; });
  });
  const flow = flowFor(time, async () => result); await flow.run(basket); time.advance(2 * HOUR);
  assert.equal(flow.getState().status, COMPARISON_STATUS.SUCCESS); assert.equal(time.tasks.size, 0);
  const legacy = createComparisonFlow(async () => resultAt());
  assert.equal((await legacy.run(basket)).status, COMPARISON_STATUS.SUCCESS);
});

const metroExpiry = (result, now) => observedComparisonExpiresAt(result, (id, row, candidate) => {
  const saved = metroCatalogLineMaxAgeMs(id, row, candidate, now);
  if (saved !== undefined) return saved;
  if (id === 'metro-public-live' || id === 'magnit-public-live') return BETA_RETAIL_PRICE_MAX_AGE_MS;
  return policy(id);
});
async function metroResult(observed = START - 12 * 60000) {
  confirmBetaRetailIdentity();
  const identity = getReviewedRetailBasketIdentity('milk-25-900');
  const coreBasket = [{ product: identity, quantity: 1 }];
  const sourceUrl = 'https://online.metro-cc.ru/products/moloko-prostokvashino-pasterizovannoye-2-5-930ml';
  const offers = await loadSelectedRetailCatalogOffers(coreBasket, createSelectedStoreScope({ metro: '10' }), {
    nowMs: Math.max(START, observed), createCatalogClient: ({ store }) => ({ bySourceProductIds: async () => ({ kind: 'catalog', products: [{
      retailerId: 'metro', sourceProductId: '241097', basketProductId: identity.id,
      name: 'Молоко Простоквашино пастеризованное 2.5%, 930мл', productUrl: sourceUrl,
      unit: identity.unit, sourceUrl, observedAt: new Date(observed).toISOString(), storeName: `METRO · ${store.address}`,
      priceMinor: 10600, currency: 'RUB', availability: 'unknown', priceCondition: 'regular',
      comparisonEvidence: { storeId: store.storeId, bindingId: store.bindingId, locationLabel: store.address,
        salesChannel: 'online', minimumQuantity: 1, scopeBinding: 'same-source', scopeEvidenceUrl: sourceUrl, quantitySemantics: {} }
    }] }) })
  });
  assert.equal(offers.length, 1);
  return compareObservedBasket({ basket: coreBasket, offers });
}

test('real METRO bridge -> Core -> idle timer uses original saved time and revokes the result and receipt', async () => {
  const result = await metroResult(); const time = clock(); let revoked = 0;
  const flow = createComparisonFlow(async () => result, { now: time.now, schedule: time.schedule, cancel: time.cancel,
    getContext: () => ({ mode: 'observed', scope: createSelectedStoreScope({ metro: '10' }) }),
    getResultExpiresAt: value => metroExpiry(value, time.now()), onReceiptInvalidated: () => { revoked++; } });
  await flow.run(basket); assert.ok(flow.getCurrentComparison(basket));
  assert.equal(time.scheduled[0].delay, 48 * 60000 + 1);
  time.advance(48 * 60000); assert.equal(flow.getState().status, 'success');
  time.advance(1); assert.equal(flow.getState().status, 'stale');
  assert.equal(flow.getState().result, null); assert.equal(flow.getCurrentComparison(basket), null);
  assert.equal(revoked, 1); assert.equal(time.tasks.size, 0);
});

test('mixed saved METRO, live METRO/Magnit and GLOBUS use the earliest line deadline', async () => {
  const saved = await metroResult();
  for (const id of ['metro-public-live', 'magnit-public-live']) {
    const live = structuredClone(saved.candidates[0]);
    live.sourceId = id; live.retailerId = id.startsWith('magnit') ? 'magnit' : 'metro';
    live.lines[0].observedAt = new Date(START - 4 * 60000).toISOString();
    live.lines[0].provenance = { ...live.lines[0].provenance, sourceId: id, proof: null };
    const mixed = { ...saved, candidates: [...saved.candidates, live, ...resultAt(START - 30 * 60000).candidates] };
    assert.equal(metroExpiry(mixed, START), START + 60000);
    const time = clock(); const flow = createComparisonFlow(async () => mixed, {
      now: time.now, schedule: time.schedule, cancel: time.cancel, getResultExpiresAt: value => metroExpiry(value, time.now()) });
    await flow.run(basket); time.advance(60001, { runTimers: false });
    assert.equal(flow.checkExpiry().status, 'stale'); assert.equal(time.tasks.size, 0);
  }
});

test('METRO pause/focus, late completion and manual retry cannot reset the source observation clock', async () => {
  const result = await metroResult(); const time = clock(); let resolve;
  const flow = createComparisonFlow(async () => result, { now: time.now, schedule: time.schedule, cancel: time.cancel,
    getResultExpiresAt: value => metroExpiry(value, time.now()) });
  await flow.run(basket); time.advance(HOUR, { runTimers: false });
  assert.equal(flow.checkExpiry().status, 'stale');
  assert.equal((await flow.run(basket)).status, 'stale', 're-reading identical saved rows cannot restamp them');
  const late = createComparisonFlow(() => new Promise(done => { resolve = done; }), {
    now: time.now, schedule: time.schedule, cancel: time.cancel, getResultExpiresAt: value => metroExpiry(value, time.now()) });
  const pending = late.run(basket); resolve(result); assert.equal((await pending).status, 'stale');
  const future = await metroResult(time.now() + 1);
  assert.equal(metroExpiry(future, time.now()), 0, 'future marker cannot create a future lease');
  assert.equal(time.tasks.size, 0);
});
