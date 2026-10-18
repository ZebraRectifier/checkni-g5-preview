import test from 'node:test';
import assert from 'node:assert/strict';
import { createShoppingConversationFlow } from '../src/runtime/shoppingConversationFlow.mjs';
import { createGuidedShoppingFlow } from '../src/runtime/guidedShoppingFlow.mjs';
import { createBasketStore } from '../src/state/basketStore.mjs';
import { SHOP_CATALOG } from '../src/data/shopCatalog.mjs';
import { createShoppingConversation, updateShoppingConversation, extractShoppingDelta } from '../src/intelligence/shoppingConversation.mjs';
import { quoteCatalogDraft } from '../src/core/catalogDraft.mjs';
import * as interpreter from '../src/runtime/hybridBasketInterpreter.mjs';
import { guidedGroupMatches } from '../src/intelligence/guidedShoppingPlan.mjs';
import { catalogPurchaseUnit } from '../src/core/catalogDraft.mjs';
const now = Date.now();
const advice = 'Для еды на три дня можно взять фарш, куриное филе, гречку и макароны, молоко и яйца. Добавь томаты и яблоки.';
const scope = { retailerId: 'globus', storeId: 'globus-store-5011', storeName: 'Глобус Красногорск' };
const fixtures = [
  ['фарш', 'Фарш Домашний', '500 г'], ['филе', 'Филе куриное', '600 г'], ['греч', 'Крупа гречневая', '900 г'],
  ['макарон', 'Макароны', '450 г'], ['молоко', 'Молоко питьевое', '1 л'], ['яйц', 'Яйца куриные', '10 шт'],
  ['томат', 'Томаты красные', 'Цена за 100 г'], ['яблок', 'Яблоки свежие', '1 кг'], ['банан', 'Бананы свежие', '1 кг']
];
const card = ([query, name, unit], overrides = {}) => ({ id: `retail:globus:globus-store-5011:${query}`, sourceProductId: query,
  retailerId: 'globus', name, unit, priceMinor: 15000, currency: 'RUB', availability: 'unknown',
  storeName: scope.storeName, sourceUrl: 'https://www.globus.ru/catalog/food', productUrl: `https://www.globus.ru/products/${query}`,
  observedAt: new Date(now - 60000).toISOString(), priceConditionLabel: 'Обычная цена без карты', ...overrides });
const search = async query => ({ kind: 'catalog', products: fixtures.filter(row => row[0] === query).map(row => card(row)) });

function setup(options = {}) {
  const basket = createBasketStore({ storage: null }); let calls = 0;
  const flow = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG, preferenceStorage: null,
    loader: { load: async () => interpreter }, priceHints: new Map(), requestAiProposal: async () => ({ kind: 'unavailable' }),
    requestShoppingAdvice: async () => { calls++; return { kind: 'advice', message: advice }; },
    resolveRetailSelectionScope: () => scope, searchGuidedCatalog: search,
    compareGuidedBasket: async () => ({ kind: 'observed-price-comparison', basket: [], candidates: [], conclusion: { kind: 'insufficient-coverage' } }), ...options });
  return { flow, basket, calls: () => calls };
}

test('the actual user dialogue progresses from advice to quantities, source prices, comparison and a confirmed basket', async () => {
  const { flow, basket, calls } = setup();
  await flow.run('хочу качественную еду на 3 дня');
  assert.equal(calls(), 1);
  assert.ok(flow.getState().presentation.conversationChoices.some(row => row.text === 'Собери корзину'));
  await flow.run('Ну собери'); assert.match(flow.getState().presentation.message, /На сколько человек/u);
  assert.equal(flow.getConversation().facts.shoppingDays.value, 3);
  await flow.run('на 3'); assert.match(flow.getState().presentation.message, /общий бюджет/u);
  await flow.run('5000'); assert.match(flow.getState().presentation.message, /исключить/u);
  await flow.run('Ограничений нет'); assert.match(flow.getState().presentation.message, /конкретные карточки/u);
  await flow.run('Подобрать товары и цены');
  let quote = flow.getState().presentation.guidedShopping.quote;
  assert.equal(quote.lines.length, 8); assert.equal(quote.complete, true); assert.equal(quote.allRecent, true);
  assert.equal(quote.lines.find(row => row.group.key === 'mince').quantity, 2);
  assert.equal(quote.lines.find(row => row.group.key === 'tomatoes').quantity, 9);
  assert.deepEqual(basket.getSnapshot(), []); assert.equal(calls(), 1);
  await flow.run('Количество 1: 3');
  quote = flow.getState().presentation.guidedShopping.quote;
  assert.equal(quote.lines[0].lineTotalMinor, 45000);
  await flow.run('Сравнить этот список');
  assert.equal(flow.getState().presentation.guidedShopping.comparison.conclusion.kind, 'insufficient-coverage');
  assert.deepEqual(basket.getSnapshot(), []);
  await flow.run('Добавить показанное');
  assert.equal(flow.getState().status, 'success'); assert.equal(basket.getSnapshot().length, 8);
  assert.equal(basket.getSnapshot()[0].quantity, 3); assert.equal(calls(), 1);
  const before = basket.getSnapshot(); await flow.run('Добавить показанное'); assert.deepEqual(basket.getSnapshot(), before);
});

test('editing the composer preserves the guided goal, while clearing the dialogue invalidates it', async () => {
  const { flow } = setup();
  await flow.run('Нужна еда на 3 дня'); await flow.run('Ну собери'); flow.edit();
  await flow.run('на 3'); assert.match(flow.getState().presentation.message, /общий бюджет/u);
  flow.invalidate(); await flow.run('на 3'); assert.equal(flow.getState().result.guidedShopping, undefined);
});

test('a fresh literal shopping request cannot confirm the old guided proposal', async () => {
  const { flow, basket } = setup();
  await flow.run('Нужна еда на 3 дня для троих'); await flow.run('Ну собери');
  await flow.run('Без лимита'); await flow.run('Ограничений нет'); await flow.run('Подобрать товары и цены');
  await flow.run('два молока');
  assert.notEqual(flow.getState().result?.guidedShopping, true);
  assert.deepEqual(basket.getSnapshot(), []);
});

test('a spoken household answer and a short no-restrictions answer continue the actual pending questions', async () => {
  const { flow } = setup(); await flow.run('Нужна еда на две недели'); await flow.run('Ну собери');
  await flow.run('на 3 да есть морозилка'); assert.match(flow.getState().presentation.message, /общий бюджет/u);
  await flow.run('15000'); await flow.run('нет'); assert.match(flow.getState().presentation.message, /конкретные карточки/u);
  assert.equal(flow.getConversation().facts.peopleCount.value, 3); assert.equal(flow.getConversation().facts.shoppingDays.value, 14);
});

test('a meat refusal excludes generic mince and chicken before catalogue requests', async () => {
  const requested = []; const { flow } = setup({ searchGuidedCatalog: async query => { requested.push(query); return search(query); } });
  await flow.run('Нужна еда на 3 дня для троих'); await flow.run('Собери корзину');
  await flow.run('Без лимита'); await flow.run('Без мяса'); await flow.run('Подобрать товары и цены');
  assert.ok(!requested.includes('фарш')); assert.ok(!requested.includes('филе'));
  assert.ok(flow.getState().presentation.guidedShopping.quote.lines.length > 0);
});

test('old, missing and ambiguous prices never become a current complete quote or a fabricated winner', () => {
  const rows = [
    { card: card(fixtures[0], { observedAt: new Date(now - 8 * 86400000).toISOString() }), product: { id: 'x', name: 'Фарш', unit: '500 г' }, quantity: 2 },
    { card: null, product: null, quantity: 1 },
    { card: card(fixtures[1], { unit: 'упаковка' }), product: { id: 'y', name: 'Филе', unit: 'упаковка' }, quantity: 1 }
  ];
  const quote = quoteCatalogDraft(rows, { nowMs: now });
  assert.equal(quote.lines[0].freshness, 'dated'); assert.equal(quote.knownSubtotalMinor, 30000);
  assert.equal(quote.complete, false); assert.equal(quote.allRecent, false); assert.equal(quote.winner, null);
  assert.equal(quote.basket.length, 1); assert.equal(quote.lines[1].lineTotalMinor, null); assert.equal(quote.lines[2].addable, false);
});

function controller(overrides = {}) {
  const basket = createBasketStore({ storage: null });
  let memory = updateShoppingConversation(createShoppingConversation(), { ...extractShoppingDelta(''), facts: { peopleCount: { value: 3, scope: 'goal' }, shoppingDays: { value: 3, scope: 'goal' } } }).state;
  const flow = createGuidedShoppingFlow({ basket, getMemory: () => memory, updateMemory: delta => { memory = updateShoppingConversation(memory, delta).state; return true; },
    getContext: () => scope, searchCatalog: search, now: () => now, ...overrides });
  flow.start('еда на три дня', [{ role: 'assistant', text: 'Фарш, молоко, яблоки.' }]);
  return { flow, basket };
}
const ready = async flow => { await flow.handle('Без лимита'); await flow.handle('Ограничений нет'); return flow.handle('Подобрать товары и цены'); };

test('catalogue cards from a different store, wrong family, unsafe source or future time stay unresolved', async () => {
  const { flow, basket } = controller({ searchCatalog: async query => ({ kind: 'catalog', products: [
    card(fixtures[0], { id: 'retail:globus:globus-store-5014:фарш' }), card(fixtures[0], { name: 'Пирог с фаршем' }),
    card(fixtures[0], { sourceUrl: 'https://evil.example/food' }), card(fixtures[0], { observedAt: new Date(now + 1000).toISOString() })
  ] }) });
  const state = await ready(flow); assert.ok(state.presentation.guidedShopping.quote.lines.every(row => !row.card));
  flow.confirm(); assert.deepEqual(basket.getSnapshot(), []);
});

test('a changed basket requires a new visible confirmation and never silently overwrites manual items', async () => {
  const { flow, basket } = controller(); await ready(flow);
  basket.add({ id: 'manual', name: 'Ручной товар', unit: '1 шт' });
  const state = flow.confirm(); assert.match(state.presentation.message, /корзина изменилась/u);
  assert.equal(basket.getSnapshot().length, 1);
  flow.confirm(); assert.equal(basket.getSnapshot().length, 4);
});

test('a changed address invalidates the quote before confirmation', async () => {
  let currentScope = scope; const { flow, basket } = controller({ getContext: () => currentScope });
  await ready(flow); currentScope = { ...scope, storeId: 'globus-store-5014' };
  const state = flow.confirm(); assert.match(state.presentation.message, /нового адреса/u); assert.deepEqual(basket.getSnapshot(), []);
});

test('after leaving the table, an old add command must show the proposal again before applying', async () => {
  const { flow, basket } = controller(); await ready(flow);
  assert.equal(await flow.handle('А как выбрать фарш?'), null);
  const state = flow.confirm(); assert.match(state.presentation.message, /Проверь показанные/u); assert.deepEqual(basket.getSnapshot(), []);
  flow.confirm(); assert.equal(basket.getSnapshot().length, 3);
});

test('a dietary restriction after a quote invalidates the old meat rows before any confirmation', async () => {
  const { flow, basket } = controller(); await ready(flow);
  await flow.handle('без мяса'); flow.confirm();
  assert.deepEqual(basket.getSnapshot(), []);
  const state = await flow.handle('Подобрать товары и цены');
  assert.ok(state.presentation.guidedShopping.quote.lines.every(row => row.group.key !== 'mince'));
});

test('explicit per-piece catalogue evidence permits one identified pack without guessing its mass', () => {
  const quote = quoteCatalogDraft([{ card: card(fixtures[0], { unit: 'упаковка', catalogPurchaseBasis: 'piece' }),
    product: { id: 'exact-source-sku', name: 'Фарш', unit: 'упаковка' }, quantity: 1 }], { nowMs: now });
  assert.equal(quote.basket.length, 1); assert.equal(quote.lines[0].unit.dimension, 'package');
  assert.match(quote.lines[0].unit.label, /не уточнены/u);
});

test('live catalogue regressions reject ingredient matches and similar adjectives', () => {
  for (const [key, wrong, right] of [
    ['eggs', 'Майонез Mr. Ricco на перепелином яйце Organic 67%, 400мл', 'Яйца куриные С1, 30шт'],
    ['buckwheat', 'Йогурт греческий Teos 2%, 250г', 'Крупа гречневая Агро-Альянс Экстра Элитная, 900г'],
    ['apples', 'Каша ржаная Yelli яблоко-корица, 60г', 'Яблоки Медовый хруст, вес'],
    ['tomatoes', 'Ассорти маринованное из корнишонов и томатов черри', 'Томаты розовые, 700г'],
    ['tomatoes', 'Томаты очищенные Casa Rinaldi в собственном соку, 400г', 'Томаты Бычье сердце, вес'],
    ['mince', 'Пирог с фаршем', 'Фарш Любимый Глобус уп, 600-800г'],
    ['milk', 'Молоко детское Тёма 3 ступень 3,2%, 200мл', 'Молоко Parmalat 3,5%, 1л']
  ]) {
    assert.equal(guidedGroupMatches({ key }, { name: wrong }), false, wrong);
    assert.equal(guidedGroupMatches({ key }, { name: right }), true, right);
  }
});

test('the exact source title gives fixed pack size only with a proven per-pack price basis', () => {
  assert.deepEqual(catalogPurchaseUnit({ unit: 'упаковка', name: 'Молоко Село Зелёное 3,2%, 950мл', catalogPurchaseBasis: 'piece' }), { label: '950 мл', amount: 950, dimension: 'ml' });
  assert.equal(catalogPurchaseUnit({ unit: 'упаковка', name: 'Молоко 3,2%, 0,9л', catalogPurchaseBasis: 'piece' }).amount, 900);
  assert.equal(catalogPurchaseUnit({ unit: 'упаковка', name: 'Молоко 950мл' }), null);
  assert.equal(catalogPurchaseUnit({ unit: 'упаковка', name: 'Фарш, 600-800г', catalogPurchaseBasis: 'piece' }).dimension, 'package');
});

test('an explicit build goal starts intake directly without spending an AI request', async () => {
  const { flow, calls } = setup(); await flow.run('Собери качественную еду на 3 дня');
  assert.match(flow.getState().presentation.message, /На сколько человек/u); assert.equal(calls(), 0);
  await flow.run('на 3'); assert.match(flow.getState().presentation.message, /общий бюджет/u);
});

test('a superseded catalogue request cannot restore an old quote or mutate the basket', async () => {
  let resolve; const wait = new Promise(done => { resolve = done; }); let current = true;
  const { flow, basket } = controller({ searchCatalog: () => wait });
  await flow.handle('Без лимита'); await flow.handle('Ограничений нет');
  const loading = flow.handle('Подобрать товары и цены', () => current);
  current = false; flow.start('Новый список', []); resolve({ kind: 'catalog', products: [card(fixtures[0])] }); await loading;
  assert.equal(flow.getState().presentation.guidedShopping, undefined); assert.deepEqual(basket.getSnapshot(), []);
});
