import { expect } from '@playwright/test';

// Public retail uses the stores-first shell. Demo fixtures intentionally keep
// the independent manual/assistant flow and do not need a retail selection.
export async function openStores(page) {
  if (!await page.locator('#pixel-store-home').isVisible()) {
    await closeHory(page);
    await page.locator('[data-pixel-action="stores"]').click();
  }
  await expect(page.locator('#pixel-store-home')).toBeVisible();
  await expect(page.locator('#pixel-storefront')).toBeHidden();
}

export async function selectStore(page, retailerId = 'globus') {
  await openStores(page);
  await page.locator(retailerId === 'globus' ? '#retail-store-card' : `#retail-store-card-${retailerId}`).click();
  await expect(page.locator('#pixel-storefront')).toBeVisible();
  await expect(page.locator('#pixel-store-home')).toBeHidden();
}

export async function openHory(page) {
  const dialog = page.locator('#pixel-hory-dialog');
  if (!await dialog.count()) return;
  if (!await dialog.isVisible()) await page.locator('[data-pixel-action="hory"]').click();
  await expect(dialog).toBeVisible();
  await page.locator('#basket-proposal-input').scrollIntoViewIfNeeded();
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
}

export async function closeHory(page) {
  const dialog = page.locator('#pixel-hory-dialog');
  if (await dialog.count() && await dialog.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
}

export async function openStoreDetails(page) {
  const details = page.locator('#pixel-store-details');
  if (await details.count() && !await details.evaluate(node => node.open)) {
    await details.locator(':scope > summary').click();
  }
}

export async function openBasket(page) {
  await closeHory(page);
  await page.locator('[data-pixel-action="basket"]').click();
  await expect(page.locator('#basket-view')).toBeVisible();
}

export function addButton(card) {
  return card.getByRole('button', { name: /^Добавить /u });
}

export async function expectNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
