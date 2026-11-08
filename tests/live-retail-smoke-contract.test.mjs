import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expectedLentaRoots, pinnedRuntimePrefix, pinnedLiveRuntimeProof } from '../tools/live-retail-smoke-contract.mjs';

const row = (id, count = 2) => ({ retailer_id: 'lenta', store_id: 'lenta-public-web',
  category_id: id, root_id: id, parent_id: null, depth: 0, name: `Category ${id}`,
  product_count: count, source_url: `https://lenta.com/catalog/category-${id}/` });

test('live root contract follows IDs/counts from the response, excluding seeded zero rows', () => {
  assert.deepEqual(expectedLentaRoots([row(7), row(8, 0), row(90, 12)]), [
    { id: '7', name: 'Category 7', productCount: 2 },
    { id: '90', name: 'Category 90', productCount: 12 }
  ]);
});

test('live proof checks entry and pinned bytes and rejects stale or unavailable runtime', async () => {
  const prefix = `releases/${'b'.repeat(64)}/`;
  const local = new Map([
    ['index.html', Buffer.from(`<script type="module" src="./${prefix}src/app.mjs"></script>`)],
    [prefix + 'manifest.json', Buffer.from('{"version":1}')],
    [prefix + 'src/app.mjs', Buffer.from('reviewed runtime')]
  ]);
  let failPath = null;
  let unavailable = false;
  const proof = await pinnedLiveRuntimeProof({ baseUrl: 'https://example.test/site/', files: ['src/app.mjs'],
    readFile: async file => { assert(local.has(file)); return local.get(file); },
    fetchImpl: async url => {
      if (unavailable) return new Response('Unavailable', { status: 503 });
      const file = url.pathname.slice('/site/'.length);
      return new Response(file === failPath ? 'stale bytes' : local.get(file), { status: 200 });
    }
  });
  assert.equal(proof.prefix, prefix);
  assert.equal(await proof.matchesPublished(), true);
  for (const file of local.keys()) { failPath = file; assert.equal(await proof.matchesPublished(), false, file); }
  failPath = null; unavailable = true;
  assert.equal(await proof.matchesPublished(), false);
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

test('live acceptance follows a successful exact Pages deployment instead of racing the push', async () => {
  const workflow = await readFile(new URL('../.github/workflows/live-retail-smoke.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_run:\s*\n\s+workflows: \["Publish verified Pages tree"\]\s*\n\s+types: \[completed\]/u);
  assert.doesNotMatch(workflow, /^\s{2}push:/mu);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/u);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/u);
  assert.match(workflow, /github\.event\.workflow_run\.event != 'pull_request'/u);
  assert.match(workflow, /CHECKNI_PUBLISHED_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.equal((workflow.match(/ref: \$\{\{ env\.CHECKNI_PUBLISHED_SHA \}\}/gu) ?? []).length, 2);
});
