import { test, expect } from '@playwright/test';
import { selectStore, openBasket, openHory, closeHory, addButton, expectNoOverflow } from './helpers/pixel-surface.mjs';

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
async function setup(page) {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', route => route.fulfill({ json: [product] }));
  await page.route('**/src/ports/observedOffersPort.mjs', route => route.fulfill({ contentType: 'text/javascript', body: 'export const observedOffersPort={async load(){return [];}};' }));
  await page.route('**/functions/v1/ai-basket-proposal', route => route.abort());
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await expect(page.locator('[data-pixel-action="hory"] .hory-v17-sprite')).toBeVisible();
}

test('Hory responds to interaction and preserves the manual basket flow', async ({ page }, info) => {
  const mobile = info.project.name.includes('mobile');
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 });
  await setup(page);
  await expectNoOverflow(page);
  const launcher = page.locator('[data-pixel-action="hory"]');
  const sprite = launcher.locator('.hory-v17-sprite');
  await expect(sprite).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.hori-cube-field')).toHaveCount(0);
  if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
    await launcher.hover();
    await expect(sprite).toHaveCSS('animation-name', 'hory-v17-peek');
    await expect(sprite).toHaveCSS('animation-iteration-count', '1');
  }
  // Holding the mouse down exercises the actual pressed style before release.
  await launcher.scrollIntoViewIfNeeded();
  const box = await launcher.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(launcher).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 2)');
  await page.mouse.up();
  await openHory(page);
  const identity = page.locator('.pixel-hory-identity .hory-v17-sprite');
  await expect(identity).toHaveAttribute('data-state', 'listening');
  await page.locator('#basket-proposal-input').fill('Хочу собрать корзину на 4 человек');
  await page.locator('#basket-proposal-submit').click();
  await expect(page.locator('#basket-proposal-status')).toContainText('4 чел');
  await expect(identity).toHaveAttribute('data-state', 'clarify');
  await closeHory(page);
  await expect(launcher).toBeFocused();
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
  await openBasket(page);
  await expect(page.locator('#basket-title')).toBeVisible();
  await expect(page.locator('.basket-row')).toHaveCount(1);
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
  await page.goBack();
  await expect(page.locator('#pixel-storefront')).toBeVisible();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  await expectNoOverflow(page);
});

test('Hory semantic poses animate only while open and respect reduced motion', async ({ page }) => {
  await setup(page);
  await openHory(page);
  const identity = page.locator('.pixel-hory-identity .hory-v17-sprite');
  // This boundary is written by setMascotState in the application. Test each
  // supported semantic signal without substituting provider prices or replies.
  for (const [signal, pose] of [['checking','thinking'], ['searching','searching'], ['found','found'], ['partial','clarify']]) {
    await page.locator('.hero-identity').evaluate((node, state) => { node.dataset.mascotState = state; }, signal);
    await expect(identity).toHaveAttribute('data-state', pose);
    await expect(identity).toHaveCSS('animation-name', ['thinking','searching'].includes(pose) ? 'hory-v17-check' : 'none');
  }
  await page.locator('.hero-identity').evaluate(node => { node.dataset.mascotState = 'searching'; });
  await expect(identity).toHaveCSS('animation-name', 'hory-v17-check');
  await closeHory(page);
  await expect(identity).toHaveCSS('animation-name', 'none');
  await openHory(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(identity).toHaveAttribute('data-state', 'searching');
  await expect(identity).toHaveCSS('animation-name', 'none');
  await expect(identity).toHaveCSS('transform', 'none');
  await closeHory(page);
  await page.locator('[data-pixel-action="hory"]').hover();
  await expect(page.locator('[data-pixel-action="hory"] .hory-v17-sprite')).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openHory(page);
  await expect(identity).toHaveCSS('animation-name', 'hory-v17-check');
});
