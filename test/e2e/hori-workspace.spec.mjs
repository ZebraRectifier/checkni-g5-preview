import { test, expect } from '@playwright/test';
import { openBasket, openHory, closeHory, selectStore, expectNoOverflow } from './helpers/pixel-surface.mjs';

const send = async (page, text) => {
  await openHory(page);
  await page.locator('#basket-proposal-input').fill(text);
  await page.locator('#basket-proposal-submit').click();
};
async function setup(page) {
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', route => route.fulfill({ json: [] }));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await expect(page.locator('#pixel-store-home')).toBeVisible();
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
}

test('fresh visitor chooses stores first; optional Hory retains drafts and basket across theme and navigation', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#pixel-storefront')).toBeHidden();
  await expect(page.locator('#shopping-dialogue-user')).toBeHidden();
  await openHory(page);
  await expect(page.locator('.shopping-welcome')).toContainText('Привет! Я Хоря. Что покупаем?');
  await expect(page.locator('.shopping-welcome')).not.toContainText(/3 человека|7 дней|600/);
  await page.locator('#basket-proposal-input').fill('Молоко, яйца');
  const basket = await page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'));
  await closeHory(page);
  await expect(page.locator('[data-pixel-action="hory"]')).toBeFocused();
  const before = await page.locator('body').getAttribute('data-hori-theme');
  await page.locator('#hori-theme').click();
  await expect(page.locator('body')).not.toHaveAttribute('data-hori-theme', before);
  await openHory(page);
  await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко, яйца');
  await openBasket(page);
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'))).toBe(basket);
  await openHory(page);
  await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко, яйца');
  await expectNoOverflow(page);
});

test('weekly request retains supplied household and duration and asks only the next missing condition', async ({ page }) => {
  let calls = 0;
  await page.route('**/functions/v1/ai-basket-proposal', route => { calls++; return route.abort(); });
  await setup(page);
  await selectStore(page);
  await send(page, 'Нужна недорогая еда на неделю для троих');
  const output = page.locator('#basket-proposal-status');
  await expect(output).toContainText('Где закупаемся');
  await expect(output).not.toContainText(/На сколько человек|На сколько дней/);
  await output.getByRole('button', { name: 'Текущий магазин', exact: true }).click();
  await expect(output).toContainText('Какие продукты исключить');
  await output.getByRole('button', { name: 'Ограничений нет', exact: true }).click();
  await expect(page.locator('#hori-shopping-results').getByRole('table')).toBeVisible();
  await expect(output).toContainText('на 7 дн. для 3 человек');
  await page.locator('#basket-proposal-input').scrollIntoViewIfNeeded();
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  await expectNoOverflow(page);
  expect(calls).toBe(0);
});

test('cold reload restores a usable stores home and the optional composer at reduced height', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.reload();
  await expect(page.locator('#pixel-store-home')).toBeVisible();
  await expect(page.locator('#pixel-storefront')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.setViewportSize({ width: 390, height: 550 });
  await openHory(page);
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  await expect(page.locator('#basket-proposal-submit')).toBeInViewport();
  await expectNoOverflow(page);
});
