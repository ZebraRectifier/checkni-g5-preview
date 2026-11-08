import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {resolveRegisteredMagnitStore} from '../src/data/registeredMagnitStores.mjs';
import {nearbyGroceryMatches} from '../src/intelligence/nearbyShopping.mjs';
import {
  getRetailCatalogDefinition,
  normalizeRetailRow
} from '../src/ports/retailCatalogPort.mjs';
import {validMagnitKazanPilotAddressEvidence} from '../evidence/magnit-kazan-pilot-20261108/validate.mjs';

const address = 'Респ Татарстан, г Казань, ул Академика Глушко, д 5А';
const sourceUrl = 'https://magnit.ru/catalog/63963-test?shopCode=010852&shopType=1';
const productUrl = 'https://magnit.ru/product/pilot-contract-only?shopCode=010852&shopType=1';
const fixturePath = new URL('../evidence/magnit-kazan-pilot-20261108/address-evidence.json', import.meta.url);
const directoryPath = new URL('../src/data/nearby-regions/kazan.json', import.meta.url);

async function evidenceAndDirectory() {
  const evidence = JSON.parse(await readFile(fixturePath, 'utf8'));
  const directory = JSON.parse(await readFile(directoryPath, 'utf8'));
  return {evidence, directory, point: directory.stores.find(row => row.id === 'official:magnit:010852')};
}

function pilotDefinition() {
  const base = getRetailCatalogDefinition('magnit');
  return Object.freeze({
    ...base,
    storeId: 'magnit-010852',
    shopCode: '010852',
    storeAddress: address,
    storeName: `Магнит · ${address}`,
    localityId: 'city-kazan',
    localityName: 'Казань',
    catalogLabel: `Магнит · ${address}`,
    scopeLabel: `${address} · публичная цена сайта · наличие неизвестно`
  });
}

function pilotRow(overrides = {}) {
  return {
    retailer_id: 'magnit',
    store_id: 'magnit-010852',
    store_name: `Магнит · ${address}`,
    locality_id: 'city-kazan',
    locality_name: 'Казань',
    source_product_id: 'pilot-contract-only',
    name: 'Тестовый товар контракта',
    price_minor: 10000,
    currency: 'RUB',
    price_condition: 'public-online',
    availability: 'unknown',
    product_url: productUrl,
    image_url: null,
    weight_text: '1 шт',
    main_category_id: 63963,
    source_url: sourceUrl,
    location_label: address,
    scope_binding: 'public-store-product-page',
    binding_id: 'magnit-shopcode-010852',
    scope_evidence_url: sourceUrl,
    observed_at: '2026-11-08T00:00:00.000Z',
    ...overrides
  };
}

test('address evidence matches exactly one official Kazan directory point and proves no catalogue', async () => {
  const {evidence, directory, point} = await evidenceAndDirectory();
  assert.ok(point);
  assert.equal(directory.stores.filter(row => row.sourceStoreId === '010852').length, 1);
  assert.equal(validMagnitKazanPilotAddressEvidence(evidence, point), true);
  assert.equal(evidence.catalogEvidence, null);
  assert.equal(evidence.priceEvidence, false);
  assert.equal(point.catalogBinding, undefined);
  assert.equal(point.priceMinor, undefined);
});

test('address evidence rejects any changed identity, geography, provenance, state or catalogue claim', async () => {
  const {evidence, point} = await evidenceAndDirectory();
  const mutations = [
    {sourceStoreId: '010853'}, {address: `${address}, к 1`}, {lat: evidence.lat + 0.001},
    {lon: evidence.lon + 0.001}, {sourceUrl: 'https://example.com/'}, {verification: 'unknown'},
    {observedAt: '2026-11-08T00:00:00.000Z'}, {pilotState: 'enabled'},
    {catalogEvidence: sourceUrl}, {priceEvidence: true}, {products: []}
  ];
  for (const mutation of mutations) {
    assert.equal(validMagnitKazanPilotAddressEvidence({...evidence, ...mutation}, point), false);
  }
});

test('regional nearby search cannot expose 010852 as connected even if a serialized binding is forged', async () => {
  const {directory, point} = await evidenceAndDirectory();
  const position = {lat: point.lat, lon: point.lon};
  const found = nearbyGroceryMatches(directory.stores, position, 1, {regional: true});
  assert.equal(found.find(row => row.id === point.id)?.catalog, null);
  assert.deepEqual(nearbyGroceryMatches(directory.stores, position, 1, {regional: true, connectedOnly: true}), []);
  const forged = {...point, catalogBinding: {retailerId: 'magnit', shopCode: '010852'}};
  assert.equal(nearbyGroceryMatches([forged], position, 1, {regional: true})[0]?.catalog, null);
  assert.deepEqual(nearbyGroceryMatches([forged], position, 1, {regional: true, connectedOnly: true}), []);
});

test('an unregistered pilot definition admits only a fully exact scoped synthetic row', () => {
  const normalized = normalizeRetailRow(pilotRow(), pilotDefinition());
  assert.ok(normalized);
  assert.equal(normalized.id, 'retail:magnit:magnit-010852:pilot-contract-only');
  assert.equal(normalized.priceMinor, 10000);
});

test('Magnit exact-address normalization rejects every missing or changed scope field', () => {
  const invalid = [
    {location_label: `${address}, к 1`}, {location_label: undefined},
    {scope_binding: 'same-source'}, {scope_binding: undefined},
    {binding_id: 'magnit-shopcode-010853'}, {binding_id: undefined},
    {scope_evidence_url: sourceUrl.replace('010852', '010853')}, {scope_evidence_url: undefined}
  ];
  for (const mutation of invalid) assert.equal(normalizeRetailRow(pilotRow(mutation), pilotDefinition()), null);
});

test('Magnit exact-address normalization rejects unbound product, source and evidence URLs', () => {
  const wrongCode = sourceUrl.replace('010852', '010853');
  const noCode = 'https://magnit.ru/catalog/63963-test';
  const invalid = [
    {product_url: wrongCode}, {product_url: noCode},
    {product_url: `${productUrl}&shopCode=010853`},
    {source_url: wrongCode, scope_evidence_url: wrongCode},
    {source_url: noCode, scope_evidence_url: noCode},
    {source_url: `${sourceUrl}&shopCode=010853`, scope_evidence_url: `${sourceUrl}&shopCode=010853`},
    {source_url: undefined, scope_evidence_url: productUrl},
    {scope_evidence_url: 'https://example.com/catalog?shopCode=010852'}
  ];
  for (const mutation of invalid) assert.equal(normalizeRetailRow(pilotRow(mutation), pilotDefinition()), null);
});

test('Kazan pilot stays absent from the registered Magnit catalogue and wrong identity stays closed', () => {
  assert.equal(resolveRegisteredMagnitStore({shopCode: '010852'}), null);
  assert.notEqual(getRetailCatalogDefinition('magnit').storeId, 'magnit-010852');
  assert.equal(normalizeRetailRow(pilotRow({store_id: 'magnit-010853'}), pilotDefinition()), null);
  assert.equal(normalizeRetailRow(pilotRow({locality_id: 'city-moscow'}), pilotDefinition()), null);
  assert.equal(normalizeRetailRow(pilotRow({locality_name: 'Москва'}), pilotDefinition()), null);
});
