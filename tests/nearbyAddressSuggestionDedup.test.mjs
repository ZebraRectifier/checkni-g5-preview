import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueHouseCandidates } from '../src/components/NearbyShopping.mjs';

test('identical nearby house suggestions collapse while landmarks and distinct places remain', () => {
  const first = { label: 'Московская область, Реутов, Лесная улица, 7', lat: 55.76004, lon: 37.85269, precision: 'house' };
  const duplicate = { ...first, lat: first.lat + 0.00001 };
  const distant = { ...first, lat: first.lat + 0.01 };
  const shop = { ...first, label: first.label + ', Магнит', precision: 'store' };
  const other = { ...first, label: 'Московская область, Реутов, Лесная улица, 8' };
  assert.deepEqual(uniqueHouseCandidates([first, duplicate, distant, shop, other]), [first, distant, shop, other]);
});
