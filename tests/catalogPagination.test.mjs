import test from 'node:test';
import assert from 'node:assert/strict';
import { canLoadMoreCatalogPage, catalogPageProgress } from '../src/runtime/catalogPagination.mjs';

test('a full raw page with no admitted cards is finite', () => {
  const progress = catalogPageProgress({ rawPageSize: 40, admittedPageSize: 0 }, 0);
  assert.deepEqual(progress, { raw: 40, admitted: 0, filtered: true });
  assert.equal(canLoadMoreCatalogPage({ progress, pageLimit: 40, nextOffset: 40 }), false);
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
