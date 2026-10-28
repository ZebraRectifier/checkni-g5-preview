import { test, expect } from '@playwright/test';
import { openStoreDetails, selectStore } from './helpers/pixel-surface.mjs';
import { resolveGlobusMoscowRegionStore } from '../../src/data/globusMoscowRegionStores.mjs';

test('Globus address copy shows the latest observed date and never calls old prices current', async ({ page }) => {
  test.setTimeout(75_000);
  const now = Date.now(), metadata = [];
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('select') !== 'retailer_id,store_id,observed_at,price_minor')
      return route.fulfill({ json: [] });
    const storeId = params.get('store_id')?.replace(/^eq\./u, '');
    metadata.push(storeId);
    return route.fulfill({ json: [{ retailer_id: 'globus', store_id: storeId,
      observed_at: new Date(now - (storeId === 'globus-store-5014' ? 8 * 24 * 60 * 60 * 1000 : 5 * 60 * 1000)).toISOString(),
      price_minor: 9999 }] });
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page);
  await openStoreDetails(page);
  const picker = page.locator('#globus-store-address');
  await expect(picker.locator('option:checked')).toContainText('есть недавнее наблюдение');
  await picker.selectOption('5014');
  await expect(picker.locator('option:checked')).toContainText('свежих цен нет');
  await expect(page.locator('#globus-store-note')).toContainText('Свежих цен по адресу нет');
  await expect(page.locator('#globus-store-note')).toContainText('каталог временно не загрузился');
  await expect(page.locator('#globus-store-note')).toContainText(String(new Date(now - 8 * 24 * 60 * 60 * 1000).getUTCFullYear()));
  await picker.selectOption('5020');
  await expect(picker.locator('option:checked')).toContainText('есть недавнее наблюдение');
  await expect(page.locator('#globus-store-note')).toContainText('Другие товары могут быть старее');
  expect(await picker.locator('option').allTextContents()).not.toContainEqual(expect.stringContaining('цены подтверждены'));
  expect(metadata).toEqual(['globus-store-5011', 'globus-store-5014', 'globus-store-5020']);
});

test('loaded Globus categories and products do not show a catalogue failure when only prices are old', async ({ page }) => {
  test.setTimeout(75_000);
  const store = resolveGlobusMoscowRegionStore('5011');
  const observedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const source = 'https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965';
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.route('**/rest/v1/retail_catalog_categories**', route => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: params.get('store_id') === 'eq.globus-store-5011'
      && params.get('depth') === 'eq.0' ? [{ retailer_id: 'globus', store_id: 'globus-store-5011',
        category_id: 10118965, name: 'Молочные продукты, сыр, яйца', parent_id: null,
        root_id: 10118965, depth: 0, source_url: source, product_count: 1 }] : [] });
  });
  await page.route('**/rest/v1/retail_catalog_items**', route => {
    const params = new URL(route.request().url()).searchParams;
    const storeId = params.get('store_id')?.replace(/^eq\./u, '');
    if (params.get('select') === 'retailer_id,store_id,observed_at,price_minor')
      return route.fulfill({ json: [{ retailer_id: 'globus', store_id: storeId,
        observed_at: observedAt, price_minor: 9999 }] });
    return route.fulfill({ json: storeId === 'globus-store-5011' ? [{ retailer_id: 'globus',
      store_id: storeId, store_name: store.name, locality_id: 'city-moscow', locality_name: 'Москва',
      source_product_id: 'loaded-catalogue', name: 'Молоко загруженного каталога', price_minor: 9999,
      currency: 'RUB', price_condition: 'regular', sales_channel: 'store', availability: 'unknown',
      product_url: 'https://www.globus.ru/products/loaded-catalogue', image_url: null, weight_text: '1л',
      main_category_id: 10118965, source_url: source, scope_evidence_url: source,
      scope_binding: 'same-source', binding_id: 'store:5011', location_label: store.address,
      observed_at: observedAt }] : [] });
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page);
  await expect(page.getByRole('button', { name: 'Молочные продукты, сыр, яйца 1 товар · открыть', exact: true })).toBeVisible();
  await expect(page.locator('#product-grid [data-product-id="retail:globus:globus-store-5011:loaded-catalogue"]')).toBeVisible();
  await openStoreDetails(page);
  const note = page.locator('#globus-store-note');
  await expect(note).toContainText('Свежих цен по адресу нет');
  await expect(note).not.toContainText('каталог временно не загрузился');
  await page.locator('#globus-store-address').selectOption('5014');
  await expect(note).toContainText('каталог временно не загрузился');
  await expect(note).toContainText('Свежих цен по адресу нет');
});
