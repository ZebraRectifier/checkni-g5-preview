import { test, expect } from '@playwright/test';
import { selectStore, openBasket, addButton, expectNoOverflow } from './helpers/pixel-surface.mjs';

// Synthetic catalogue only: active animation must not intercept the manual
// shopping path. These are browser tests, not physical Android/FPS evidence.
const product = {
  retailer_id: 'globus', store_id: 'globus-store-5011', store_name: 'Глобус Красногорск',
  locality_id: 'city-moscow', locality_name: 'Москва', source_product_id: '000000000000026730_ST',
  name: 'Молоко Parmalat 3,5%, 1л', weight_text: '1 л', price_minor: 14199,
  currency: 'RUB', price_condition: 'regular', sales_channel: 'store', minimum_quantity: 1,
  availability: 'unknown', main_category_id: 1,
  product_url: 'https://www.globus.ru/products/moloko-parmalat-35-1l-26730_ST/',
  source_url: 'https://www.globus.ru/catalog/food', scope_evidence_url: 'https://www.globus.ru/catalog/food',
  scope_binding: 'same-source', binding_id: 'store:5011',
  location_label: 'г. Москва, вн.тер.г. муниципальный округ Кунцево, Новорижское шоссе 22-й км, д. 1 стр. 1',
  observed_at: '2026-10-20T08:30:00Z'
};
async function setup(page, memory = 8) {
  await page.addInitScript(memory => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => memory });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 8 });
  }, memory);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', route => route.fulfill({ json: [product] }));
  await page.route('**/src/ports/observedOffersPort.mjs', route => route.fulfill({ contentType: 'text/javascript', body: 'export const observedOffersPort={async load(){return [];}};' }));
  await page.route('**/functions/v1/ai-basket-proposal', route => route.abort());
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await expect(page.locator('.hori-cube-field')).toHaveAttribute('data-running', 'true');
}

test('bounded moving cubes pause and preserve the manual basket flow', async ({ page }, info) => {
  const mobile = info.project.name.includes('mobile');
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 });
  await setup(page);
  const expectStableViewport = async () => {
    expect(await page.evaluate(() => innerWidth), 'Motion controls must not widen the layout viewport').toBe(page.viewportSize().width);
    await expectNoOverflow(page);
  };
  await expectStableViewport();
  const field = page.locator('.hori-cube-field'), cubes = page.locator('.hori-cube');
  const motionHost = page.locator('.pixel-motion-host');
  await expect(field).toHaveAttribute('aria-hidden', 'true');
  await expect(cubes).toHaveCount(mobile ? 6 : 10);
  await expect(cubes.first().locator('.hori-cube-face')).toHaveCount(6);
  await expect(field).toHaveCSS('pointer-events', 'none');
  const before = await cubes.first().getAttribute('style');
  await expect.poll(() => cubes.first().getAttribute('style')).not.toBe(before);
  await page.getByRole('button', { name: 'Остановить анимацию фона', exact: true }).click();
  await expect(field).toHaveAttribute('data-running', 'false');
  await expectStableViewport();
  const paused = await cubes.first().getAttribute('style');
  await page.waitForTimeout(120);
  expect(await cubes.first().getAttribute('style')).toBe(paused);
  await page.getByRole('button', { name: 'Включить анимацию фона', exact: true }).click();
  await expect(field).toHaveAttribute('data-running', 'true');
  await expectStableViewport();
  await selectStore(page);
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  await addButton(page.locator('#product-grid .product-card')).click();
  const basketButton = page.locator('[data-pixel-action="basket"]');
  if (!mobile) await basketButton.scrollIntoViewIfNeeded();
  await expect(basketButton).toBeInViewport();
  const hitSamples = await basketButton.evaluate(async button => {
    const samples = [];
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const box = button.getBoundingClientRect();
      const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      samples.push({ ...point, owned: button === hit || button.contains(hit),
        hit: hit ? `${hit.tagName.toLowerCase()}.${hit.className?.baseVal ?? hit.className}` : null });
    }
    return samples;
  });
  for (const sample of hitSamples) {
    expect(sample.owned, `The real list button must receive pointer hits: ${JSON.stringify(sample)}`).toBe(true);
  }
  if (mobile) {
    const stablyOffscreen = await motionHost.evaluate(async host => {
      for (let frame = 0; frame < 3; frame += 1) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const box = host.getBoundingClientRect();
        if (!(box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth)) return false;
      }
      return true;
    });
    if (stablyOffscreen) await expect(field).toHaveAttribute('data-running', 'false');
  }
  await openBasket(page);
  await expect(page.locator('#basket-title')).toBeVisible();
  await expect(page.locator('.basket-row')).toHaveCount(1);
  await expect(field).toBeHidden();
  await expect(field).toHaveAttribute('data-running', 'false');
  await page.goBack();
  await expect(field).toBeVisible();
  await motionHost.scrollIntoViewIfNeeded();
  await expect(motionHost).toBeInViewport();
  await expect(field).toHaveAttribute('data-running', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reduced motion removes cubes and a two-gigabyte device uses four', async ({ page }) => {
  await setup(page, 2);
  await expect(page.locator('.hori-cube')).toHaveCount(4);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.hori-cube')).toHaveCount(0);
  await expect(page.locator('.hori-cube-toggle')).toBeHidden();
  await expect(page.locator('.hori-cube-field')).toHaveAttribute('data-running', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.hori-cube')).toHaveCount(4);
  await expect(page.locator('.hori-cube-field')).toHaveAttribute('data-running', 'true');
});
