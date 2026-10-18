import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOPPING_LANDMARKS, shoppingLocationRequest, nearbyShoppingStores } from '../src/data/shoppingLocations.mjs';
import { createGuidedShoppingPlan, guidedGroupMatches } from '../src/intelligence/guidedShoppingPlan.mjs';
import { createShoppingConversationFlow } from '../src/runtime/shoppingConversationFlow.mjs';
import { createBasketStore } from '../src/state/basketStore.mjs';
import { SHOP_CATALOG } from '../src/data/shopCatalog.mjs';
import { economicalCatalogCards, rankCatalogDrafts } from '../src/core/catalogDraft.mjs';
import { createShoppingConversation } from '../src/intelligence/shoppingConversation.mjs';
import * as interpreter from '../src/runtime/hybridBasketInterpreter.mjs';

const goods = { mince: ['Фарш домашний', '500 г'], chicken: ['Филе куриное', '500 г'], buckwheat: ['Крупа гречневая', '800 г'],
  pasta: ['Макароны', '450 г'], potatoes: ['Картофель свежий', '1 кг'], carrots: ['Морковь мытая', '1 кг'],
  onions: ['Лук репчатый', '1 кг'], cabbage: ['Капуста белокочанная', '1 кг'], milk: ['Молоко питьевое', '1 л'],
  eggs: ['Яйца куриные', '10 шт'], apples: ['Яблоки свежие', '1 кг'], bananas: ['Бананы', '1 кг'],
  oats: ['Хлопья овсяные', '400 г'], flakes: ['Хлопья гречневые', '550 г'], oil: ['Масло подсолнечное', '1 л'] };
const plan = createGuidedShoppingPlan('Собери недорогую корзину', [], createShoppingConversation());
const contexts = nearbyShoppingStores(shoppingLocationRequest('Заветы Ильича · до 20 км')).map(store => ({
  retailerId: 'globus', storeId: `globus-store-${store.officialStoreId}`, storeName: store.name,
  storeAddress: store.address, officialStoreId: store.officialStoreId, distanceKm: store.distanceKm
}));
const card = (group, scope, extra = {}) => ({ id: `retail:globus:${scope.storeId}:${group.key}`, retailerId: 'globus',
  sourceProductId: group.key, name: goods[group.key][0], unit: goods[group.key][1], priceMinor: 10000,
  currency: 'RUB', availability: 'unknown', observedAt: '2026-10-12T08:30:00Z',
  sourceUrl: 'https://www.globus.ru/catalog/food', productUrl: `https://www.globus.ru/products/${group.key}`, ...extra });
function setup(extra = {}) {
  const basket = createBasketStore({ storage: null }); const requests = []; let current = contexts[0], paid = 0;
  const flow = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG, preferenceStorage: null,
    loader: { load: async () => interpreter }, priceHints: new Map(),
    requestShoppingAdvice: async () => { paid++; return { kind: 'unavailable' }; }, requestAiProposal: async () => { paid++; return { kind: 'unavailable' }; },
    resolveRetailSelectionScope: () => current, getGuidedNearbyContexts: () => contexts,
    selectGuidedStore: scope => { current = scope; return true; },
    searchGuidedCatalog: async (query, options) => {
      requests.push({ query, storeId: options.scope.storeId });
      const group = plan.groups.find(row => row.query === query);
      return { kind: 'catalog', products: group ? [card(group, options.scope)] : [] };
    }, ...extra });
  return { flow, basket, requests, paid: () => paid, scope: () => current };
}

test('landmark resolves only supported identity, radius and exact registered nearby stores', () => {
  assert.equal(SHOPPING_LANDMARKS.length, 1);
  assert.deepEqual(contexts.map(row => row.officialStoreId), ['5014', '5010', '5001']);
  assert.ok(contexts.every(row => row.distanceKm > 0 && row.distanceKm <= 20));
  assert.deepEqual(nearbyShoppingStores(shoppingLocationRequest('Заветы Ильича до 1 км')), []);
  assert.deepEqual(nearbyShoppingStores(shoppingLocationRequest('Заветы Ильича до 50 км')), []);
  assert.deepEqual(nearbyShoppingStores(shoppingLocationRequest('не Заветы Ильича до 20 км')), []);
  assert.deepEqual(nearbyShoppingStores({ landmark: { ...SHOPPING_LANDMARKS[0] }, radiusKm: 20 }), []);
});

test('greeting → cheap mode → three people → week → station → exclusions automatically loads sources, then confirms', async () => {
  const { flow, basket, requests, paid } = setup();
  await flow.run('hi'); assert.equal(flow.getState().presentation.conversationChoices.length, 3);
  await flow.run('Собери недорогую корзину'); assert.match(flow.getState().presentation.message, /На сколько человек/u);
  await flow.run('на 3 да есть морозилка'); assert.match(flow.getState().presentation.message, /На сколько дней/u);
  await flow.run('На неделю'); assert.match(flow.getState().presentation.message, /Где закупаемся/u);
  await flow.run('Заветы Ильича · до 20 км'); assert.match(flow.getState().presentation.message, /Какие продукты исключить/u);
  assert.match(flow.getState().presentation.message, /морозилка есть/u);
  await flow.run('Ограничений нет');
  const result = flow.getState().presentation.guidedShopping;
  assert.equal(result.people, 3); assert.equal(result.days, 7); assert.equal(result.quote.complete, true);
  assert.equal(result.quote.lines.length, 13); assert.equal(result.alternatives.length, 3);
  assert.equal(requests.length, 39); assert.equal(paid(), 0); assert.deepEqual(basket.getSnapshot(), []);
  assert.equal(flow.getConversation().facts.budgetMinor, undefined);
  assert.equal(result.quote.winner, null); assert.equal(result.quote.allRecent, false);
  await flow.run('Добавить показанное'); assert.equal(flow.getState().status, 'success');
  assert.equal(basket.getSnapshot().length, 13); const before = basket.getSnapshot();
  await flow.run('Добавить показанное'); assert.deepEqual(basket.getSnapshot(), before);
});

test('the complete natural example skips known intake facts and does not invent a budget', async () => {
  const { flow, paid } = setup();
  await flow.run('Собери недорогую корзину на неделю для троих. Заветы Ильича, до 20 км. Есть морозилка');
  assert.match(flow.getState().presentation.message, /Какие продукты исключить/u);
  await flow.run('Без мяса');
  assert.ok(flow.getState().presentation.guidedShopping.quote.lines.every(row => !['mince', 'chicken'].includes(row.group.key)));
  assert.equal(paid(), 0);
});

test('partial nearby catalogues never claim a complete cheap basket or turn missing data into zero', async () => {
  const { flow, basket } = setup({ searchGuidedCatalog: async () => ({ kind: 'unavailable' }) });
  await flow.run('Недорогая корзина на неделю для троих. Заветы Ильича до 20 км'); await flow.run('Ограничений нет');
  const model = flow.getState().presentation.guidedShopping;
  assert.equal(model.quote.complete, false); assert.equal(model.quote.knownSubtotalMinor, null);
  assert.ok(model.alternatives.every(row => row.found === 0 && row.knownSubtotalMinor === null));
  await flow.run('Добавить найденное'); assert.deepEqual(basket.getSnapshot(), []);
});

test('economical product choice compares cost of required quantity, preserving pack size and avoiding unknown units', () => {
  const group = plan.groups.find(row => row.key === 'milk');
  const cards = [card(group, contexts[0], { unit: '1 л', priceMinor: 9000 }),
    card(group, contexts[0], { sourceProductId: 'small', unit: '200 мл', priceMinor: 5000 }),
    card(group, contexts[0], { sourceProductId: 'mystery', unit: 'упаковка', priceMinor: 100 })];
  const ranked = economicalCatalogCards(group, cards, 3, 7);
  assert.equal(ranked[0].priceMinor, 9000); assert.equal(ranked.length, 2);
});

test('a complete store precedes an inexpensive fragment, and a missing cost cannot win on zero', () => {
  const group = plan.groups[0], product = { id: 'x', name: 'Фарш', unit: '500 г' };
  const rows = [{ group, card: card(group, contexts[0]), product, quantity: 5 }];
  const ranked = rankCatalogDrafts([{ rows: [{ group, card: null, product: null, quantity: 1 }] }, { rows }]);
  assert.equal(ranked[0].quote.complete, true); assert.equal(ranked[1].quote.knownSubtotalMinor, null);
});

test('fresh evidence takes priority over a lower old price for both products and full store drafts', () => {
  const group = plan.groups.find(row => row.key === 'milk'), product = { id: 'milk', name: 'Молоко', unit: '1 л' };
  const recent = card(group, contexts[0], { observedAt: new Date(Date.now() - 1000).toISOString(), priceMinor: 12000 });
  const old = card(group, contexts[0], { priceMinor: 1000 });
  assert.equal(economicalCatalogCards(group, [old, recent], 3, 7)[0], recent);
  const ranked = rankCatalogDrafts([{ rows: [{ group, product, card: old, quantity: 5 }] },
    { rows: [{ group, product, card: recent, quantity: 5 }] }]);
  assert.equal(ranked[0].quote.allRecent, true); assert.equal(ranked[0].quote.knownSubtotalMinor, 60000);
});

test('fresh-food families reject chips, pickles and sweet cereal while accepting the intended groceries', () => {
  for (const [key, name] of [['potatoes', 'Картофель фри'], ['carrots', 'Морковь маринованная'],
    ['cabbage', 'Капуста квашеная'], ['oats', 'Хлопья овсяные с сахаром'], ['chicken', 'Филе куриное запечённое с помидорами 200-220г']]) assert.equal(guidedGroupMatches({ key }, { name }), false);
  assert.equal(guidedGroupMatches({key:'bananas'}, {name:'Банан 1 штука 120-280г'}),true);
  assert.equal(guidedGroupMatches({key:'chicken'}, {name:'Филе бедра цыплёнка-бройлера охлаждённое Рококо, 750г'}),true);
  for (const [key, [name]] of Object.entries(goods)) assert.equal(guidedGroupMatches({ key }, { name }), true, key);
});
