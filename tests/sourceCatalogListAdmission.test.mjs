import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeRetailRow, createRetailCatalogClient} from '../src/ports/retailCatalogPort.mjs';
import {sourceCatalogListSelection, SOURCE_CATALOG_LIST_MAX_AGE_MS} from '../src/catalog/sourceCatalogListAdmission.mjs';
import {getReviewedRetailBasketProduct, getReviewedRetailBasketIdentity,
  getReviewedRetailSourceProductIds, matchesReviewedRetailBasketIdentity} from '../src/catalog/reviewedRetailBasket.mjs';
import {resolveMetroMoscowRegionStore} from '../src/data/metroMoscowRegionStores.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {rememberBasketPresentation, basketPresentation} from '../src/state/basketPresentationStore.mjs';
import {prepareManualCatalogComparison} from '../src/runtime/manualCatalogComparison.mjs';

const {rows} = JSON.parse(await readFile(new URL('./fixtures/source-catalog-list-20261107.json', import.meta.url)));
const nowMs = Date.parse('2026-11-07T07:00:00Z');
const rowFor = id => structuredClone(rows.find(row => row.retailer_id === id));
const definitionFor = row => row.retailer_id === 'metro'
  ? {retailerId: 'metro', store: resolveMetroMoscowRegionStore('10')} : row.retailer_id;
const normalize = (row, options = {}) => normalizeRetailRow(row, definitionFor(row), {nowMs, ...options});

test('live source rows become independently scoped list entries with exact source sizes', () => {
  for (const raw of rows) {
    const card = normalize(raw);
    const selected = getReviewedRetailBasketProduct(card, {nowMs});
    assert.ok(selected, raw.retailer_id);
    assert.equal(card.basketProductId, card.id);
    assert.equal(selected.id, `retail:${raw.retailer_id}:${raw.store_id}:${raw.source_product_id}`);
    assert.equal(selected.name, raw.name);
    assert.equal(selected.unit, raw.weight_text ?? '170 г');
    assert.equal(card.priceMinor, raw.price_minor);
    assert.equal(card.sourceUrl, raw.source_url);
    assert.equal(Date.parse(card.observedAt), Date.parse(raw.observed_at));
    assert.equal(card.availability, 'unknown');
    assert.equal(card.catalogDisplayOnly, true);
    assert.equal(card.sourceListOnly, true);
    assert.ok(Object.isFrozen(card));
    assert.deepEqual(Object.keys(selected).sort(), ['category', 'id', 'name', 'unit']);
  }
});

test('stored list and source display survive reload without becoming commercial evidence', () => {
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
  const basket = createBasketStore({storage});
  for (const raw of rows) {
    const card = normalize(raw), product = getReviewedRetailBasketProduct(card, {nowMs});
    basket.mergeValidatedBasket([{product, quantity: 2}]);
    assert.equal(rememberBasketPresentation(product, card, storage), true);
  }
  const snapshot = basket.getSnapshot();
  assert.equal(snapshot.length, 3);
  const restored = createBasketStore({storage}).getSnapshot();
  assert.deepEqual(restored, snapshot);
  for (const item of restored) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'name', 'quantity', 'unit']);
    assert.equal(getReviewedRetailBasketProduct(item, {nowMs}), null);
    assert.equal(getReviewedRetailBasketIdentity(item.id), null);
    assert.equal(matchesReviewedRetailBasketIdentity(item), false);
    for (const retailer of ['metro', 'vkusvill', 'perekrestok', 'magnit']) {
      assert.deepEqual(getReviewedRetailSourceProductIds(retailer, [item]), []);
    }
    const display = basketPresentation(item, storage);
    assert.ok(display.sourceUrl);
    assert.equal(display.storeId, item.id.split(':')[2]);
    assert.ok(display.observedAt);
  }
  const compared = prepareManualCatalogComparison(restored, {pinnedMagnitStoreId: 'magnit-777885'});
  assert.equal(compared.kind, 'needs_review');
  assert.equal(compared.reason, 'unmatched_items');
  assert.equal(compared.issues.length, 3);
  assert.equal(prepareManualCatalogComparison(restored), null);
});

test('an ID, JSON copy or forged local snapshot cannot grant runtime admission', () => {
  const card = normalize(rowFor('vkusvill'));
  assert.ok(sourceCatalogListSelection(card, {nowMs}));
  for (const forged of [card.id, {id: card.id}, {...card}, JSON.parse(JSON.stringify(card)),
    {...card, name: 'Другой товар'}, {...card, unit: '5 кг'}, {...card, sourceProductId: 'other'}]) {
    assert.equal(sourceCatalogListSelection(forged, {nowMs}), null);
    assert.equal(getReviewedRetailBasketProduct(forged, {nowMs}), null);
  }
});

test('the same source SKU at different verified METRO scopes stays two separate saved lines', () => {
  const first = normalize(rowFor('metro'));
  const store = resolveMetroMoscowRegionStore('11');
  const secondRaw = {...rowFor('metro'), store_id: store.storeId, binding_id: store.bindingId,
    store_name: 'METRO · ' + store.address, location_label: store.address};
  const second = normalizeRetailRow(secondRaw, {retailerId: 'metro', store}, {nowMs});
  const basket = createBasketStore({storage: null});
  for (const card of [first, second]) {
    const product = getReviewedRetailBasketProduct(card, {nowMs});
    assert.ok(product);
    basket.mergeValidatedBasket([{product, quantity: 1}]);
  }
  const saved = basket.getSnapshot();
  assert.equal(saved.length, 2);
  assert.notEqual(saved[0].id, saved[1].id);
  assert.equal(saved[0].name, saved[1].name);
  assert.equal(saved[0].unit, saved[1].unit);
});

test('future and expired observations cannot be admitted; an open card expires without losing the saved list', () => {
  for (const raw of rows) {
    const observed = Date.parse(raw.observed_at);
    const current = normalize(raw, {nowMs: observed});
    assert.ok(sourceCatalogListSelection(current, {nowMs: observed + SOURCE_CATALOG_LIST_MAX_AGE_MS - 1}));
    assert.equal(sourceCatalogListSelection(current, {nowMs: observed + SOURCE_CATALOG_LIST_MAX_AGE_MS}), null);
    assert.equal(getReviewedRetailBasketProduct(current, {nowMs: observed - 1}), null);
    for (const time of [observed - 1, observed + SOURCE_CATALOG_LIST_MAX_AGE_MS]) {
      const card = normalize(raw, {nowMs: time});
      assert.equal(card.basketProductId, undefined);
    }
  }
});

test('missing, contradictory, approximate and ambiguous sizes stay view-only', () => {
  const variants = [
    {weight_text: ''}, {weight_text: 'упаковка'}, {weight_text: '0 г'}, {weight_text: '400 г'},
    {weight_text: 'примерно 350 г'}, {weight_text: '300–350 г'}, {weight_text: '2 х 350 г'},
    {name: 'Весовой товар 350 г'}, {name: 'Товар около 350 г'}, {name: 'Товар 2×350 г'},
    {name: 'Товар 250 г / 350 г'},
    {quantity_semantics: {packageType: 'weighed', unitPriceText: '1 кг'}},
    {quantity_semantics: {kind: 'weight-basis', basis_grams: 100}},
    {quantity_semantics: []}
  ];
  for (const patch of variants) {
    assert.equal(normalize({...rowFor('vkusvill'), ...patch})?.basketProductId, undefined, JSON.stringify(patch));
  }
  for (const name of ['Тунец', 'Тунец 2х170г', 'Тунец 2 х 170г', 'Тунец 150-170 г',
    'Тунец весовой 170г', 'Тунец ~170г', 'Тунец 170г / 100г', 'Тунец 0г']) {
    assert.equal(normalize({...rowFor('metro'), name})?.basketProductId, undefined, name);
  }
});

test('catalogue scope, URL, source condition and quantity changes fail closed', () => {
  for (const retailer of ['vkusvill', 'perekrestok', 'metro']) {
    const raw = rowFor(retailer);
    for (const patch of [{store_id: 'other'}, {binding_id: 'other'}, {scope_binding: 'other'},
      {sales_channel: 'store'}, {minimum_quantity: 2}, {source_product_id: 'bad:id'},
      {product_url: raw.product_url + '#other'}, {source_url: 'https://example.org/'},
      {scope_evidence_url: 'https://example.org/'}, {price_condition: 'unknown'},
      {currency: 'USD'}, {price_minor: 0}, {availability: 'available'}, {observed_at: 'invalid'}]) {
      const card = normalize({...raw, ...patch});
      assert.ok(!card?.basketProductId, `${retailer}: ${JSON.stringify(patch)}`);
    }
  }
  const raw = rowFor('perekrestok');
  for (const patch of [{location_label: 'Другой адрес'}, {store_name: 'Физический Перекрёсток'},
    {product_url: raw.product_url.replace('h5q7w', 'other')}, {product_url: raw.product_url + '&extra=1'}]) {
    assert.ok(!normalize({...raw, ...patch})?.basketProductId, JSON.stringify(patch));
  }
});

test('the list fallback cannot bypass existing reviewed SKU identity gates', () => {
  for (const [retailer, source_product_id] of [['metro', '241097'], ['perekrestok', '22f84859-1ad2-481f-9250-c24580363f8c']]) {
    const card = normalize({...rowFor(retailer), source_product_id});
    assert.equal(getReviewedRetailBasketProduct(card, {nowMs}), null);
    assert.equal(card.basketProductId, undefined);
  }
});

test('browse returns the runtime admitted card rather than a clone that loses admission', async () => {
  const source = {...rowFor('vkusvill'), observed_at: new Date(Date.now() - 60_000).toISOString()};
  const client = createRetailCatalogClient({retailerId: 'vkusvill',
    fetchImpl: async () => new Response(JSON.stringify([source]), {headers: {'Content-Type': 'application/json'}})});
  const result = await client.browse({limit: 40});
  assert.equal(result.kind, 'catalog');
  assert.equal(result.products.length, 1);
  assert.equal(getReviewedRetailBasketProduct(result.products[0])?.id, result.products[0].id);
});
