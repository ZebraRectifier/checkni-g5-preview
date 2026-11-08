import { test, expect } from '@playwright/test';

const exactStores = [
  { retailer: 'magnit', search: 'Пушкино', id: '502837', address: 'Ярославское', historyKey: 'checkniMagnitShopCode' },
  { retailer: 'globus', search: 'Пушкино', id: '5014', address: 'Красноармейское', historyKey: 'checkniGlobusStoreId' },
  { retailer: 'metro', search: 'Лобня', id: '1318', address: 'Горки Киовские', historyKey: 'checkniMetroStoreNumber' }
];

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.goto('/?comparison=observed&catalog=retail#shop');
});

for (const store of exactStores) {
  test(`${store.retailer}: a network card waits for an explicit exact address and restores it on reload`, async ({ page }) => {
    await page.locator(`.retail-store-card[data-retailer-id="${store.retailer}"]`).click({ noWaitAfter: true });
    const chooser = page.locator('#pixel-address-chooser');
    await expect(chooser).toBeVisible();
    await expect(page.locator('#pixel-store-details')).toBeHidden();
    await expect(page.locator('#pixel-storefront')).toBeHidden();
    await expect(chooser.locator('select:visible')).toHaveCount(0);
    await page.locator(`#${store.retailer}-store-picker input[type="search"]`).fill(store.search);
    await chooser.locator(`[data-store-id="${store.id}"]`).click({ noWaitAfter: true });
    await expect(page.locator('#pixel-storefront')).toBeVisible();
    await expect(page.locator('#pixel-store-details')).toBeVisible();
    await expect(page.locator('.pixel-store-address')).toContainText(store.address);
    await expect(page.locator(`#${store.retailer}-store-address`)).toHaveValue(store.id);
    expect(await page.evaluate(key => history.state?.[key], store.historyKey)).toBe(store.id);
    await page.reload();
    await expect(page.locator('#pixel-storefront')).toBeVisible();
    await expect(page.locator('.pixel-store-address')).toContainText(store.address);
    await expect(page.locator(`#${store.retailer}-store-address`)).toHaveValue(store.id);
  });
}

test('backing out of an unconfirmed address returns to the networks without selecting one', async ({ page }) => {
  const source = page.locator('.retail-store-card[data-retailer-id="magnit"]');
  await source.click({ noWaitAfter: true });
  await expect(page.locator('#pixel-address-chooser')).toBeVisible();
  await expect(page.locator('#pixel-store-details')).toBeHidden();
  await page.locator('#pixel-address-chooser').getByRole('button', { name: 'К сетям' }).click();
  await expect(page.locator('#pixel-address-chooser')).toBeHidden();
  await expect(page.locator('.retail-store-card[data-retailer-id="magnit"]')).toBeVisible();
  await expect(page.locator('#pixel-storefront')).toBeHidden();
  await expect(source).toBeFocused();
});

test('exact-address chooser starts with five cards, expands, and still searches every address', async ({ page }) => {
  const source = page.locator('.retail-store-card[data-retailer-id="magnit"]');
  const select = page.locator('#magnit-store-address');
  const distant = await select.locator('option').evaluateAll(options => {
    const enabled = options.filter(option => option.value && !option.disabled);
    const option = enabled.at(-1);
    return option ? { id: option.value, label: option.textContent } : null;
  });
  expect(distant).not.toBeNull();

  await source.click({ noWaitAfter: true });
  const chooser = page.locator('#pixel-address-chooser');
  const choices = chooser.locator('.pixel-store-address-choice');
  await expect(choices).toHaveCount(5);
  await expect(choices.locator('small')).toHaveText(Array(5).fill('Открыть каталог · дату цен покажем внутри'));

  const showMore = chooser.locator('.pixel-store-address-toggle');
  await expect(showMore).toHaveText('Показать ещё 5');
  await showMore.click();
  await expect(choices).toHaveCount(10);
  await expect(chooser.locator('.pixel-store-address-toggle')).toBeFocused();

  const search = page.locator('#magnit-store-picker input[type="search"]');
  await search.fill(distant.label);
  await expect(choices).toHaveCount(1);
  await expect(chooser.locator(`[data-store-id="${distant.id}"]`)).toBeVisible();
  await expect(chooser.locator('.pixel-store-address-toggle')).toHaveCount(0);
  await expect(search).toBeFocused();
});

test('mobile retry action stays readable when a selected exact catalogue is unavailable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile layout only');
  await page.locator('.retail-store-card[data-retailer-id="magnit"]').click({ noWaitAfter: true });
  const label = await page.locator('#magnit-store-address option[value="777312"]').textContent();
  await page.locator('#magnit-store-picker input').fill(label);
  await page.locator('#pixel-address-chooser [data-store-id="777312"]').click({ noWaitAfter: true });
  const retry = page.locator('.retail-category-retry');
  await expect(retry).toBeVisible();
  expect(await retry.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(150);
});
