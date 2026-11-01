import { test, expect } from '@playwright/test';
import { openHory, closeHory, selectStore, openStoreDetails, openBasket, addButton, expectNoOverflow } from './helpers/pixel-surface.mjs';

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
  await expect(page.locator('#pixel-store-home')).toBeVisible();
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
}

test('stores-first reference keeps optional Hory draft, theme, address access and a usable short viewport', async ({ page }, info) => {
  await setup(page);
  await openHory(page);
  await expect(page.locator('.shopping-welcome')).not.toContainText(/3 человека|7 дней|600/);
  await page.locator('#basket-proposal-input').fill('Молоко и яблоки');
  await closeHory(page);
  await page.locator('#hori-theme').click();
  await openHory(page);
  await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко и яблоки');
  await closeHory(page);
  await page.locator('.pixel-location').click();
  await expect(page.locator('#nearby-address')).toBeVisible();
  await openHory(page);
  await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко и яблоки');
  await expectNoOverflow(page);
  await page.screenshot({ path:info.outputPath('pixel-optional-hory.png') });
  if (info.project.name.includes('mobile')) {
    await page.setViewportSize({ width:390, height:550 });
    await expect(page.locator('#basket-proposal-input')).toBeInViewport();
    await expect(page.locator('#basket-proposal-submit')).toBeInViewport();
  }
});

test('selected retail catalogue → original basket quantity controls → compare → Back and reload retains the basket', async ({ page }) => {
  await setup(page);
  await selectStore(page, 'metro');
  const card = page.locator('[data-product-id="retail:metro:metro-address-c5gsqz:241097"]');
  await expect(card).toContainText('100,00 ₽');
  await page.locator('#product-search').fill('молоко');
  await page.locator('#product-search').press('Enter');
  await expect(page.locator('#retail-catalog-nav')).toBeHidden();
  await selectStore(page, 'globus');
  await expect(page.locator('#product-search')).toHaveValue('');
  await expect(page.locator('#retail-catalog-nav')).toBeVisible();
  await selectStore(page, 'metro');
  await expect(card).toContainText('100,00 ₽');
  await addButton(card).click();
  await expect(page.locator('#basket-dock-copy')).toContainText('1 шт.');
  await openBasket(page);
  await expect(page.locator('.basket-row')).toContainText('Молоко');
  const plus = page.locator('.basket-row').getByRole('button', { name:/Увеличить количество/ });
  await plus.click();
  await expect(plus).toBeFocused();
  await expect(page.locator('.basket-row .stepper-value')).toHaveText('2');
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
  await page.locator('#compare-basket').click();
  await expect(page.locator('#comparison-output')).toContainText(/недостаточно|нет|не удалось/i);
  const basket = await page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'));
  await page.goBack();
  await expect(page.locator('#shop-view')).toBeVisible();
  await expect(page.locator('#pixel-storefront')).toBeVisible();
  await expect(card.locator('.pixel-quantity')).toHaveText('2');
  await page.reload();
  await expect(page.locator('#pixel-storefront')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'))).toBe(basket);
  await expectNoOverflow(page);
});

test('active optional dialogue hides its fresh welcome and keeps the composer and reply usable', async ({ page }) => {
  await setup(page);
  await selectStore(page);
  await openHory(page);
  await page.locator('#basket-proposal-input').fill('Нужна недорогая еда на неделю для троих');
  await page.locator('#basket-proposal-submit').click();
  await expect(page.locator('#basket-proposal-status')).toContainText('Где закупаемся');
  await expect(page.locator('.shopping-welcome')).toBeHidden();
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  await expect(page.locator('#basket-proposal-status')).toBeInViewport();
  await closeHory(page);
  await expect(page.locator('#pixel-storefront')).toBeVisible();
  await openHory(page);
  await expect(page.locator('#basket-proposal-status')).toContainText('Где закупаемся');
});
