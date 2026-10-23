import test from 'node:test';
import assert from 'node:assert/strict';
import { createComparisonFlow } from '../src/runtime/comparisonFlow.mjs';
import { observedComparisonExpiresAt } from '../src/runtime/observedComparisonExpiry.mjs';
import { currentComparisonExplanation } from '../src/intelligence/currentComparisonExplanation.mjs';
import { compareObservedBasket } from '../src/core/observed-price-core.mjs';
import { loadSelectedGlobusCatalogOffers, GLOBUS_CATALOG_PRICE_MAX_AGE_MS as HOUR } from '../src/ports/selectedGlobusCatalogOffersPort.mjs';
import { createSelectedStoreScope } from '../src/observations/selectedStoreScope.mjs';
import { getReviewedRetailBasketIdentity } from '../src/catalog/reviewedRetailBasket.mjs';
import { createShoppingConversationFlow } from '../src/runtime/shoppingConversationFlow.mjs';
import { createBasketStore } from '../src/state/basketStore.mjs';
import { SHOP_CATALOG } from '../src/data/shopCatalog.mjs';
import * as interpreter from '../src/runtime/hybridBasketInterpreter.mjs';
import { loadSelectedRetailCatalogOffers } from '../src/ports/selectedRetailCatalogOffersPort.mjs';
import { confirmBetaRetailIdentity } from '../src/ports/betaRetailPricesPort.mjs';
import { metroCatalogLineMaxAgeMs } from '../src/observations/retailCatalogFreshnessPolicy.mjs';

const START = Date.now() - 1000;
const source = 'globus-physical-catalog';
const identity = getReviewedRetailBasketIdentity('globus-kefir-prostokvashino-32-930g');
const second = getReviewedRetailBasketIdentity('globus-dobry-cola-1l');
const surface = [{ id: identity.id, name: identity.name, unit: identity.unit, quantity: 1 }];
const scope = createSelectedStoreScope({ globus: '5011', globusCompare: '5020' });
const context = () => ({ mode: 'observed', scope });
const expiry = result => observedComparisonExpiresAt(result, id => id === source ? HOUR : null);
async function actualResult(options = {}) {
  const basket = [{ product: identity, quantity: 1 }];
  if (options.partial) basket.push({ product: second, quantity: 1 });
  const sourceUrl = 'https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965';
  const offers = await loadSelectedGlobusCatalogOffers(basket, scope, { nowMs: START,
    createCatalogClient: ({ store }) => ({ bySourceProductIds: async () => ({ kind: 'catalog', products: [{
      retailerId: 'globus', sourceProductId: '000000000000027692_ST', name: 'Кефир Простоквашино 3,2%, 930г',
      unit: identity.unit, basketProductId: identity.id,
      productUrl: 'https://www.globus.ru/products/kefir-prostokvashino-32-930g-27692_ST/',
      sourceUrl, observedAt: new Date(START).toISOString(), storeName: store.name,
      priceMinor: options.tie || store.officialStoreId === '5011' ? 14999 : 13999,
      currency: 'RUB', priceCondition: 'regular', availability: 'unknown',
      comparisonEvidence: { storeId: 'globus-store-' + store.officialStoreId, locationLabel: store.address,
        salesChannel: 'store', minimumQuantity: 1, scopeBinding: 'same-source', bindingId: store.bindingId,
        scopeEvidenceUrl: sourceUrl,
        quantitySemantics: { packageType: 'piece', basketStep: 1, basketMinVolume: 1, unitPriceText: '1 шт' } }
    }] }) }) });
  assert.equal(offers.length, 2, 'fixtures pass the production exact-store source validator');
  return compareObservedBasket({ basket, offers: options.single ? offers.slice(0, 1) : offers });
}
function owner(result, options = {}) {
  let now = START; let currentContext = context(); let compareCalls = 0;
  const flow = createComparisonFlow(options.compare ?? (async () => { compareCalls++; return result; }), {
    getContext: () => currentContext, getResultExpiresAt: expiry, now: () => now,
    schedule: () => 1, cancel: () => {}, onReceiptInvalidated: options.onReceiptInvalidated ?? (() => {})
  });
  return { flow, setContext: value => { currentContext = value; }, setTime: value => { now = value; },
    calls: () => compareCalls, read: (rows = surface) => flow.getCurrentComparison(rows) };
}

test('actual selected-source -> unchanged Core -> UI receipt -> conversation explains identical sums with zero new calls', async () => {
  const result = await actualResult(); const own = owner(result); await own.flow.run(surface);
  assert.equal(result.conclusion.kind, 'cheapest-proven');
  assert.equal(result.conclusion.totalMinor, 13999); assert.equal(result.conclusion.savingsMinor, 1000);
  const basket = createBasketStore({ storage: null }); basket.mergeValidatedBasket([{ product: identity, quantity: 1 }]);
  let provider = 0; let sourceCalls = 0;
  const chat = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG, preferenceStorage: null,
    priceHints: new Map(), loader: { load: async () => interpreter }, getCurrentComparison: () => own.read(basket.getSnapshot()),
    resolveRetailSelectionScope: () => ({ retailerId: 'globus', storeId: '5011' }),
    requestShoppingAdvice: async () => { provider++; throw Error('must not call'); },
    requestAiProposal: async () => { provider++; throw Error('must not call'); },
    resolveCommercialRequest: async () => { sourceCalls++; throw Error('must not compare/fetch'); } });
  const before = structuredClone(basket.getSnapshot());
  for (const text of ['Хай', 'Слушай']) {
    await chat.run(text);
    assert.ok(['greeting', 'attention'].includes(chat.getState().result.assistantReply?.dialogueKind));
    assert.deepEqual(basket.getSnapshot(), before);
  }
  await chat.run('Почему этот магазин дешевле?');
  const message = chat.getState().presentation.message;
  assert.match(message, /Глобус Медведково/u); assert.match(message, /139,99 ₽/u); assert.match(message, /149,99 ₽/u);
  assert.match(message, /Экономия 10,00 ₽/u); assert.match(message, /1 из 1 позиций/u);
  assert.match(message, /Наличие товаров не подтверждено/u);
  assert.equal(chat.getState().result.triggerReason, 'smalltalk');
  assert.equal(chat.getState().result.currentComparisonExplanation, true);
  assert.equal(provider, 0); assert.equal(sourceCalls, 0); assert.equal(own.calls(), 1);
  const preferences = structuredClone(chat.getConversation());
  await chat.run('Почему выбрала Магнит?');
  assert.match(chat.getState().presentation.message, /Глобус Медведково/u);
  assert.deepEqual(chat.getConversation(), preferences, 'a retailer name in this explanation is not a new preference');
  assert.equal(provider, 0); assert.equal(sourceCalls, 0); assert.equal(own.calls(), 1);
  assert.deepEqual(basket.getSnapshot(), before); chat.confirm('confirm_all'); assert.deepEqual(basket.getSnapshot(), before);
});

test('inclusive expiry uses every original priced line including the competing address', async () => {
  const result = await actualResult(); const own = owner(result); await own.flow.run(surface);
  own.setTime(START + HOUR);
  assert.ok(currentComparisonExplanation(own.read(), { nowMs: START + HOUR }));
  own.setTime(START + HOUR + 1); assert.equal(own.read(), null);
  assert.equal(own.flow.getState().status, 'stale');
  const changed = structuredClone(result);
  const competitor = changed.candidates.find(candidate => candidate.candidateId !== changed.conclusion.candidateId);
  competitor.lines[0].observedAt = new Date(START - 1).toISOString();
  assert.equal(currentComparisonExplanation({ result: changed, context: context() }, { nowMs: START + HOUR }), null);
});

for (const field of ['id', 'name', 'unit', 'quantity']) test(`a changed surface basket ${field} revokes rather than resurrects the receipt`, async () => {
  const own = owner(await actualResult()); await own.flow.run(surface);
  const rows = structuredClone(surface); rows[0][field] = field === 'quantity' ? 2 : rows[0][field] + ' changed';
  assert.equal(own.read(rows), null); assert.equal(own.read(), null);
});

for (const change of [
  () => ({ mode: 'demo', scope }),
  () => ({ mode: 'observed', scope: createSelectedStoreScope({ globus: '5020', globusCompare: '5011' }) }),
  () => ({ mode: 'observed', scope: createSelectedStoreScope({ globus: '5011' }) })
]) test('mode, primary address and selected peer are part of the captured lease', async () => {
  const own = owner(await actualResult()); await own.flow.run(surface);
  own.setContext(change()); assert.equal(own.read(), null);
  own.setContext(context()); assert.equal(own.read(), null, 'returning to the old scope cannot resurrect it');
});

test('scope is rechecked at completion and participates in in-flight deduplication', async () => {
  const result = await actualResult(); const resolve = []; let selected = context();
  const flow = createComparisonFlow(() => new Promise(done => resolve.push(done)), { getContext: () => selected,
    getResultExpiresAt: expiry, now: () => START, schedule: () => 1, cancel: () => {} });
  const first = flow.run(surface); selected = { mode: 'observed', scope: createSelectedStoreScope({ globus: '5011' }) };
  const secondRun = flow.run(surface); assert.notEqual(first, secondRun); assert.equal(resolve.length, 2);
  resolve[0](result); await first; assert.equal(flow.getCurrentComparison(surface), null);
  selected = context(); resolve[1](result); await secondRun;
  assert.equal(flow.getState().status, 'idle'); assert.equal(flow.getCurrentComparison(surface), null);
});

test('invalidate, a newer loading comparison and a failed refresh immediately revoke a former success', async () => {
  const result = await actualResult(); let fail = false; let release; let wait = false;
  const own = owner(result, { compare: async () => {
    if (fail) throw Error('offline'); if (wait) return new Promise(done => { release = done; }); return result;
  } });
  await own.flow.run(surface); assert.ok(own.read());
  own.flow.invalidate(); assert.equal(own.read(), null);
  await own.flow.run(surface); wait = true; const pending = own.flow.run(surface); assert.equal(own.read(), null);
  release(result); await pending; assert.ok(own.read());
  wait = false; fail = true; await own.flow.run(surface); assert.equal(own.read(), null);
});

for (const mutation of [
  result => { result.candidates[0].sourceId = 'unsupported-source'; },
  result => { result.candidates[0].lines[0].provenance.sourceId = 'unsupported-source'; },
  result => { result.candidates[0].lines[0].observedAt = 'invalid'; },
  result => { result.candidates[0].lines[0].observedAt = new Date(START + 1).toISOString(); },
  result => { result.candidates.forEach(candidate => { candidate.lines = []; }); },
  result => { result.conclusion = null; }
]) test('unsupported/mixed source, malformed/future time, missing prices and legacy winner cannot prove a fresh explanation', async () => {
  const changed = structuredClone(await actualResult()); mutation(changed);
  assert.equal(currentComparisonExplanation({ result: changed, context: context() }, { nowMs: START }), null);
});

for (const [options, kind, expected] of [
  [{ tie: true }, 'lowest-tie', /Одинаковый минимум 149,99 ₽/u],
  [{ single: true }, 'observed-total-only', /наблюдаемая сумма 149,99 ₽/u],
  [{ partial: true }, 'insufficient-coverage', /Победителя и экономию сейчас определить нельзя/u]
]) test(`actual Core ${kind} never becomes a named cheapest winner`, async () => {
  const result = await actualResult(options); assert.equal(result.conclusion.kind, kind);
  const message = currentComparisonExplanation({ result, context: context() }, { nowMs: START });
  assert.match(message, expected); assert.doesNotMatch(message, /Это более дешёвая|Экономия \d/u);
});

test('only a current comparison response is cleared when its owner invalidates; other conversation state is untouched', async () => {
  const result = await actualResult(); let chat;
  const own = owner(result, { onReceiptInvalidated: () => chat?.checkCurrentComparisonExplanation() });
  const basket = createBasketStore({ storage: null }); basket.mergeValidatedBasket([{ product: identity, quantity: 1 }]);
  chat = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG, preferenceStorage: null,
    priceHints: new Map(), loader: { load: async () => interpreter }, getCurrentComparison: () => own.read(basket.getSnapshot()) });
  await own.flow.run(surface); await chat.run('Почему этот магазин дешевле?');
  assert.match(chat.getState().presentation.message, /Экономия 10,00 ₽/u);
  own.setTime(START + HOUR + 1); own.flow.checkExpiry();
  assert.match(chat.getState().presentation.message, /нужен актуальный результат/u);
  assert.doesNotMatch(chat.getState().presentation.message, /139,99|149,99|10,00/u);
  await chat.run('Что ты помнишь?'); const before = structuredClone(chat.getState());
  own.flow.invalidate(); assert.deepEqual(chat.getState(), before);
});

test('a changed confirmed basket clears a current explanation through the existing owner invalidation seam', async () => {
  const result = await actualResult(); let chat;
  const own = owner(result, { onReceiptInvalidated: () => chat?.checkCurrentComparisonExplanation() });
  const basket = createBasketStore({ storage: null }); basket.mergeValidatedBasket([{ product: identity, quantity: 1 }]);
  basket.subscribe(() => own.flow.invalidate());
  chat = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG, preferenceStorage: null,
    priceHints: new Map(), loader: { load: async () => interpreter }, getCurrentComparison: () => own.read(basket.getSnapshot()) });
  await own.flow.run(surface); await chat.run('Почему этот магазин дешевле?');
  assert.match(chat.getState().presentation.message, /Экономия 10,00 ₽/u);
  basket.mergeValidatedBasket([{ product: identity, quantity: 1 }]);
  assert.equal(basket.getSnapshot()[0].quantity, 2);
  assert.match(chat.getState().presentation.message, /нужен актуальный результат/u);
  assert.doesNotMatch(chat.getState().presentation.message, /139,99|149,99|10,00/u);
});

test('saved METRO receipt expires on focus, never expands the GLOBUS-only local AI explanation contract', async () => {
  confirmBetaRetailIdentity();
  const milk = getReviewedRetailBasketIdentity('milk-25-900');
  const selected = createSelectedStoreScope({ metro: '10' });
  const url = 'https://online.metro-cc.ru/products/moloko-prostokvashino-pasterizovannoye-2-5-930ml';
  let reads = 0; let provider = 0; let now = START;
  const offers = await loadSelectedRetailCatalogOffers([{ product: milk, quantity: 1 }], selected, {
    nowMs: START, createCatalogClient: ({ store }) => ({ bySourceProductIds: async () => {
      reads++; return { kind: 'catalog', products: [{ retailerId: 'metro', sourceProductId: '241097', basketProductId: milk.id,
        name: 'Молоко Простоквашино пастеризованное 2.5%, 930мл', productUrl: url,
        unit: milk.unit, sourceUrl: url, observedAt: new Date(START - 12 * 60000).toISOString(),
        storeName: `METRO · ${store.address}`, priceMinor: 10600, currency: 'RUB', priceCondition: 'regular', availability: 'unknown',
        comparisonEvidence: { storeId: store.storeId, bindingId: store.bindingId, locationLabel: store.address,
          salesChannel: 'online', minimumQuantity: 1, scopeBinding: 'same-source', scopeEvidenceUrl: url, quantitySemantics: {} } }] };
    } }) });
  assert.equal(offers.length, 1);
  const metro = compareObservedBasket({ basket: [{ product: milk, quantity: 1 }], offers });
  const rows = [{ ...milk, quantity: 1 }]; let revoked = 0;
  const flow = createComparisonFlow(async () => metro, { getContext: () => ({ mode: 'observed', scope: selected }),
    now: () => now, schedule: () => 1, cancel: () => {}, onReceiptInvalidated: () => { revoked++; },
    getResultExpiresAt: result => observedComparisonExpiresAt(result, (id, line, candidate) =>
      metroCatalogLineMaxAgeMs(id, line, candidate, now) ?? 300000) });
  await flow.run(rows); const receipt = flow.getCurrentComparison(rows);
  assert.ok(receipt); assert.equal(receipt.expiresAt, START + 48 * 60000);
  assert.equal(currentComparisonExplanation(receipt, { nowMs: now }), null, 'this packet does not claim new METRO AI capability');
  const basket = createBasketStore({ storage: null }); basket.mergeValidatedBasket([{ product: milk, quantity: 1 }]);
  const chat = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG, preferenceStorage: null,
    priceHints: new Map(), loader: { load: async () => interpreter }, getCurrentComparison: () => flow.getCurrentComparison(rows),
    requestShoppingAdvice: async () => { provider++; throw Error('no paid/live requests'); },
    requestAiProposal: async () => { provider++; throw Error('no paid/live requests'); } });
  await chat.run('Хай'); assert.equal(provider, 0);
  const unchanged = structuredClone(chat.getState());
  now = START + 48 * 60000 + 1; flow.checkExpiry();
  assert.equal(flow.getCurrentComparison(rows), null); assert.equal(revoked, 1);
  assert.equal(chat.checkCurrentComparisonExplanation(), false);
  assert.deepEqual(chat.getState(), unchanged, 'expiry cannot fabricate an AI answer or overwrite an unrelated greeting');
  assert.equal(provider, 0); assert.equal(reads, 1);
});
