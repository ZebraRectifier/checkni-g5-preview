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

test('unknown address restrictions keep the original turn for clarification without lookup or memory writes', async ({ page }) => {
  await isolate(page); let ai = 0, addressCalls = 0;
  await page.route('**/functions/v1/ai-basket-proposal', route => { ai++; return route.abort(); });
  await page.route('**/functions/v1/nearby-address', route => { addressCalls++; return route.abort(); });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page); await openStoreDetails(page);
  await say(page, 'Хочу 12 бутылок кефира');
  await expect(page.locator('#basket-proposal-status')).toContainText('12');
  const needsBefore = await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'));
  const preferencesBefore = await page.evaluate(() => localStorage.getItem('checkni.shopping.preferences.v1'));
  const addressBefore = await page.locator('#nearby-address').inputValue();
  for (const restriction of ['Глютен исключи.', 'Без яиц и глютена.']) {
    const text = `Я живу в Пушкино. ${restriction}`;
    await say(page, text);
    await expect(page.locator('#basket-proposal-input')).toHaveValue(text);
    await expect(page.getByText('Не удалось сохранить ограничение. Уточни его перед сборкой корзины.', { exact: true })).toBeVisible();
    await expect(page.locator('#nearby-address')).toHaveValue(addressBefore);
    expect(await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needsBefore);
    expect(await page.evaluate(() => localStorage.getItem('checkni.shopping.preferences.v1'))).toBe(preferencesBefore);
    await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
    expect(ai).toBe(0); expect(addressCalls).toBe(0);
  }
  await say(page, 'Глютен исключи');
  await expect(page.locator('#basket-proposal-status')).toContainText('Не всё условие удалось понять.');
  await expect(page.locator('#basket-proposal-status')).toContainText('глютен исключи');
  expect(await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needsBefore);
  const unresolvedPreferences = await page.evaluate(() => localStorage.getItem('checkni.shopping.preferences.v1'));
  expect(unresolvedPreferences).not.toMatch(/пушкино/iu);
  const after = JSON.parse(unresolvedPreferences);
  const before = preferencesBefore ? JSON.parse(preferencesBefore) : { facts: {}, rejected: {}, exceptions: {}, wishes: {} };
  expect(after.facts.unresolvedConstraints.value).toContain('глютен исключи');
  expect(after.facts.unresolvedConstraints.value).toEqual(expect.arrayContaining(before.facts.unresolvedConstraints?.value ?? []));
  const afterFacts = { ...after.facts }, beforeFacts = { ...before.facts };
  delete afterFacts.unresolvedConstraints; delete beforeFacts.unresolvedConstraints;
  expect(afterFacts).toEqual(beforeFacts);
  for (const field of ['rejected', 'exceptions', 'wishes']) expect(after[field]).toEqual(before[field]);
  await expect(page.locator('#nearby-address')).toHaveValue(addressBefore);
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  expect(ai).toBe(0); expect(addressCalls).toBe(0);
});

test('long repeated address restrictions are clarified without clearing the input or submitting a blank address', async ({ page }) => {
  await isolate(page); let ai = 0, addressCalls = 0;
  await page.route('**/functions/v1/ai-basket-proposal', route => { ai++; return route.abort(); });
  await page.route('**/functions/v1/nearby-address', route => { addressCalls++; return route.abort(); });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page); await openStoreDetails(page);
  const addressBefore = await page.locator('#nearby-address').inputValue();
  const preferencesBefore = await page.evaluate(() => localStorage.getItem('checkni.shopping.preferences.v1'));
  for (const count of [8, 12]) {
    const text = `Я живу в Пушкино. ${'Морковь не добавляй. '.repeat(count)}`;
    expect(text.length).toBeLessThanOrEqual(300);
    await say(page, text);
    await expect(page.locator('#basket-proposal-input')).toHaveValue(text);
    await expect(page.getByText('Не удалось сохранить ограничение. Уточни его перед сборкой корзины.', { exact: true })).toBeVisible();
    await expect(page.locator('#nearby-address')).toHaveValue(addressBefore);
    expect(await page.evaluate(() => localStorage.getItem('checkni.shopping.preferences.v1'))).toBe(preferencesBefore);
    await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
    expect(ai).toBe(0); expect(addressCalls).toBe(0);
  }
});
