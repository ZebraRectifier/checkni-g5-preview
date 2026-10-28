import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findStoreSearchMatches } from '../src/components/storeSearchIndex.mjs';

const entries = [
  {
    retailerId: 'globus', name: 'Глобус',
    cardText: 'Глобус · Москва · Новорижское шоссе',
    addresses: [
      { label: 'Глобус Красногорск · Новорижское шоссе, 22-й км', selectable: true },
      { label: 'Глобус Пушкино · г. Пушкино, Красноармейское ш., вл. 105', selectable: true },
      { label: 'Глобус Королёв · г. Королёв, ул. Коммунальная, д. 1', selectable: true },
    ],
  },
  {
    retailerId: 'magnit', name: 'Магнит',
    cardText: 'Магнит · Москва · Берёзовая аллея',
    addresses: [
      { label: 'г. Пушкино, улица Вокзальная, д. 1', selectable: false },
      { label: 'г. Щёлково, улица Центральная, д. 2', selectable: true },
    ],
  },
  {
    retailerId: 'metro', name: 'METRO',
    cardText: 'METRO · Москва · Ленинградское шоссе',
    addresses: [{ label: 'Москва · Ленинградское шоссе 71Г', selectable: true }],
  },
];

test('finds an enabled exact-address store without treating that address as selected', () => {
  const result = findStoreSearchMatches('Пушкино', entries);
  assert.deepEqual(result.map(row => row.retailerId), ['globus']);
  assert.equal(result[0].matchedCard, false);
  assert.deepEqual(result[0].matchedAddresses.map(row => row.label), [entries[0].addresses[1].label]);
});

test('keeps store-name search and normalizes ё, case and spaces', () => {
  assert.deepEqual(findStoreSearchMatches('  ГЛОБУС ', entries).map(row => row.retailerId), ['globus']);
  assert.deepEqual(findStoreSearchMatches('Королев', entries).map(row => row.retailerId), ['globus']);
  assert.deepEqual(findStoreSearchMatches('Щелково', entries).map(row => row.retailerId), ['magnit']);
});

test('does not combine words from two different addresses into a false result', () => {
  assert.deepEqual(findStoreSearchMatches('Пушкино Красногорск', entries), []);
});

test('does not claim a disabled address or search outside selectable store scope', () => {
  assert.deepEqual(findStoreSearchMatches('Магнит Пушкино', entries), []);
  assert.deepEqual(findStoreSearchMatches('ОКЕЙ Пушкино', entries), []);
});

test('returns all current store cards when query is empty', () => {
  const result = findStoreSearchMatches(' ', entries);
  assert.deepEqual(result.map(row => row.retailerId), ['globus', 'magnit', 'metro']);
});
