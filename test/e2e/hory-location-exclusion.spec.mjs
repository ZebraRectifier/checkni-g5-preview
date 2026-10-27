import { test, expect } from '@playwright/test';
import { openHory, closeHory, selectStore, openStoreDetails } from './helpers/pixel-surface.mjs';

test.setTimeout(60000);
const say = async (page, text) => {
  await openHory(page);
  await page.locator('#basket-proposal-input').fill(text);
  await page.locator('#basket-proposal-submit').click();
};
async function isolate(page) {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
}

test('address plus food refusal separates geocoder text and remembers the constraint without a draft', async ({ page }) => {
  await isolate(page); let ai = 0, addressCalls = 0;
  await page.route('**/functions/v1/ai-basket-proposal', route => { ai++; return route.abort(); });
  await page.route('**/functions/v1/nearby-address', route => {
    addressCalls++;
    expect(route.request().postDataJSON()).toEqual({ query: 'в Пушкино, Московская область', consent: true });
    return route.fulfill({ json: { version: 1, candidates: [] } });
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page); await openStoreDetails(page);
  await say(page, 'Я живу в Пушкино, Московская область, до 20 км. Морковь не добавляй.');
  await expect(page.locator('#nearby-address')).toHaveValue('в Пушкино, Московская область');
  await expect(page.locator('#nearby-radius')).toHaveValue('20');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).toContain('carrots'); expect(stored).not.toContain('Пушкино');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  await expect(page.locator('#basket-proposal-status').getByRole('button', { name: 'Добавить найденное' })).toHaveCount(0);
  expect(ai).toBe(0); expect(addressCalls).toBe(0);
  await closeHory(page); await openStoreDetails(page);
  await page.locator('#nearby-address-search').click(); expect(addressCalls).toBe(1);
  await page.reload();
  const persisted = await page.evaluate(() => localStorage.getItem('checkni.shopping.preferences.v1'));
  expect(persisted).toContain('carrots'); expect(persisted).not.toContain('Пушкино');
});

test('a separate food refusal while awaiting location is not treated as an address', async ({ page }) => {
  await isolate(page); let ai = 0;
  await page.route('**/functions/v1/ai-basket-proposal', route => { ai++; return route.abort(); });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page); await openStoreDetails(page);
  await say(page, 'Собери недорогую корзину на неделю для троих');
  await say(page, 'Морковь не добавляй');
  const stored = await page.evaluate(() => localStorage.getItem('checkni.shopping.preferences.v1'));
  expect(stored).toContain('carrots');
  await expect(page.locator('#nearby-address')).not.toHaveValue('Морковь не добавляй');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  expect(ai).toBe(0);
});
