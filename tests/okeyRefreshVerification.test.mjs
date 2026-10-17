import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DELIVERY_ADDRESS, verifyFreshRefresh } from '../tools/okey-public-catalog/verify-refresh.mjs';

const persisted = JSON.parse(await readFile(new URL('../src/data/okeyDeliveryHistory.json', import.meta.url)));
const startedAt = '2026-10-17T12:00:00Z';
const nowMs = Date.parse('2026-10-17T12:05:00Z');
function fixture() {
  const snapshot = structuredClone(persisted.snapshots[0]);
  snapshot.observedAt = '2026-10-17T12:04:00Z';
  snapshot.observedDate = '2026-10-17';
  snapshot.products = snapshot.products.slice(0, 2).map(p => ({ ...p, sourceObservedAt: '2026-10-17T12:03:00Z' }));
  return { startedAt, nowMs, history: { version: 1, snapshots: [snapshot] },
    status: { status: 'collected', selectedDeliveryAddress: DELIVERY_ADDRESS,
      lastAttemptAt: '2026-10-17T12:00:01Z', uniqueProducts: snapshot.products.length } };
}

test('new address-bound source measurements verify even when prices did not change', () => {
  const result = verifyFreshRefresh(fixture());
  assert.equal(result.fresh, true);
  assert.equal(result.products, 2);
});
test('a paused source and failed collection cannot be successful refreshes', () => {
  for (const status of ['blocked', 'unavailable', undefined]) {
    const input = fixture(); input.status.status = status;
    assert.equal(verifyFreshRefresh(input).fresh, false);
  }
});
test('changing only a success flag or attempt date cannot refresh saved prices', () => {
  const input = fixture(); input.history = persisted;
  assert.equal(verifyFreshRefresh(input).reason, 'no-fresh-snapshot');
  input.status.lastAttemptAt = '2026-10-05T12:00:00Z';
  assert.equal(verifyFreshRefresh(input).reason, 'stale-attempt');
});
test('rewriting the snapshot date cannot freshen old product measurements', () => {
  const input = fixture(); input.history.snapshots[0].products[0].sourceObservedAt = '2026-10-17T11:59:00Z';
  assert.equal(verifyFreshRefresh(input).reason, 'stale-product-evidence');
  delete input.history.snapshots[0].products[0].sourceObservedAt;
  assert.equal(verifyFreshRefresh(input).reason, 'stale-product-evidence');
});
test('another delivery address, empty or invalid prices cannot satisfy the gate', () => {
  const input = fixture(); input.status.selectedDeliveryAddress = 'Другой адрес';
  assert.equal(verifyFreshRefresh(input).reason, 'wrong-address');
  input.status.selectedDeliveryAddress = DELIVERY_ADDRESS;
  input.history.snapshots[0].selectedDeliveryAddress = 'Другой адрес';
  assert.equal(verifyFreshRefresh(input).fresh, false);
  input.history.snapshots[0].selectedDeliveryAddress = DELIVERY_ADDRESS;
  input.history.snapshots[0].products[0].displayedPriceKopeks = 0;
  assert.equal(verifyFreshRefresh(input).fresh, false);
  input.history.snapshots[0].products = [];
  assert.equal(verifyFreshRefresh(input).fresh, false);
});
test('future-dated evidence, stale runs and inconsistent product counts are rejected', () => {
  const input = fixture(); input.startedAt = '2026-10-18T00:00:00Z';
  assert.equal(verifyFreshRefresh(input).fresh, false);
  input.startedAt = startedAt; input.status.lastAttemptAt = '2026-10-18T00:00:00Z';
  assert.equal(verifyFreshRefresh(input).fresh, false);
  input.status.lastAttemptAt = '2026-10-17T12:00:01Z'; input.status.uniqueProducts++;
  assert.equal(verifyFreshRefresh(input).reason, 'product-count-mismatch');
  input.status.uniqueProducts--; input.history.snapshots[0].observedAt = '2026-10-17T12:06:00Z';
  assert.equal(verifyFreshRefresh(input).fresh, false);
});
