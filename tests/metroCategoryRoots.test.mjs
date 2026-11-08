import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetailCatalogClient } from '../src/ports/retailCatalogPort.mjs';
import { resolveMetroMoscowRegionStore } from '../src/data/metroMoscowRegionStores.mjs';

function catalogFixture(storeNumber, count) {
  const store = resolveMetroMoscowRegionStore(storeNumber);
  const requests = [];
  const categories = Array.from({ length: count }, (_, index) => ({
    retailer_id: 'metro', store_id: store.bindingId,
    category_id: 900000 + index, root_id: 900000 + index,
    name: index === count - 1 ? 'Яйца белые' : `Категория ${String(index + 1).padStart(2, '0')}`,
    parent_id: null, depth: 0, product_count: 1,
    source_url: `https://online.metro-cc.ru/dynamic/category-${index + 1}`
  }));
  const productUrl = 'https://online.metro-cc.ru/products/eggs-test-10';
  const product = {
    retailer_id: 'metro', store_id: store.bindingId, binding_id: store.bindingId,
    store_name: `METRO · ${store.address}`,
    locality_id: store.scope === 'moscow-city' ? 'city-moscow' : 'region-moscow-oblast',
    locality_name: store.scope === 'moscow-city' ? 'Москва' : 'Московская область',
    source_product_id: 'test-eggs-10', name: 'Яйца белые С1, 10 шт', weight_text: '10 шт',
    main_category_id: categories.at(-1).category_id,
    price_minor: 14990, currency: 'RUB', price_condition: 'regular', availability: 'unknown',
    sales_channel: 'online', minimum_quantity: 1, scope_binding: 'same-source',
    location_label: store.address, scope_evidence_url: productUrl,
    product_url: productUrl, source_url: productUrl, image_url: null,
    observed_at: '2026-11-07T06:00:00.000Z'
  };
  const client = createRetailCatalogClient({
    retailerId: 'metro', store, nowMs: Date.parse('2026-11-07T06:05:00Z'),
    endpoint: 'https://project.supabase.co/rest/v1/retail_catalog_items',
    categoryEndpoint: 'https://project.supabase.co/rest/v1/retail_catalog_categories',
    publishableKey: 'publishable-test',
    fetchImpl: async value => {
      const url = new URL(value);
      requests.push(url);
      const rows = url.pathname.endsWith('/retail_catalog_categories')
        ? categories.slice(0, Number(url.searchParams.get('limit')))
        : url.searchParams.get('main_category_id') === `eq.${product.main_category_id}` ? [product] : [];
      return Response.json(rows);
    }
  });
  return { client, categories, product, requests, store };
}

// These sizes reproduce the confirmed address-specific root sets, not invented stock.
for (const [storeNumber, count] of [['10', 51], ['1317', 45], ['1318', 48]]) {
  test(`METRO ${storeNumber} exposes all ${count} roots and opens the category beyond row 40`, async () => {
    const { client, categories, product, requests, store } = catalogFixture(storeNumber, count);
    const roots = await client.rootCategories();
    assert.equal(roots.kind, 'categories');
    assert.equal(roots.partial, false);
    assert.equal(roots.categories.length, count);
    assert.equal(new Set(roots.categories.map(category => category.categoryId)).size, count);
    assert.equal(roots.categories.at(-1).name, 'Яйца белые');
    assert.equal(requests[0].searchParams.get('limit'), '160');
    assert.equal(requests[0].searchParams.get('store_id'), `eq.${store.bindingId}`);
    assert.equal(requests[0].searchParams.get('depth'), 'eq.0');
    assert.equal(requests[0].searchParams.get('active'), 'eq.true');

    const result = await client.browseCategory(roots.categories.at(-1));
    assert.equal(result.kind, 'catalog');
    assert.equal(result.products.length, 1);
    assert.equal(requests[1].searchParams.get('store_id'), `eq.${store.bindingId}`);
    assert.equal(requests[1].searchParams.get('main_category_id'), `eq.${categories.at(-1).category_id}`);
    assert.equal(requests[1].searchParams.get('limit'), '40');
    assert.equal(result.products[0].priceMinor, product.price_minor);
    assert.equal(result.products[0].unit, product.weight_text);
    assert.equal(result.products[0].observedAt, product.observed_at);
    assert.equal(result.products[0].availability, 'unknown');
  });
}

test('METRO category callers retain explicit smaller limits and the 200-row safety bound', async () => {
  const { client, requests } = catalogFixture('1318', 48);
  const short = await client.rootCategories({ limit: 40 });
  assert.equal(short.categories.length, 40);
  assert.equal(requests[0].searchParams.get('limit'), '40');
  const bounded = await client.rootCategories({ limit: 200 });
  assert.equal(bounded.categories.length, 48);
  assert.equal(requests[1].searchParams.get('limit'), '200');
  const invalid = await client.rootCategories({ limit: 201 });
  assert.equal(invalid.kind, 'error');
  assert.equal(invalid.code, 'invalid_request');
  assert.equal(requests.length, 2, 'oversized requests must be rejected before transport');
});
