import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewedCrossSourceCounterpart} from '../src/catalog/reviewedCrossSourcePairs.mjs';
import {sourceScopedRetailListSelection} from '../src/catalog/sourceScopedRetailList.mjs';
import {prepareManualCatalogComparison} from '../src/runtime/manualCatalogComparison.mjs';
import {loadSavedGuidedComparison} from '../src/runtime/savedGuidedComparison.mjs';
import {PEREKRESTOK_REVIEWED_LIST_CONTEXT as PEREK} from '../src/catalog/perekrestokReviewedList.mjs';

const pairs = [
  ['1899800733', '09fe3ce5-77db-4edd-ab53-18beabd501ba'],
  ['1000151468', '3efc55a2-9305-410b-97ea-0620d9fadd71'],
  ['1000461809', '246ec37a-906a-4dc2-a03e-907953cf0e2a']
];

const perekRows = [
  [pairs[0][1], 'Молоко пастеризованное Простоквашино 2.5% 930 мл', '930 мл'],
  [pairs[1][1], 'Молоко пастеризованное Простоквашино 1.5% 930 мл', '930 мл'],
  [pairs[2][1], 'Сметана Брест-Литовск 20% 300 г', '300 г']
];
const magnitRows = [
  [pairs[0][0], 'Молоко Простоквашино пастеризованное 2.5% 930мл', '930 мл', 9499,
    '1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml', '2026-11-08T09:36:47.440Z'],
  [pairs[1][0], 'Молоко Простоквашино пастеризованное 1.5% 930мл', '930 мл', 9299,
    '1000151468-prostokvashino_moloko_past_1_5_930ml_pl_but_yunimilk_6', '2026-11-08T09:39:11.292Z'],
  [pairs[2][0], 'Сметана Брест-Литовск 20% 300г', '300 г', 9999,
    '1000461809-brest_litovsk_smetana_20_300g_pl_st', '2026-11-08T09:40:57.624Z']
];

const perekCard = ([sourceProductId, name, unit]) => ({
  id: `retail:perekrestok:${PEREK.storeId}:${sourceProductId}`,
  retailerId: 'perekrestok', storeId: PEREK.storeId, storeName: PEREK.storeName,
  sourceProductId, name, unit, priceMinor: 10000, currency: 'RUB', availability: 'unknown',
  observedAt: '2026-11-08T10:05:01.988Z', productUrl: PEREK.sourceUrl, sourceUrl: PEREK.sourceUrl,
  scopeEvidenceUrl: PEREK.sourceUrl, scopeBinding: 'same-source', bindingId: PEREK.bindingId,
  salesChannel: PEREK.salesChannel, priceCondition: 'yandex-eda-regular'
});
const magnitCard = ([sourceProductId, name, unit, priceMinor, slug, observedAt]) => ({
  id: `retail:magnit:magnit-509926:${sourceProductId}`,
  retailerId: 'magnit', storeId: 'magnit-509926', sourceProductId, name, unit, priceMinor,
  currency: 'RUB', availability: 'unknown', observedAt,
  productUrl: `https://magnit.ru/product/${slug}?shopCode=509926&shopType=1`,
  sourceUrl: `https://magnit.ru/product/${slug}?shopCode=509926&shopType=1`,
  priceCondition: 'public-online'
});

test('three reviewed packs map only by exact source identity in both directions', () => {
  for (const [magnit, perekrestok] of pairs) {
    assert.equal(reviewedCrossSourceCounterpart({retailerId: 'magnit', sourceProductId: magnit}, 'perekrestok'), perekrestok);
    assert.equal(reviewedCrossSourceCounterpart({retailerId: 'perekrestok', sourceProductId: perekrestok}, 'magnit'), magnit);
  }
  assert.equal(reviewedCrossSourceCounterpart({retailerId: 'magnit', sourceProductId: '1000461809-changed'}, 'perekrestok'), null);
  assert.equal(reviewedCrossSourceCounterpart({retailerId: 'perekrestok', sourceProductId: pairs[0][1]}, 'perekrestok'), null);
});

test('all three fresh exact counterparts are chosen ahead of generic cheaper alternatives', async () => {
  const perekCards = perekRows.map(perekCard);
  const magnitCards = magnitRows.map(magnitCard);
  const basket = perekCards.map(card => ({...sourceScopedRetailListSelection(card).product, quantity: 1}));
  const request = prepareManualCatalogComparison(basket, {magnitStoreId: 'magnit-509926'}).request;
  const generic = {...magnitCards[0], id: 'retail:magnit:magnit-509926:generic-milk',
    sourceProductId: 'generic-milk', name: 'Молоко дешёвое 2.5% 930мл', priceMinor: 100};
  const result = await loadSavedGuidedComparison(request, basket, {now: () => Date.parse('2026-11-08T10:20:00Z'), catalog: {
    bySourceProductIds: async (ids, {scope}) => ({kind: 'catalog', products:
      (scope.retailerId === 'magnit' ? magnitCards : perekCards).filter(card => ids.includes(card.sourceProductId))}),
    search: async (_query, {scope}) => ({kind: 'catalog', products: scope.retailerId === 'magnit' ? [generic] : []})
  }});
  assert.equal(result.kind, 'catalog_comparison');
  assert.deepEqual(result.drafts[0].rows.map(row => row.card.sourceProductId), magnitRows.map(row => row[0]));
  assert.deepEqual(result.drafts[1].rows.map(row => row.card.sourceProductId), perekRows.map(row => row[0]));
  assert.deepEqual(result.drafts.flatMap(draft => draft.rows).map(row => row.quantity), [1, 1, 1, 1, 1, 1]);
  assert.equal(result.comparison.kind, 'fresh');
});

test('reviewed Perekrestok packs retain exact amount, delivery scope and manual comparison intent', () => {
  for (const row of perekRows) {
    const selected = sourceScopedRetailListSelection(perekCard(row));
    assert.ok(selected);
    assert.equal(selected.product.unit, row[2]);
    const prepared = prepareManualCatalogComparison([{...selected.product, quantity: 2}], {magnitStoreId: 'magnit-509926'});
    assert.equal(prepared.kind, 'ready');
    assert.equal(prepared.request.bindings[0].sourceProductId, row[0]);
    assert.equal(prepared.request.bindings[0].retailerId, 'perekrestok');
    assert.equal(prepared.request.scopes[0].storeId, 'magnit-509926');
    assert.equal(sourceScopedRetailListSelection({...perekCard(row), name: row[1] + ' другой'}), null);
    assert.equal(sourceScopedRetailListSelection({...perekCard(row), unit: row[2] === '300 г' ? '330 г' : '900 мл'}), null);
  }
});
