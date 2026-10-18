import { test, expect } from '@playwright/test';

// Explicit synthetic transport fixture. Live API/price evidence is separate.
const milk = {
  retailer_id: 'metro', store_id: 'metro-address-c5gsqz', store_name: 'METRO · Ленинградское ш. 71Г',
  locality_id: 'city-moscow', locality_name: 'Москва', source_product_id: '241097',
  name: 'Молоко Простоквашино пастеризованное 2.5%, 930мл', weight_text: '930мл',
  price_minor: 10000, currency: 'RUB', price_condition: 'regular', sales_channel: 'online',
  minimum_quantity: 1, availability: 'unknown', main_category_id: 28424,
  product_url: 'https://online.metro-cc.ru/products/moloko-prostokvashino-pasterizovannoye-2-5-930ml',
  image_url: null, source_url: 'https://online.metro-cc.ru/dynamic/moloko-930-ml-2-28424',
  scope_evidence_url: 'https://online.metro-cc.ru/dynamic/moloko-930-ml-2-28424',
  scope_binding: 'same-source', binding_id: 'metro-address-c5gsqz',
  location_label: '125445, г. Москва, Ленинградское ш., д.71Г', observed_at: '2026-10-18T08:30:00Z'
};
async function setup(page) {
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.get('retailer_id') === 'eq.metro' ? [milk] : [] }));
  await page.route('**/src/ports/observedOffersPort.mjs', route => route.fulfill({ contentType:'text/javascript',
    body:'export const observedOffersPort={async load(){return [];}};' }));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await expect(page.locator('.hori-greeting')).toBeVisible();
}

test('reference scene, equal working panes, first entry, address access and theme remain usable', async ({ page }, info) => {
  await setup(page);
  const image = page.locator('.hori-scene img');
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 1000)).toBe(true);
  const box = await image.boundingBox();
  const ai = await page.locator('#basket-proposal-section').boundingBox();
  const commerce = await page.locator('#main').boundingBox();
  expect(Math.abs(ai.height - commerce.height)).toBeLessThanOrEqual(2);
  expect(box.width).toBeGreaterThanOrEqual(info.project.name.includes('mobile') ? 120 : 350);
  expect(box.height).toBeGreaterThanOrEqual(info.project.name.includes('mobile') ? 90 : 300);
  await expect(page.locator('.shopping-welcome')).not.toContainText(/3 человека|7 дней|600/);
  await page.locator('#basket-proposal-input').fill('Молоко и яблоки');
  await page.locator('#hori-theme').click();
  await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко и яблоки');
  await page.locator('.hori-location').click();
  await expect(page.locator('#nearby-address')).toBeVisible();
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:info.outputPath('reference-layout.png') });
  if (info.project.name.includes('mobile')) {
    await page.setViewportSize({ width:390, height:550 });
    await expect(page.locator('#basket-proposal-input')).toBeInViewport();
    await expect(page.locator('#basket-proposal-submit')).toBeInViewport();
  }
});

test('retail catalogue → live basket controls → compare → Back and reload preserves the basket', async ({ page }, info) => {
  await setup(page);
  await page.locator('#retail-store-card-metro').click();
  const card = page.locator('[data-product-id="retail:metro:metro-address-c5gsqz:241097"]');
  await expect(card).toContainText('100,00 ₽');
  await page.locator('#product-search').fill('молоко');
  await page.locator('#product-search').press('Enter');
  await expect(page.locator('#retail-catalog-nav')).toBeHidden();
  await page.locator('#retail-store-card').click();
  await expect(page.locator('#product-search')).toHaveValue('');
  await expect(page.locator('#retail-catalog-nav')).toBeVisible();
  await page.locator('#retail-store-card-metro').click();
  await expect(card).toContainText('100,00 ₽');
  await card.getByRole('button').click();
  await expect(page.locator('#basket-dock-copy')).toContainText('1 шт.');
  if (!info.project.name.includes('mobile')) {
    await expect(page.locator('#hori-basket-preview')).toContainText('Молоко');
    const plus = page.locator('#hori-basket-preview').getByRole('button', { name:/Быстрая корзина: увеличить/ });
    await plus.click();
    await expect(plus).toBeFocused();
    await expect(page.locator('#hori-basket-preview output')).toHaveText('2');
    await expect(card.getByRole('button')).toContainText('2 в корзине');
  }
  await page.locator('#open-basket').click();
  await expect(page.locator('#basket-view')).toBeVisible();
  await expect(page.locator('#hori-basket-preview')).toBeHidden();
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  await page.locator('#compare-basket').click();
  await expect(page.locator('#comparison-output')).toContainText(/недостаточно|нет|не удалось/i);
  const basket = await page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'));
  await page.goBack();
  await expect(page.locator('#shop-view')).toBeVisible();
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'))).toBe(basket);
  await expect(page.locator('.hori-scene img')).toBeVisible();
});

test('active dialogue hides the fresh greeting and keeps its composer and reply in the upper pane', async ({ page }) => {
  await setup(page);
  await page.locator('#basket-proposal-input').fill('Нужна недорогая еда на неделю для троих');
  await page.locator('#basket-proposal-submit').click();
  await expect(page.locator('#basket-proposal-status')).toContainText('Где закупаемся');
  await expect(page.locator('.shopping-welcome')).toBeHidden();
  await expect(page.locator('.hori-greeting')).toBeHidden();
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  await expect(page.locator('#basket-proposal-status')).toBeInViewport();
});
