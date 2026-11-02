import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedCatalogQuantityForIntent, compareCatalogDraftAlternatives } from '../src/core/catalogDraft.mjs';

const nowMs = Date.parse('2026-11-02T00:00:00Z');
const intent = { dimension: 'g', amount: 7200 };
const card = (unit, priceMinor = 10000) => ({ unit, priceMinor, currency: 'RUB',
  observedAt: new Date(nowMs).toISOString(), catalogPurchaseBasis: 'piece', name: 'Крупа' });
const row = (unit, quantity, priceMinor) => ({ group: { key: 'rice', dimension: 'g', dailyAmount: 50 },
  quantityIntent: intent, quantity, card: card(unit, priceMinor), product: { id: unit, name: 'Крупа', unit } });
const drafts = (a = row('800 г', 9), b = row('900 г', 8, 11000)) => [
  { scope: { storeId: 'a', storeName: 'A' }, rows: [a] },
  { scope: { storeId: 'b', storeName: 'B' }, rows: [b] }
];

test('manual amount is converted across exact pack sizes, including whole-pack excess', () => {
  assert.deepEqual(suggestedCatalogQuantityForIntent(card('900 г'), intent), { quantity: 8, quantityReview: false });
  assert.deepEqual(suggestedCatalogQuantityForIntent(card('1 кг'), intent), { quantity: 8, quantityReview: false });
  assert.deepEqual(suggestedCatalogQuantityForIntent(card('0.5 л'), { dimension: 'ml', amount: 1500 }), { quantity: 3, quantityReview: false });
  assert.deepEqual(suggestedCatalogQuantityForIntent(card('10 шт.'), { dimension: 'piece', amount: 30 }), { quantity: 3, quantityReview: false });
});

test('unknown, approximate, wrong-dimension and unbounded quantities require review', () => {
  for (const [product, need] of [
    [card('упаковка'), intent], [card('800 г'), { dimension: 'ml', amount: 7200 }],
    [{ ...card('800 г'), catalogPurchaseBasis: 'weighed-portion' }, intent],
    [card('800 г'), { dimension: 'g', amount: 80000 }], [card('800 г'), { dimension: 'g', amount: Infinity }],
    [card('800 г'), { dimension: 'g', amount: -1 }], [card('800 г'), { dimension: 'package', amount: 1 }],
    [null, intent], [card('800 г'), null]
  ]) assert.deepEqual(suggestedCatalogQuantityForIntent(product, need), { quantity: null, quantityReview: true });
});

test('decimal pack sizes do not add a phantom package from floating-point multiplication', () => {
  const need = { dimension: 'g', amount: 100.4 * 3 };
  assert.deepEqual(suggestedCatalogQuantityForIntent(card('100.4 г'), need), { quantity: 3, quantityReview: false });
  assert.deepEqual(suggestedCatalogQuantityForIntent(card('100.4 г'), { ...need, amount: 301.21 }), { quantity: 4, quantityReview: false });
  assert.deepEqual(suggestedCatalogQuantityForIntent(card('100 г'), { ...need, amount: 9900.00000001 }), { quantity: null, quantityReview: true });
  assert.deepEqual(suggestedCatalogQuantityForIntent(card('1 г'), { ...need, amount: 1e-20 }), { quantity: 1, quantityReview: false });
  const a = { ...row('100.4 г', 3), quantityIntent: need };
  assert.equal(compareCatalogDraftAlternatives(drafts(a, a), { nowMs }).kind, 'fresh');
});

test('Core compares the same manually requested amount with different real pack sizes', () => {
  const result = compareCatalogDraftAlternatives(drafts(), { nowMs });
  assert.equal(result.kind, 'fresh');
  assert.equal(result.lowerStoreId, 'b');
  assert.equal(result.differenceMinor, 2000);
  assert.equal(result.sameProducts, false);
  assert.equal(result.includesFees, false);
  assert.equal(compareCatalogDraftAlternatives(drafts(row('800 г', 9), row('1 кг', 8)), { nowMs }).kind, 'fresh');
});

test('reset quantities, mismatched intent, unknown packs and pending review cannot create savings', () => {
  for (const other of [row('900 г', 2), row('900 г', 9),
    { ...row('900 г', 8), quantityIntent: undefined },
    { ...row('900 г', 8), quantityIntent: { dimension: 'g', amount: 1600 } },
    { ...row('900 г', 8), quantityReview: true }, row('упаковка', 8)]) {
    assert.equal(compareCatalogDraftAlternatives(drafts(row('800 г', 9), other), { nowMs }).kind, 'incompatible');
  }
});

test('quantity conversion never makes old observations fresh or mutates draft prices', () => {
  const input = drafts();
  const before = structuredClone(input);
  assert.equal(compareCatalogDraftAlternatives(input, { nowMs: nowMs + 3600001 }).kind, 'needs_refresh');
  assert.deepEqual(input, before);
});
