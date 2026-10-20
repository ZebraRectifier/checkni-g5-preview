import { test, expect } from '@playwright/test';

// Synthetic transport exercises the real manual-search form and basket store.
// No provider, retailer site, live prices or availability is asserted here.
const products = [
  ['000000000000026730_ST', 'Молоко Parmalat 3,5%, 1л', '1 л', 14199, 'moloko-parmalat-35-1l-26730_ST'],
  ['000000000000754268_ST', 'Рис круглозерный Увелка, 800г', '800 г', 18399, 'ris-kruglozernyj-uvelka-800g-754268_ST']
].map(([id, name, weight, price, slug]) => ({
  retailer_id: 'globus', store_id: 'globus-store-5011', store_name: 'Глобус Красногорск',
  locality_id: 'city-moscow', locality_name: 'Москва', source_product_id: id,
  name, weight_text: weight, price_minor: price, currency: 'RUB',
  price_condition: 'regular', sales_channel: 'store', minimum_quantity: 1,
  availability: 'unknown', main_category_id: 1,
  product_url: `https://www.globus.ru/products/${slug}/`,
  source_url: 'https://www.globus.ru/catalog/food',
  scope_evidence_url: 'https://www.globus.ru/catalog/food', scope_binding: 'same-source',
  binding_id: 'store:5011',
  location_label: 'г. Москва, вн.тер.г. муниципальный округ Кунцево, Новорижское шоссе 22-й км, д. 1 стр. 1',
  observed_at: '2026-10-20T08:30:00Z'
}));

const basketValue = page => page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'));
const search = page => page.getByRole('searchbox', { name: 'Найти продукты', exact: true });
const submit = page => page.locator('#search-form').getByRole('button', { name: 'Найти', exact: true });

async function setup(page, { demo = false } = {}) {
  await page.clock.setFixedTime(new Date('2026-10-20T09:00:00Z'));
  const calls = { gateway: [], retail: [], browse: 0, ai: 0 };
  const gates = new Map();
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await page.route('**/functions/v1/ai-basket-proposal', route => { calls.ai++; return route.abort(); });
  await page.route('**/functions/v1/catalog-search', async route => {
    const query = route.request().postDataJSON().queries[0];
    calls.gateway.push(query);
    if (gates.has(query)) await gates.get(query).promise;
    await route.fulfill({ json: { kind: 'catalog', products: [], partial: false } });
  });
  await page.route('**/rest/v1/retail_catalog_items**', async route => {
    const params = new URL(route.request().url()).searchParams;
    const query = (params.get('name') ?? '').replace(/^ilike\.\*|\*$/gu, '').replaceAll('*', ' ').toLocaleLowerCase('ru-RU');
    if (query) calls.retail.push({ query, retailer: params.get('retailer_id'), store: params.get('store_id') });
    else calls.browse++;
    if (gates.has(query)) await gates.get(query).promise;
    const rows = params.get('retailer_id') === 'eq.globus'
      ? products.filter(product => product.name.toLocaleLowerCase('ru-RU').includes(query)) : [];
    await route.fulfill({ json: rows });
  });
  await page.goto(demo ? '/?comparison=demo#shop' : '/?comparison=observed&catalog=retail#shop');
  await expect(submit(page)).toHaveCount(1);
  await expect(submit(page)).toHaveAttribute('type', 'submit');
  await expect(submit(page)).toBeVisible();
  if (!demo) await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  return {
    calls,
    hold(query) {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      gates.set(query, { promise });
      return () => { gates.delete(query); release(); };
    }
  };
}

test('an unsubmitted retail query is an announced draft, without an empty result or a request', async ({ page }) => {
  const { calls } = await setup(page);
  await search(page).fill('несуществующий товар');
  await expect(page.locator('#catalog-search-prompt')).toBeVisible();
  await expect(page.locator('.catalog-search-prompt-text')).toHaveText('Введите запрос и нажмите «Найти».');
  await expect(page.locator('#empty-search')).toBeHidden();
  await expect(page.locator('#result-count')).toHaveText('—');
  await expect(page.locator('#search-status')).toHaveText('Введите запрос и нажмите «Найти».');
  await expect(page.locator('#search-status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#search-status')).toHaveAttribute('aria-atomic', 'true');
  // Let an accidental input debounce fire; editing must never call either port.
  await page.waitForTimeout(350);
  expect(calls.gateway).toEqual([]);
  expect(calls.retail).toEqual([]);
  expect(calls.ai).toBe(0);
});

test('narrow search retains a usable input, native actions and price information on one row', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const { calls } = await setup(page);
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await search(page).fill('молоко');
    const controls = [search(page), submit(page), page.locator('#catalog-sort'), page.locator('.hori-price-note summary')];
    const boxes = [];
    for (const control of controls) {
      await expect(control).toBeInViewport();
      boxes.push(await control.boundingBox());
    }
    expect(boxes[0].width, `editable text width at ${width}`).toBeGreaterThanOrEqual(48);
    expect(boxes[1].height).toBeGreaterThanOrEqual(44);
    expect(boxes[2].height).toBeGreaterThanOrEqual(44);
    const centres = boxes.map(box => box.y + box.height / 2);
    expect(Math.max(...centres) - Math.min(...centres), `one toolbar row at ${width}`).toBeLessThanOrEqual(1);
    for (let index = 1; index < boxes.length; index++) expect(boxes[index - 1].x + boxes[index - 1].width).toBeLessThanOrEqual(boxes[index].x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#clear-search')).toBeVisible();
  }
  await page.locator('#catalog-sort').selectOption({ label: 'Сначала дешевле' });
  await expect(page.locator('#catalog-sort option:checked')).toHaveText('Сначала дешевле');
  await page.locator('.hori-price-note summary').click();
  await expect(page.locator('#catalog-note')).toBeVisible();
  await page.locator('.hori-price-note summary').click();
  expect(calls.gateway).toEqual([]);
  expect(calls.retail).toEqual([]);
  await submit(page).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  expect(calls.gateway).toEqual(['молоко']);
  expect(calls.ai).toBe(0);
});

test('empty and whitespace submissions never reload the initial catalogue', async ({ page }) => {
  const { calls } = await setup(page);
  const initialBrowse = calls.browse;
  await expect(submit(page)).toBeDisabled();
  await search(page).press('Enter');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  await search(page).fill('   ');
  await expect(submit(page)).toBeDisabled();
  await search(page).press('Enter');
  // Also cover programmatic submission: a disabled button is not the guard.
  await page.locator('#search-form').evaluate(form => form.requestSubmit());
  await expect(page.locator('#catalog-search-prompt')).toBeVisible();
  await expect(page.locator('#empty-search')).toBeHidden();
  await page.waitForTimeout(350);
  expect(calls.browse).toBe(initialBrowse);
  expect(calls.gateway).toEqual([]);
  expect(calls.retail).toEqual([]);
});

for (const method of ['keyboard', 'native input event']) {
test(`${method} clearing offers an explicit route back to the catalogue without an input request`, async ({ page }) => {
  const { calls } = await setup(page);
  await search(page).fill('молоко');
  await submit(page).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  const initialBrowse = calls.browse;
  if (method === 'keyboard') {
    await search(page).press('ControlOrMeta+A');
    await search(page).press('Backspace');
  } else {
    // Native type=search cancellation supplies an empty value and input event.
    await search(page).evaluate(input => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('search', { bubbles: true }));
    });
  }
  await expect(search(page)).toHaveValue('');
  await expect(submit(page)).toBeDisabled();
  await expect(page.locator('#catalog-search-prompt')).toContainText('Введите запрос или вернитесь к каталогу.');
  await expect(page.locator('#empty-search')).toBeHidden();
  await expect(page.locator('#search-status')).toHaveText('Введите запрос или нажмите «Показать каталог».');
  expect(calls.browse).toBe(initialBrowse);
  expect(calls.gateway).toHaveLength(1);
  expect(calls.retail).toHaveLength(1);
  await page.getByRole('button', { name: 'Показать каталог', exact: true }).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  await expect(page.locator('#catalog-search-prompt')).toBeHidden();
  await expect(search(page)).toBeFocused();
  expect(calls.browse).toBe(initialBrowse + 1);
});
}

for (const method of ['button', 'Enter']) {
  test(`native ${method} submission searches once per existing port and shows results`, async ({ page }) => {
    const { calls } = await setup(page);
    await search(page).fill('молоко');
    if (method === 'button') await submit(page).click();
    else await search(page).press('Enter');
    await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
    await expect(page.locator('#product-grid')).toContainText('Молоко Parmalat');
    await expect(page.locator('#search-status')).toHaveText('Найдено товаров: 1');
    await expect(page.locator('#catalog-search-prompt')).toBeHidden();
    await expect(page.locator('#empty-search')).toBeHidden();
    await expect(search(page)).toHaveAttribute('aria-label', 'Найти продукты');
    expect(calls.gateway).toEqual(['молоко']);
    expect(calls.retail).toHaveLength(1);
    expect(calls.retail[0]).toEqual({ query: 'молоко', retailer: 'eq.globus', store: 'eq.globus-store-5011' });
    expect(calls.ai).toBe(0);
  });
}

test('only a completed empty search shows no results; clear restores the initial catalogue and focus', async ({ page }) => {
  const { calls } = await setup(page);
  await search(page).fill('несуществующий товар');
  await expect(page.locator('#empty-search')).toBeHidden();
  await submit(page).click();
  await expect(page.locator('#empty-search')).toBeVisible();
  await expect(page.locator('#empty-search-copy')).toHaveText('В живом каталоге по этому запросу ничего не найдено.');
  await expect(page.locator('#result-count')).toHaveText('0');
  await expect(page.locator('#catalog-search-prompt')).toBeHidden();
  const browseBeforeClear = calls.browse;
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  await expect(page.locator('#empty-search')).toBeHidden();
  await expect(search(page)).toHaveValue('');
  await expect(search(page)).toBeFocused();
  await expect(page.locator('#clear-search')).toBeHidden();
  expect(calls.browse).toBe(browseBeforeClear + 1);
  expect(calls.gateway).toHaveLength(1);
  expect(calls.retail).toHaveLength(1);
});

test('editing cancels a delayed search, duplicate pending submits coalesce, and the basket survives', async ({ page }) => {
  const { calls, hold } = await setup(page);
  await page.locator('#product-grid .product-card').first().getByRole('button').click();
  const savedBasket = await basketValue(page);
  const release = hold('молоко');
  await search(page).fill('молоко');
  await submit(page).click();
  await expect.poll(() => calls.gateway.length + calls.retail.length).toBe(2);
  await search(page).press('Enter');
  expect(calls.gateway).toHaveLength(1);
  expect(calls.retail).toHaveLength(1);
  await search(page).fill('рис');
  await expect(page.locator('#catalog-search-prompt')).toBeVisible();
  const oldResponses = Promise.all([
    page.waitForResponse(response => response.url().includes('/functions/v1/catalog-search')),
    page.waitForResponse(response => response.url().includes('/rest/v1/retail_catalog_items') && new URL(response.url()).searchParams.has('name'))
  ]);
  release();
  await oldResponses;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(search(page)).toHaveValue('рис');
  await expect(page.locator('#catalog-search-prompt')).toBeVisible();
  await expect(page.locator('#empty-search')).toBeHidden();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
  expect(await basketValue(page)).toBe(savedBasket);
  await submit(page).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  await expect(page.locator('#product-grid')).toContainText('Рис круглозерный');
  expect(calls.gateway).toEqual(['молоко', 'рис']);
  expect(calls.retail).toHaveLength(2);
  await page.locator('#open-basket').click();
  await expect(page.locator('#basket-view')).toBeVisible();
  await expect(page.locator('.basket-row')).toHaveCount(1);
  await page.locator('#back-to-shop').click();
  await expect(page.locator('#shop-view')).toBeVisible();
  expect(await basketValue(page)).toBe(savedBasket);
});

test('clearing a pending search restores the catalogue and rejects the late result without changing the basket', async ({ page }) => {
  const { calls, hold } = await setup(page);
  await page.locator('#product-grid .product-card').first().getByRole('button').click();
  const savedBasket = await basketValue(page);
  const release = hold('молоко');
  await search(page).fill('молоко');
  await submit(page).click();
  await expect.poll(() => calls.gateway.length + calls.retail.length).toBe(2);
  const initialBrowse = calls.browse;
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  await expect(search(page)).toHaveValue('');
  await expect(search(page)).toBeFocused();
  expect(calls.browse).toBe(initialBrowse + 1);
  const oldResponses = Promise.all([
    page.waitForResponse(response => response.url().includes('/functions/v1/catalog-search')),
    page.waitForResponse(response => response.url().includes('/rest/v1/retail_catalog_items') && new URL(response.url()).searchParams.has('name'))
  ]);
  release();
  await oldResponses;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(search(page)).toHaveValue('');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  await expect(page.locator('#search-status')).toHaveText('Найдено товаров: 2');
  await expect(page.locator('#catalog-search-prompt')).toBeHidden();
  await expect(page.locator('#empty-search')).toBeHidden();
  expect(calls.gateway).toHaveLength(1);
  expect(calls.retail).toHaveLength(1);
  expect(await basketValue(page)).toBe(savedBasket);
});

test('a retailer change discards the old search and keeps the next request in the selected context', async ({ page }) => {
  const { calls, hold } = await setup(page);
  const release = hold('молоко');
  await search(page).fill('молоко');
  await submit(page).click();
  await expect.poll(() => calls.retail.length).toBe(1);
  await page.locator('.hori-selected-store').click();
  const metroBrowseDone = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/rest/v1/retail_catalog_items')
      && url.searchParams.get('retailer_id') === 'eq.metro'
      && !url.searchParams.has('name');
  });
  await page.locator('#retail-store-card-metro').click();
  await (await metroBrowseDone).finished();
  await expect(page.locator('.hori-selected-store')).toContainText('METRO');
  await expect(search(page)).toHaveValue('');
  // Establish the completed replacement catalogue before releasing Globus.
  // Otherwise a later METRO browse could overwrite an incorrectly applied A.
  await expect(page.locator('#search-status')).toHaveText('Подтверждённых товаров не найдено');
  await expect(page.locator('#empty-search-copy')).toHaveText('В живом каталоге по этому запросу ничего не найдено.');
  await expect(page.locator('#catalog-search-prompt')).toBeHidden();
  const oldResponses = Promise.all([
    page.waitForResponse(response => response.url().includes('/functions/v1/catalog-search')),
    page.waitForResponse(response => response.url().includes('/rest/v1/retail_catalog_items') && new URL(response.url()).searchParams.get('retailer_id') === 'eq.globus')
  ]);
  release();
  await Promise.all((await oldResponses).map(response => response.finished()));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
  await expect(page.locator('#search-status')).toHaveText('Подтверждённых товаров не найдено');
  await expect(page.locator('#empty-search-copy')).toHaveText('В живом каталоге по этому запросу ничего не найдено.');
  await expect(search(page)).toHaveValue('');
  await expect(page.locator('.hori-selected-store')).toContainText('METRO');
  await search(page).fill('рис');
  await submit(page).click();
  await expect(page.locator('#empty-search')).toBeVisible();
  expect(calls.retail.at(-1).retailer).toBe('eq.metro');
  expect(calls.gateway).toEqual(['молоко', 'рис']);
  expect(calls.ai).toBe(0);
});

test('demo input retains local suggestions without calling live search or claiming an empty result', async ({ page }) => {
  const { calls } = await setup(page, { demo: true });
  const initialCount = await page.locator('#product-grid .product-card').count();
  expect(initialCount).toBeGreaterThan(1);
  await search(page).fill('молоко');
  await expect(page.locator('#product-grid')).toContainText('Молоко');
  await expect(page.locator('#catalog-eyebrow')).toHaveText('Демо-подсказки');
  await search(page).fill('несуществующий товар');
  await expect(page.locator('#empty-search')).toBeHidden();
  await expect(page.locator('#catalog-search-prompt')).toBeVisible();
  await page.waitForTimeout(350);
  expect(calls.gateway).toEqual([]);
  expect(calls.retail).toEqual([]);
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(initialCount);
  await expect(page.locator('#catalog-search-prompt')).toBeHidden();
  await expect(search(page)).toBeFocused();
});
