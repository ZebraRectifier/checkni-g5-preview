import { test, expect } from '@playwright/test';
import { openStoreDetails, selectStore } from './helpers/pixel-surface.mjs';

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
  await expect(page.locator('#globus-store-note')).toContainText(String(new Date(now - 8 * 24 * 60 * 60 * 1000).getUTCFullYear()));
  await picker.selectOption('5020');
  await expect(picker.locator('option:checked')).toContainText('есть недавнее наблюдение');
  await expect(page.locator('#globus-store-note')).toContainText('Другие товары могут быть старее');
  expect(await picker.locator('option').allTextContents()).not.toContainEqual(expect.stringContaining('цены подтверждены'));
  expect(metadata).toEqual(['globus-store-5011', 'globus-store-5014', 'globus-store-5020']);
});
