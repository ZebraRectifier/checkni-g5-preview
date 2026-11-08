import test from 'node:test';
import assert from 'node:assert/strict';
import { canLoadMoreCatalogPage, catalogPageProgress } from '../src/runtime/catalogPagination.mjs';

test('a full raw page with no admitted cards only continues by explicit manual action', () => {
  const progress = catalogPageProgress({ rawPageSize: 40, admittedPageSize: 0 }, 0);
  assert.deepEqual(progress, { raw: 40, admitted: 0, filtered: true });
  assert.equal(canLoadMoreCatalogPage({ progress, pageLimit: 40, nextOffset: 40 }), false);
  assert.equal(canLoadMoreCatalogPage({ progress, pageLimit: 40, nextOffset: 40, allowFiltered: true }), true);
});

test('manual filtered continuation preserves exact-page, offset, cap and expected-count guards', () => {
  const short = catalogPageProgress({ rawPageSize: 39, admittedPageSize: 0 }, 0);
  assert.equal(canLoadMoreCatalogPage({ progress: short, pageLimit: 40, nextOffset: 40,
    allowFiltered: true }), false);
  const full = catalogPageProgress({ rawPageSize: 40, admittedPageSize: 0 }, 0);
  assert.equal(canLoadMoreCatalogPage({ progress: full, pageLimit: 40, nextOffset: 40, offset: 40,
    allowFiltered: true }), false);
  assert.equal(canLoadMoreCatalogPage({ progress: full, pageLimit: 40, nextOffset: 10_040, offset: 10_000,
    allowFiltered: true }), false);
  assert.equal(canLoadMoreCatalogPage({ progress: full, pageLimit: 40, nextOffset: 80, offset: 40,
    expectedCount: 80, allowFiltered: true }), false);
});

test('a full admitted page keeps forward pagination', () => {
  const progress = catalogPageProgress({ rawPageSize: 40, admittedPageSize: 37 }, 37);
  assert.equal(canLoadMoreCatalogPage({ progress, pageLimit: 40, nextOffset: 80, offset: 40 }), true);
});

test('legacy pageSize remains compatible while admitted rows govern visibility', () => {
  const progress = catalogPageProgress({ pageSize: 24 }, 24);
  assert.deepEqual(progress, { raw: 24, admitted: 24, filtered: false });
  assert.equal(canLoadMoreCatalogPage({ progress, pageLimit: 24, nextOffset: 24 }), true);
});
