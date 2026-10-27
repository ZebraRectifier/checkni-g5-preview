import { test, expect } from '@playwright/test';

const submit = async (page, text) => {
  await page.locator('#basket-proposal-input').fill(text);
  await page.locator('#basket-proposal-submit').click();
};
const basket = page => page.evaluate(() => JSON.parse(localStorage.getItem('checkni.surface.basket.v1') ?? '[]'));

test('a similar spelling is reviewed and never silently added, including a mixed list', async ({ page }) => {
  let providerCalls = 0;
  await page.route('**/functions/v1/ai-basket-proposal', route => { providerCalls++; return route.abort(); });
  await page.goto('/');
  await submit(page, '2 бутылки кефира, хлеб, 3 пачки тофу');
  const status = page.locator('#basket-proposal-status');
  await expect(status).toContainText('только похожее название');
  await expect(status).toContainText('тофу');
  await expect(status).toContainText('Кофе растворимый');
  expect(await basket(page)).toEqual([]);
  await expect(status.getByRole('button', { name: 'Да, выбрать предложенное', exact: true })).toBeVisible();
  expect(providerCalls).toBe(0);
  await submit(page, 'нет, тофу');
  expect((await basket(page)).some(row => row.id === 'instant-coffee-100')).toBe(false);
});

test('a successful add tells the truth and yes does not repeat the operation', async ({ page }) => {
  await page.goto('/');
  await submit(page, 'хочу 12 бутылок кефира');
  const status = page.locator('#basket-proposal-status');
  await expect(status).toContainText('Добавлено в список');
  expect((await basket(page))[0].quantity).toBe(12);
  await submit(page, 'да');
  await expect(status).toContainText('Изменение уже выполнено');
  await expect(status).toContainText('×12');
  await submit(page, 'да!');
  await expect(status).toContainText('Изменение уже выполнено');
  expect((await basket(page))[0].quantity).toBe(12);
  await page.reload();
  expect((await basket(page))[0].quantity).toBe(12);
});
