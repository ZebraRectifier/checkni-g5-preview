import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedLentaRoots, pinnedRuntimePrefix } from '../tools/live-retail-smoke-contract.mjs';

const row = (id, count = 2) => ({ retailer_id: 'lenta', store_id: 'lenta-public-web',
  category_id: id, root_id: id, parent_id: null, depth: 0, name: `Category ${id}`,
  product_count: count, source_url: `https://lenta.com/catalog/category-${id}/` });

test('live root contract follows IDs/counts from the response, excluding seeded zero rows', () => {
  assert.deepEqual(expectedLentaRoots([row(7), row(8, 0), row(90, 12)]), [
    { id: '7', name: 'Category 7', productCount: 2 },
    { id: '90', name: 'Category 90', productCount: 12 }
  ]);
});

test('root oracle fails on empty/foreign/duplicate/invalid provenance responses', () => {
  for (const rows of [[], [row(7, 0)], [row(7), row(7)],
    [{ ...row(7), retailer_id: 'globus' }], [{ ...row(7), depth: 1 }],
    [{ ...row(7), product_count: -1 }], [{ ...row(7), source_url: 'https://example.com/catalog/7/' }]])
    assert.throws(() => expectedLentaRoots(rows));
});

test('runtime gate requires the immutable entry, not the mutable source tree', () => {
  const prefix = `releases/${'a'.repeat(64)}/`;
  const tag = `<script type="module" src="./${prefix}src/app.mjs"></script>`;
  assert.equal(pinnedRuntimePrefix(tag), prefix);
  const priceTag = tag.replace("src/app.mjs", "src/priceCapture.mjs");
  assert.equal(pinnedRuntimePrefix(priceTag, "priceCapture"), prefix);
  assert.throws(() => pinnedRuntimePrefix(priceTag));
  for (const html of ['<script src="./src/app.mjs"></script>', tag + tag,
    '<script src="./releases/../src/app.mjs"></script>'])
    assert.throws(() => pinnedRuntimePrefix(html));
});
