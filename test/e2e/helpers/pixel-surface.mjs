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
  await page.locator(retailerId === 'globus' ? '#retail-store-card' : `#retail-store-card-${retailerId}`).click({ noWaitAfter: true });
  if (['magnit', 'globus', 'metro'].includes(retailerId)) {
    const chooser = page.locator('#pixel-address-chooser');
    await expect(chooser).toBeVisible();
    const select = page.locator(`#${retailerId}-store-address`);
    const previous = await select.getAttribute('data-pixel-original-address');
    const option = await select.locator('option').evaluateAll((options, preferred) =>
      options.find(item => item.value === preferred && !item.disabled)?.value
      ?? options.find(item => item.value && !item.disabled)?.value, previous);
    if (!option) throw new Error(`No selectable address for ${retailerId}`);
    const label = await select.locator('option').evaluateAll((options, value) => options.find(o => o.value === value).textContent, option);
    await page.locator(`#${retailerId}-store-picker input[type=search]`).fill(label.replace(/^(?:Москва|МО) · /u, '').replace(/ — [^—]+$/u, ''));
    await chooser.locator(`[data-store-id="${option}"]`).click({ noWaitAfter: true });
  }
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
