import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expectedLentaRoots, pinnedRuntimePrefix, pinnedLiveRuntimeProof, settleExactStoreSelection } from '../tools/live-retail-smoke-contract.mjs';

const row = (id, count = 2) => ({ retailer_id: 'lenta', store_id: 'lenta-public-web',
  category_id: id, root_id: id, parent_id: null, depth: 0, name: `Category ${id}`,
  product_count: count, source_url: `https://lenta.com/catalog/category-${id}/` });

function selectionFixture(stages, { clickError = false, pressed = 'true' } = {}) {
  let clicks = 0, choices = 0;
  const page = {
    waitForFunction: async () => {
      const stage = stages.shift();
      if (!stage) throw Error('No valid next screen');
      return { jsonValue: async () => stage };
    },
    getByRole: () => ({ click: async () => { clicks++; if (clickError) throw Error('Hidden while scrolling'); } }),
    locator: selector => selector === '#globus-store-address' ? {
      getAttribute: async () => null,
      locator: () => ({ evaluateAll: async () => '5011' })
    } : selector === '#retail-store-card' ? { getAttribute: async () => pressed }
      : { waitFor: async () => {} }
  };
  return { page, choice: async () => { choices++; }, clicks: () => clicks, choices: () => choices };
}

test('location selection accepts manual chooser, direct storefront and a button hidden during scroll', async () => {
  for (const [stages, options, clicks, choices] of [
    [['manual', 'chooser'], {}, 1, 1],
    [['storefront'], {}, 0, 0],
    [['manual', 'storefront'], { clickError:true }, 1, 0],
    [['chooser'], {}, 0, 1]
  ]) {
    const f = selectionFixture([...stages], options);
    await settleExactStoreSelection(f.page, '#retail-store-card', 'globus', f.choice);
    assert.equal(f.clicks(), clicks); assert.equal(f.choices(), choices);
  }
});

test('location selection does not hide an error without a valid next screen or accept wrong retailer', async () => {
  const hidden = selectionFixture(['manual'], { clickError:true });
  await assert.rejects(() => settleExactStoreSelection(hidden.page, '#retail-store-card', 'globus', hidden.choice), /Hidden while scrolling/);
  const wrong = selectionFixture(['chooser'], { pressed:'false' });
  await assert.rejects(() => settleExactStoreSelection(wrong.page, '#retail-store-card', 'globus', wrong.choice));
});

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
