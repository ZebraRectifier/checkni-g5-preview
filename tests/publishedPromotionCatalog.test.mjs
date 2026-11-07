import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRetailCatalogClient, getRetailCatalogDefinition, normalizeRetailRow, RETAIL_CATALOG_IDS } from '../src/ports/retailCatalogPort.mjs';
import { parsePyatCatalogue } from '../src/observations/pyaterochkaPublishedPromotions.mjs';
import { parsePublishedCatalogue, PUBLISHED_URL } from '../src/observations/okeyPublishedPromotions.mjs';
import { parseOfficialProduct, OFFICIAL_SCOPE, OFFICIAL_CATALOG_URL } from '../src/observations/okeyOfficialPromotions.mjs';
const raw = JSON.parse(await readFile(new URL('./fixtures/pyaterochka-public/raw-20261018.json', import.meta.url), 'utf8'));
const snapshot = parsePyatCatalogue(raw);
const at = Date.parse(raw.observedAt) + 1000;
const published = () => parsePublishedCatalogue({ sourceUrl: PUBLISHED_URL, title: 'КАТАЛОГ АКЦИЙ «ОКЕЙ ГИПЕРМАРКЕТ» — МОСКВА',
  period: 'с 15 по 21 октября 2026', observedAt: raw.observedAt,
  products: [{ id: '51922605', name: 'Свинина шея без кости п/ф охлажденный кг', rubles: '459', cents: '00',
    oldRubles: '728', oldCents: '99', endText: 'до 21 октября' }] });
const official = () => ({ version: 1, kind: 'okey-official-city-promotions', retailerId: 'okey', sourceUrl: OFFICIAL_CATALOG_URL,
  scope: OFFICIAL_SCOPE, selectedCity: 'Москва', physicalStoreId: null, physicalStoreAddress: null, complete: false,
  observedAt: raw.observedAt, products: [parseOfficialProduct({ name: 'Молоко 900мл', rubles: '82', cents: '59',
    selectedCity: 'Москва', endText: 'Акция действует до 21 октября', observedAt: raw.observedAt,
    productUrl: 'https://www.okmarket.ru/product/milk_900ml/' })] });

test('both city catalogs register without pretending to bind a physical shop or accepting raw database rows', async () => {
  for (const retailerId of ['okey', 'pyaterochka']) {
    assert.ok(RETAIL_CATALOG_IDS.includes(retailerId));
    const definition = getRetailCatalogDefinition(retailerId);
    assert.equal(definition.priceScope, 'city-promotion'); assert.equal(definition.physicalStoreId, null);
    assert.equal(definition.defaultProductCount, null);
    assert.equal(normalizeRetailRow({ retailer_id: retailerId }, retailerId), null);
    let calls = 0;
    const client = createRetailCatalogClient({ retailerId, store: { address: 'Казань' }, fetchImpl: async () => { calls++; } });
    assert.equal((await client.browse()).kind, 'error'); assert.equal(calls, 0);
  }
});

test('Pyaterochka supplies real dates, sources and categories to the existing client interface', async () => {
  const reads = [];
  const client = createRetailCatalogClient({ retailerId: 'pyaterochka', nowMs: at, fetchImpl: async (url, options) => {
    reads.push(String(url)); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers, undefined); return Response.json(snapshot);
  } });
  const [catalog, roots] = await Promise.all([client.browse({ limit: 40 }), client.rootCategories()]);
  assert.equal(reads.length, 1); assert.ok(reads[0].endsWith('/src/data/pyaterochkaPublishedPromotions.json'));
  assert.equal(catalog.kind, 'catalog'); assert.equal(roots.kind, 'categories');
  assert.equal(roots.categories.reduce((sum, row) => sum + row.productCount, 0), snapshot.products.length);
  for (const row of catalog.products) {
    const original = snapshot.products.find(product => product.sourceProductId === row.sourceProductId);
    assert.equal(row.priceMinor, original.priceMinor); assert.equal(row.sourceUrl, original.productUrl);
    assert.equal(row.observedAt, original.observedAt); assert.equal(row.validUntil, original.validUntil);
    assert.equal(row.physicalStoreId, null); assert.equal(row.comparisonEligible, false); assert.equal(row.catalogDisplayOnly, true);
    assert.equal(row.basketProductId, undefined); assert.equal(row.publisher, 'proshoper');
  }
  const category = roots.categories.find(row => row.productCount > 0);
  const sub = await client.subcategories(category.categoryId); assert.deepEqual(sub.categories, []);
  const selected = await client.browseCategory(category);
  assert.equal(selected.products.length, Math.min(40, category.productCount));
  assert.ok(selected.products.every(row => row.categoryId === category.categoryId));
  const product = catalog.products[0]; const found = await client.search(product.name);
  assert.ok(found.products.some(row => row.id === product.id));
  assert.equal((await client.bySourceProductIds([product.sourceProductId])).products[0].id, product.id);
});

test('multiple pages expose more than forty distinct products, and no match is an empty success', async () => {
  const large = structuredClone(snapshot);
  large.products = Array.from({ length: 85 }, (_, index) => ({ ...snapshot.products[index % snapshot.products.length],
    sourceProductId: String(61000000 + index), productUrl: snapshot.sourceUrl + '#id_product_' + (61000000 + index) }));
  const client = createRetailCatalogClient({ retailerId: 'pyaterochka', nowMs: at, fetchImpl: async () => Response.json(large) });
  const first = await client.browse({ limit: 40 }); const second = await client.browse({ limit: 40, offset: first.nextOffset });
  const third = await client.browse({ limit: 40, offset: second.nextOffset });
  assert.deepEqual([first.pageSize, second.pageSize, third.pageSize], [40, 40, 5]);
  assert.equal(new Set([...first.products, ...second.products, ...third.products].map(row => row.id)).size, 85);
  const empty = await client.search('несуществующий товар'); assert.equal(empty.kind, 'catalog'); assert.deepEqual(empty.products, []);
});

test('Okey keeps official and published provenance separate and falls back when one transport fails', async () => {
  let officialUnavailable = false;
  const client = createRetailCatalogClient({ retailerId: 'okey', nowMs: at, fetchImpl: async url => {
    if (String(url).includes('Official')) return officialUnavailable ? new Response('', { status: 503 }) : Response.json(official());
    return Response.json(published());
  } });
  const both = await client.browse(); assert.equal(both.products.length, 2); assert.equal(both.partial, false);
  assert.deepEqual(new Set(both.products.map(row => row.publisher)), new Set(['okey', 'proshoper']));
  assert.equal(new Set(both.products.map(row => row.id)).size, 2);
  assert.ok(both.products.every(row => row.physicalStoreId === null && row.priceScope === 'city-promotion'));
  officialUnavailable = true;
  const fallback = await client.browse(); assert.equal(fallback.kind, 'catalog'); assert.equal(fallback.partial, true);
  assert.equal(fallback.unavailableSources, 1);
  assert.equal(fallback.products.length, 1); assert.equal(fallback.products[0].publisher, 'proshoper');
  assert.equal(fallback.products[0].priceMinor, 45900);
});

test('an official empty placeholder allows published fallback, not invented official data', async () => {
  const client = createRetailCatalogClient({ retailerId: 'okey', nowMs: at, fetchImpl: async url => Response.json(
    String(url).includes('Official') ? { version: 1, products: [] } : published()) });
  const catalog = await client.browse(); assert.equal(catalog.products.length, 1); assert.equal(catalog.partial, true);
  assert.equal(catalog.products[0].publisher, 'proshoper');
});

test('24h expiry, future observations and campaign expiry remain enforced across calls', async () => {
  let now = at;
  const client = createRetailCatalogClient({ retailerId: 'pyaterochka', now: () => now, fetchImpl: async () => Response.json(snapshot) });
  assert.ok((await client.browse()).products.length);
  now = Date.parse(snapshot.observedAt) + 86400001;
  const stale = await client.browse(); assert.deepEqual(stale.products, []); assert.equal(stale.emptyReason, 'no_current_promotions');
  assert.deepEqual((await client.rootCategories()).categories, []);
  now = Date.parse(snapshot.observedAt) - 1; assert.deepEqual((await client.browse()).products, []);
  const nearMidnight = published(); nearMidnight.observedAt = '2026-10-21T20:00:00.000Z';
  nearMidnight.products.forEach(row => { row.observedAt = nearMidnight.observedAt; });
  const expiring = createRetailCatalogClient({ retailerId: 'okey', nowMs: Date.parse('2026-10-21T21:00:00Z'),
    fetchImpl: async url => Response.json(String(url).includes('Official') ? { version: 1, products: [] } : nearMidnight) });
  assert.deepEqual((await expiring.browse()).products, []);
});

test('transport failure differs from an expired catalog and retry reads the repaired file', async () => {
  let fail = true, calls = 0;
  const client = createRetailCatalogClient({ retailerId: 'pyaterochka', nowMs: at, fetchImpl: async () => {
    calls++; return fail ? new Response('', { status: 503 }) : Response.json(snapshot);
  } });
  assert.equal((await client.browse()).kind, 'unavailable');
  fail = false; assert.ok((await client.browse()).products.length); assert.equal(calls, 2);
});

test('a stalled Okey source times out while the other survives; retry restores both', async () => {
  let stalled = true, aborted = 0;
  const client = createRetailCatalogClient({ retailerId: 'okey', nowMs: at, timeoutMs: 5,
    fetchImpl: async (url, options) => {
      if (!String(url).includes('Official')) return Response.json(published());
      if (!stalled) return Response.json(official());
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
        aborted++; reject(new Error('aborted'));
      }, { once: true }));
    } });
  const partial = await client.browse();
  assert.equal(partial.kind, 'catalog'); assert.equal(partial.products.length, 1);
  assert.equal(partial.unavailableSources, 1); assert.equal(aborted, 1);
  stalled = false;
  const repaired = await client.browse(); assert.equal(repaired.products.length, 2);
  assert.equal(repaired.unavailableSources, 0); assert.equal(repaired.partial, false);
});

test('malformed snapshots, invented city bindings and duplicate source IDs cannot become prices', async () => {
  for (const mutate of [s => { s.selectedCity = 'Казань'; }, s => { s.physicalStoreId = 'physical-shop'; },
    s => { s.products.push(s.products[0]); }, s => { s.products[0].priceMinor = 0; }]) {
    const invalid = structuredClone(snapshot); mutate(invalid);
    const client = createRetailCatalogClient({ retailerId: 'pyaterochka', nowMs: at, fetchImpl: async () => Response.json(invalid) });
    assert.equal((await client.browse()).kind, 'unavailable');
  }
});

test('invalid paging/search/category requests never call the transport', async () => {
  let calls = 0;
  const client = createRetailCatalogClient({ retailerId: 'pyaterochka', fetchImpl: async () => { calls++; return Response.json(snapshot); } });
  for (const response of [await client.browse({ limit: 41 }), await client.browse({ offset: -1 }), await client.search(''),
    await client.browseCategory(null), await client.rootCategories({ limit: 201 }), await client.bySourceProductIds([])])
    assert.equal(response.kind, 'error');
  assert.equal(calls, 0);
});

test('oversized and invalid JSON responses remain bounded and fail closed', async () => {
  for (const response of [new Response('['), new Response('{}', { headers: { 'Content-Length': '262145' } })]) {
    const client = createRetailCatalogClient({ retailerId: 'pyaterochka', nowMs: at, fetchImpl: async () => response });
    assert.equal((await client.browse()).kind, 'unavailable');
  }
});
