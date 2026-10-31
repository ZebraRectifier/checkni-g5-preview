import test from 'node:test';
import assert from 'node:assert/strict';
import { economicalCatalogCards, quoteCatalogDraft } from '../src/core/catalogDraft.mjs';

const nowMs = Date.parse('2026-10-31T21:10:00Z'); // Already November 1 in Moscow.
const group = { dimension: 'g', dailyAmount: 40 };
const card = extra => ({ name: 'Макароны 400г', unit: '400 г', priceMinor: 10000,
  currency: 'RUB', observedAt: '2026-10-31T21:09:00Z', ...extra });
const product = { id: 'pasta', name: 'Макароны', unit: '400 г' };

test('economy choice excludes an expired promotion before it hides a valid alternative', () => {
  const expired = card({ priceMinor: 100, validUntil: '2026-10-31' });
  const current = card({ validUntil: '2026-11-01' });
  assert.deepEqual(economicalCatalogCards(group, [expired, current], 3, 7, { nowMs }), [current]);
});

test('economy choice and quote agree on inadmissible money and observations', () => {
  const current = card({});
  for (const invalid of [card({ currency: 'USD' }), card({ priceMinor: '100' }),
    card({ priceMinor: 0.5 }), card({ observedAt: '2026-10-31T21:11:00Z' }),
    card({ observedAt: 'invalid' }), card({ validUntil: 'unknown' })]) {
    assert.equal(quoteCatalogDraft([{ card: invalid, product, quantity: 3 }], { nowMs }).knownSubtotalMinor, null);
    assert.deepEqual(economicalCatalogCards(group, [invalid, current], 3, 7, { nowMs }), [current]);
  }
});

test('expired alternatives cannot crowd every current product out of the four offered choices', () => {
  const current = card({});
  const expired = Array.from({ length: 5 }, (_, i) => card({ priceMinor: i + 1, validUntil: '2026-10-31' }));
  const offered = economicalCatalogCards(group, [...expired, current], 3, 7, { nowMs }).slice(0, 4);
  assert.deepEqual(offered, [current]);
});

test('dated prices remain explicit fallbacks and fresh candidates retain pack-cost ranking', () => {
  const old = card({ observedAt: '2026-10-30T12:00:00Z', priceMinor: 1 });
  const small = card({ unit: '200 г', priceMinor: 6000 });
  const large = card({ unit: '1 кг', priceMinor: 12000 });
  assert.deepEqual(economicalCatalogCards(group, [old, small, large], 3, 7, { nowMs }), [large, small, old]);
  const quote = quoteCatalogDraft([{ card: old, product, quantity: 3 }], { nowMs });
  assert.equal(quote.lines[0].freshness, 'dated');
  assert.equal(quote.allRecent, false);
  assert.equal(quote.winner, null);
});
