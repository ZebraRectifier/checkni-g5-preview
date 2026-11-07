import assert from 'node:assert/strict';

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
