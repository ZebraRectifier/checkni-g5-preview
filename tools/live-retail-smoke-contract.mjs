import assert from 'node:assert/strict';
import { readFile as readLocalFile } from 'node:fs/promises';

// Store selection can advance asynchronously as a previously allowed browser
// location resolves. Accept either the manual chooser or the already selected
// storefront, but never accept an unrelated storefront or hide a click error.
export async function settleExactStoreSelection(page, selector, retailer, chooseAddressCard) {
  const chooser = page.locator('#pixel-address-chooser');
  const manual = page.getByRole('button', { name: 'Выбрать магазин вручную' });
  const screen = async allowManual => {
    const handle = await page.waitForFunction(({ selector, allowManual }) => {
      const visible = el => Boolean(el && !el.hidden && el.getClientRects().length
        && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
      if (visible(document.querySelector('#pixel-storefront'))
          && document.querySelector(selector)?.getAttribute('aria-pressed') === 'true') return 'storefront';
      if (visible(document.querySelector('#pixel-address-chooser'))) return 'chooser';
      if (allowManual && [...document.querySelectorAll('button')].some(el =>
        el.textContent.trim() === 'Выбрать магазин вручную' && visible(el))) return 'manual';
      return false;
    }, { selector, allowManual }, { timeout: 15000 });
    return await handle.jsonValue();
  };
  let current = await screen(true);
  if (current === 'manual') {
    try { await manual.click({ timeout: 1500 }); }
    catch (error) {
      // The button may disappear while Playwright scrolls because location
      // auto-selects. Only tolerate that if a valid next screen is present.
      try { current = await screen(false); } catch { throw error; }
    }
    if (current === 'manual') current = await screen(false);
  }
  if (current === 'storefront') return;
  const select = page.locator(`#${retailer}-store-address`);
  const previous = await select.getAttribute('data-pixel-original-address');
  const option = await select.locator('option').evaluateAll((options, preferred) =>
    options.find(item => item.value === preferred && !item.disabled)?.value
    ?? options.find(item => item.value && !item.disabled)?.value, previous);
  assert(option, `No selectable address for ${retailer}`);
  await chooseAddressCard(page, retailer, option);
  await page.locator('#pixel-storefront').waitFor({state:'visible'});
  assert.equal(await page.locator(selector).getAttribute('aria-pressed'), 'true');
}

export async function pinnedLiveRuntimeProof({ baseUrl, files, readFile = readLocalFile, fetchImpl = globalThis.fetch }) {
  const entry = await readFile('index.html');
  const prefix = pinnedRuntimePrefix(entry.toString('utf8'));
  assert(files.every(file => /^src\/[a-zA-Z0-9_./-]+\.mjs$/u.test(file) && !file.includes('..')), 'Unsafe runtime proof path');
  const paths = ['index.html', prefix + 'manifest.json', ...files.map(file => prefix + file)];
  const expected = await Promise.all(paths.map(file => file === 'index.html' ? entry : readFile(file)));
  return {
    prefix,
    async matchesPublished(attempt = 0) {
      const checks = await Promise.all(paths.map(async (file, index) => {
        try {
          const url = new URL(file, baseUrl); url.searchParams.set('runtimeProof', String(attempt));
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
          return response.ok && Buffer.from(await response.arrayBuffer()).equals(expected[index]);
        } catch { return false; }
      }));
      return checks.every(Boolean);
    }
  };
}

export function pinnedRuntimePrefix(html, entry = 'app') {
  assert(['app', 'priceCapture'].includes(entry), 'Unsupported entry point');
  const matches = [...html.matchAll(/<script\b[^>]*\bsrc=["']\.\/(releases\/[a-f0-9]{64}\/)src\/(app|priceCapture)\.mjs["'][^>]*>/gu)];
  assert.equal(matches.length, 1, 'Entry must load one explicit immutable app runtime');
  assert.equal(matches[0][2], entry, 'Entry page loads the wrong module');
  return matches[0][1];
}

// The live response is the oracle; seeded empty branches are not navigable.
// Never replace this with a fixed UI count or accept arbitrary category IDs.
export function expectedLentaRoots(rows) {
  assert(Array.isArray(rows) && rows.length > 0 && rows.length <= 160,
    'Lenta root response must be nonempty and bounded');
  const ids = new Set();
  const roots = [];
  for (const row of rows) {
    assert(row?.retailer_id === 'lenta' && row.store_id === 'lenta-public-web'
      && row.depth === 0 && row.parent_id === null
      && Number.isSafeInteger(row.category_id) && row.category_id > 0
      && row.root_id === row.category_id
      && typeof row.name === 'string' && row.name.trim()
      && Number.isSafeInteger(row.product_count) && row.product_count >= 0,
    'Lenta response contains a foreign or malformed root');
    const source = new URL(row.source_url);
    assert(source.protocol === 'https:' && ['lenta.com', 'www.lenta.com'].includes(source.hostname)
      && source.pathname.startsWith('/catalog/'), 'Lenta root lost official provenance');
    assert(!ids.has(row.category_id), 'Lenta root response contains duplicate IDs');
    ids.add(row.category_id);
    if (row.product_count > 0) roots.push({
      id: String(row.category_id), name: row.name.trim(), productCount: row.product_count
    });
  }
  assert(roots.length > 0, 'Lenta response contains no populated root');
  return roots;
}
