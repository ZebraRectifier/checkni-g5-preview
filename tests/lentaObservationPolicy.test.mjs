import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LENTA_OBSERVATION_MAX_AGE_MS,
  canAdmitLentaCatalogCard,
  getLentaObservationStatus
} from '../src/catalog/lentaObservationPolicy.mjs';

const observedAt = '2026-11-07T08:00:00.000Z';
const observedMs = Date.parse(observedAt);
const lenta = { retailerId: 'lenta', catalogSource: 'lenta', observedAt };

test('Lenta observation changes to stale exactly at the bounded age', () => {
  assert.equal(getLentaObservationStatus(lenta, observedMs + LENTA_OBSERVATION_MAX_AGE_MS - 1), 'recent');
  assert.equal(getLentaObservationStatus(lenta, observedMs + LENTA_OBSERVATION_MAX_AGE_MS), 'stale');
});

test('invalid and future Lenta timestamps fail to an unknown state', () => {
  assert.equal(getLentaObservationStatus({ ...lenta, observedAt: 'not-a-date' }, observedMs), 'unknown');
  assert.equal(getLentaObservationStatus(lenta, observedMs - 1), 'unknown');
  assert.equal(getLentaObservationStatus({ retailerId: 'globus', observedAt }, observedMs), null);
});

test('public Lenta catalogue cards remain fail-closed for manual admission', () => {
  assert.equal(canAdmitLentaCatalogCard(lenta, observedMs + 1), false);
  assert.equal(canAdmitLentaCatalogCard(lenta, observedMs + LENTA_OBSERVATION_MAX_AGE_MS), false);
  assert.equal(canAdmitLentaCatalogCard({ retailerId: 'lenta', observedAt: 'not-a-date' }, observedMs), false);
  assert.equal(canAdmitLentaCatalogCard({ retailerId: 'globus', observedAt }, observedMs), true);
});
