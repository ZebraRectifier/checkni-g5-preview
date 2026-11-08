import test from 'node:test';
import assert from 'node:assert/strict';
import { canRequestFallbackProductPhoto } from '../src/runtime/productPhotos.mjs';

test('only exact published Pyaterochka city cards suppress name-based fallback photos', () => {
  const card = { retailerId: 'pyaterochka', storeId: 'pyaterochka-moscow-proshoper', publisher: 'proshoper',
    priceScope: 'city-promotion', catalogDisplayOnly: true };
  assert.equal(canRequestFallbackProductPhoto(card), false);
  for (const change of [
    { retailerId: 'magnit' }, { storeId: 'physical-store' }, { publisher: 'official' },
    { priceScope: 'exact-store' }, { catalogDisplayOnly: false }
  ]) assert.equal(canRequestFallbackProductPhoto({ ...card, ...change }), true);
  assert.equal(canRequestFallbackProductPhoto(null), true);
});
