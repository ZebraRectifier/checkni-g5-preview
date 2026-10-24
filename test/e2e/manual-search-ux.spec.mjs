import { test, expect } from '@playwright/test';
import { selectStore, openStores, openStoreDetails, openBasket, openHory, addButton } from './helpers/pixel-surface.mjs';

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

async function setup(page, { demo = false, history = false, unavailable = false } = {}) {
  await page.clock.setFixedTime(new Date('2026-10-20T09:00:00Z'));
  const calls = { gateway: [], retail: [], browse: 0, browseByStore: new Map(), ai: 0 };
  const gates = new Map();
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.route('**/rest/v1/**', route => route.fulfill(unavailable
    ? { status: 503, json: { code: 'controlled_unavailable' } } : { json: [] }));
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
    else {
      calls.browse++;
      const store = params.get('store_id');
      calls.browseByStore.set(store, (calls.browseByStore.get(store) ?? 0) + 1);
    }
    if (gates.has(query)) await gates.get(query).promise;
    let rows = params.get('retailer_id') === 'eq.globus'
      ? products.filter(product => product.name.toLocaleLowerCase('ru-RU').includes(query)) : [];
    if (history && params.get('store_id') !== 'eq.globus-store-5011') rows = [];
    if (history && !query && (params.has('main_category_id') || params.has('category_url'))) {
      rows = rows.filter(product => product === products[0]).map(product => ({ ...product, main_category_id: 3979002 }));
    }
    await route.fulfill({ json: rows });
  });
  if (history) {
    const root = 'https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965';
    const middle = root + '/moloko-i-molochnye-produkty-2978998';
    const categories = [
      { category_id: 10118965, name: 'Молочные продукты, сыр, яйца', parent_id: null, root_id: 10118965, depth: 0, source_url: root, product_count: 2 },
      { category_id: 2978998, name: 'Молоко и молочные продукты', parent_id: 10118965, root_id: 10118965, depth: 1, source_url: middle, product_count: 1 },
      { category_id: 3979002, name: 'Молоко', parent_id: 2978998, root_id: 10118965, depth: 2, source_url: middle + '/moloko-3979002', product_count: 1 }
    ].map(category => ({ retailer_id: 'globus', store_id: 'globus-store-5011', ...category }));
    await page.route('**/rest/v1/retail_catalog_categories**', route => {
      const params = new URL(route.request().url()).searchParams;
      const rows = params.get('retailer_id') !== 'eq.globus' || params.get('store_id') !== 'eq.globus-store-5011' ? []
        : params.get('depth') === 'eq.0' ? categories.slice(0, 1)
          : categories.filter(category => params.get('parent_id') === 'eq.' + category.parent_id);
      return route.fulfill({ json: rows });
    });
  }
  await page.goto(demo ? '/?comparison=demo#shop' : '/?comparison=observed&catalog=retail#shop');
  if (!demo) await selectStore(page);
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

test('narrow search retains usable input, native actions and price information without overlap', async ({ page }) => {
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
    for (const box of boxes.slice(1)) expect(box.height, `action target at ${width}`).toBeGreaterThanOrEqual(44);
    for (let left = 0; left < boxes.length; left++) for (let right = left + 1; right < boxes.length; right++) {
      const a=boxes[left],b=boxes[right];
      const overlapX=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
      const overlapY=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
      expect(overlapX*overlapY, `controls ${left}/${right} overlap at ${width}`).toBeLessThanOrEqual(1);
    }
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
  expect(calls.gateway).toEqual([]);
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
  expect(calls.gateway).toHaveLength(0);
  expect(calls.retail).toHaveLength(1);
  await page.getByRole('button', { name: 'Показать каталог', exact: true }).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  await expect(page.locator('#catalog-search-prompt')).toBeHidden();
  await expect(search(page)).toBeFocused();
  expect(calls.browse).toBe(initialBrowse + 1);
});
}

for (const method of ['button', 'Enter']) {
  test(`native ${method} submission searches the selected retail port once without a global search`, async ({ page }) => {
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
    expect(calls.gateway).toEqual([]);
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
  expect(calls.gateway).toHaveLength(0);
  expect(calls.retail).toHaveLength(1);
});

test('editing cancels a delayed search, duplicate pending submits coalesce, and the basket survives', async ({ page }) => {
  const { calls, hold } = await setup(page);
  await addButton(page.locator('#product-grid .product-card').first()).click();
  const savedBasket = await basketValue(page);
  const release = hold('молоко');
  await search(page).fill('молоко');
  await submit(page).click();
  await expect.poll(() => calls.retail.length).toBe(1);
  await search(page).press('Enter');
  expect(calls.gateway).toHaveLength(0);
  expect(calls.retail).toHaveLength(1);
  await search(page).fill('рис');
  await expect(page.locator('#catalog-search-prompt')).toBeVisible();
  const oldResponses = Promise.all([
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
  expect(calls.gateway).toEqual([]);
  expect(calls.retail).toHaveLength(2);
  await openBasket(page);
  await expect(page.locator('#basket-view')).toBeVisible();
  await expect(page.locator('.basket-row')).toHaveCount(1);
  await page.locator('#back-to-shop').click();
  await expect(page.locator('#shop-view')).toBeVisible();
  expect(await basketValue(page)).toBe(savedBasket);
});

test('clearing a pending search restores the catalogue and rejects the late result without changing the basket', async ({ page }) => {
  const { calls, hold } = await setup(page);
  await addButton(page.locator('#product-grid .product-card').first()).click();
  const savedBasket = await basketValue(page);
  const release = hold('молоко');
  await search(page).fill('молоко');
  await submit(page).click();
  await expect.poll(() => calls.retail.length).toBe(1);
  const initialBrowse = calls.browse;
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  await expect(search(page)).toHaveValue('');
  await expect(search(page)).toBeFocused();
  expect(calls.browse).toBe(initialBrowse + 1);
  const oldResponses = Promise.all([
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
  expect(calls.gateway).toHaveLength(0);
  expect(calls.retail).toHaveLength(1);
  expect(await basketValue(page)).toBe(savedBasket);
});

test('a retailer change discards the old search and keeps the next request in the selected context', async ({ page }) => {
  const { calls, hold } = await setup(page);
  const release = hold('молоко');
  await search(page).fill('молоко');
  await submit(page).click();
  await expect.poll(() => calls.retail.length).toBe(1);
  await openStores(page);
  const metroBrowseDone = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/rest/v1/retail_catalog_items')
      && url.searchParams.get('retailer_id') === 'eq.metro'
      && !url.searchParams.has('name');
  });
  await page.locator('#retail-store-card-metro').click();
  await (await metroBrowseDone).finished();
  await expect(page.locator('#pixel-storefront')).toContainText('METRO');
  await expect(search(page)).toHaveValue('');
  // Establish the completed replacement catalogue before releasing Globus.
  // Otherwise a later METRO browse could overwrite an incorrectly applied A.
  await expect(page.locator('#search-status')).toHaveText('Подтверждённых товаров не найдено');
  await expect(page.locator('#empty-search-copy')).toHaveText('В живом каталоге по этому запросу ничего не найдено.');
  await expect(page.locator('#catalog-search-prompt')).toBeHidden();
  const oldResponses = Promise.all([
    page.waitForResponse(response => response.url().includes('/rest/v1/retail_catalog_items') && new URL(response.url()).searchParams.get('retailer_id') === 'eq.globus')
  ]);
  release();
  await Promise.all((await oldResponses).map(response => response.finished()));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
  await expect(page.locator('#search-status')).toHaveText('Подтверждённых товаров не найдено');
  await expect(page.locator('#empty-search-copy')).toHaveText('В живом каталоге по этому запросу ничего не найдено.');
  await expect(search(page)).toHaveValue('');
  await expect(page.locator('#pixel-storefront')).toContainText('METRO');
  await search(page).fill('рис');
  await submit(page).click();
  await expect(page.locator('#empty-search')).toBeVisible();
  expect(calls.retail.at(-1).retailer).toBe('eq.metro');
  expect(calls.gateway).toEqual([]);
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


for (const categorySearch of [false, true]) {
  test(`basket Back and Forward retain a submitted ${categorySearch ? 'category' : 'root'} search and reload a consistent catalogue`, async ({ page }) => {
    const { calls } = await setup(page, { history: true });
    await addButton(page.locator('#product-grid .product-card').first()).click();
    const savedBasket = await basketValue(page);
    if (categorySearch) {
      const grid = page.locator('#retail-category-grid');
      await grid.getByRole('button', { name: /Молочные продукты, сыр, яйца/ }).click();
      await grid.getByRole('button', { name: /Молоко и молочные продукты/ }).click();
      await grid.getByRole('button', { name: /^Молоко(?:\s|$)/ }).click();
      await expect(page.locator('#retail-category-title')).toHaveText('Молоко');
      await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
    }
    await search(page).fill('молоко');
    await submit(page).click();
    await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
    await expect(page.locator('#product-grid')).toContainText('Молоко Parmalat');
    const browseReads = calls.browse;
    await openBasket(page);
    await page.locator('#back-to-shop').click();
    await expect(search(page)).toHaveValue('молоко');
    await expect(page.locator('#catalog-title')).toHaveText('Результаты поиска');
    await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
    await expect(page.locator('#product-grid')).toContainText('Молоко Parmalat');
    expect(calls.browse).toBe(browseReads);
    expect(calls.retail).toHaveLength(1);
    await page.goForward();
    await expect(page.locator('#basket-view')).toBeVisible();
    expect(await basketValue(page)).toBe(savedBasket);
    await page.goBack();
    await expect(search(page)).toHaveValue('молоко');
    await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
    expect(calls.retail).toHaveLength(1);
    expect(calls.browse).toBe(browseReads);
    await page.reload();
    await expect(search(page)).toHaveValue('');
    await expect(page.locator('#clear-search')).toBeHidden();
    if (categorySearch) {
      await expect(page.locator('#retail-category-title')).toHaveText('Молоко');
      await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
    } else {
      await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
    }
    expect(await basketValue(page)).toBe(savedBasket);
    expect(calls.gateway).toEqual([]);
    expect(calls.ai).toBe(0);
  });
}

test('basket Back retains an unsubmitted search draft without any search request', async ({ page }) => {
  const { calls } = await setup(page, { history: true });
  await addButton(page.locator('#product-grid .product-card').first()).click();
  const savedBasket = await basketValue(page);
  await search(page).fill('молоко');
  await expect(page.locator('#catalog-search-prompt')).toContainText('Найти');
  const browseReads = calls.browse;
  await openBasket(page);
  await page.goBack();
  await expect(search(page)).toHaveValue('молоко');
  await expect(page.locator('#catalog-search-prompt')).toContainText('Найти');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
  expect(calls.retail).toEqual([]);
  expect(calls.gateway).toEqual([]);
  expect(calls.browse).toBe(browseReads);
  expect(await basketValue(page)).toBe(savedBasket);
  await submit(page).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  expect(calls.retail).toHaveLength(1);
  expect(calls.ai).toBe(0);
});

test('a pending search survives basket Back and a later response cannot overwrite the next retailer', async ({ page }) => {
  const { calls, hold } = await setup(page, { history: true });
  await addButton(page.locator('#product-grid .product-card').first()).click();
  const savedBasket = await basketValue(page);
  const firstRelease = hold('молоко');
  await search(page).fill('молоко');
  await submit(page).click();
  await expect.poll(() => calls.retail.length).toBe(1);
  const browseReads = calls.browse;
  await openBasket(page);
  await page.goBack();
  await expect(search(page)).toHaveValue('молоко');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
  expect(calls.retail).toHaveLength(1);
  expect(calls.browse).toBe(browseReads);
  firstRelease();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  await expect(page.locator('#product-grid')).toContainText('Молоко Parmalat');
  const secondRelease = hold('рис');
  await search(page).fill('рис');
  await submit(page).click();
  await expect.poll(() => calls.retail.length).toBe(2);
  await selectStore(page, 'metro');
  await expect(page.locator('#search-status')).toHaveText('Подтверждённых товаров не найдено');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
  const oldResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/rest/v1/retail_catalog_items')
      && url.searchParams.get('retailer_id') === 'eq.globus' && url.searchParams.has('name');
  });
  secondRelease();
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(search(page)).toHaveValue('');
  await expect(page.locator('#clear-search')).toBeHidden();
  await expect(page.locator('#pixel-storefront')).toContainText('METRO');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
  await expect(page.locator('#search-status')).toHaveText('Подтверждённых товаров не найдено');
  expect(calls.retail).toHaveLength(2);
  expect(calls.gateway).toEqual([]);
  expect(calls.ai).toBe(0);
  expect(await basketValue(page)).toBe(savedBasket);
});

test('basket history reloads the selected exact address instead of preserving another store catalogue', async ({ page }) => {
  const { calls } = await setup(page, { history: true });
  await addButton(page.locator('#product-grid .product-card').first()).click();
  const savedBasket = await basketValue(page);
  await openStoreDetails(page);
  await page.locator('#globus-store-address').selectOption('5020');
  await expect.poll(() => calls.browseByStore.get('eq.globus-store-5020')).toBe(1);
  await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
  const firstStoreReads = calls.browseByStore.get('eq.globus-store-5011');
  await openBasket(page);
  await page.evaluate(() => history.go(-2));
  await expect(page.locator('#shop-view')).toBeVisible();
  await expect(page.locator('#globus-store-address')).toHaveValue('5011');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  await expect(search(page)).toHaveValue('');
  await expect(page.locator('#clear-search')).toBeHidden();
  expect(calls.browseByStore.get('eq.globus-store-5011')).toBe(firstStoreReads + 1);
  expect(await basketValue(page)).toBe(savedBasket);
  expect(calls.gateway).toEqual([]);
  expect(calls.ai).toBe(0);
});


test('keyboard content shortcut keeps the current retail search and basket comparison route', async ({ page }) => {
  const { calls } = await setup(page, { history: true, unavailable: true });
  await addButton(page.locator('#product-grid .product-card').first()).click();
  const savedBasket = await basketValue(page);
  await search(page).fill('молоко');
  await submit(page).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  const skip = page.locator('.skip-link[href="#main"]');
  let url = page.url();
  let entries = await page.evaluate(() => history.length);
  await skip.focus();
  await skip.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await expect(search(page)).toHaveValue('молоко');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  await expect(page.locator('#product-grid')).toContainText('Молоко Parmalat');
  await openBasket(page);
  await page.locator('#compare-basket').click();
  const result = page.locator('#comparison-output > .comparison-result:not(.snapshot-result):not(.real-identity-prompt)');
  await expect(result).toBeVisible();
  const resultText = await result.innerText();
  url = page.url();
  entries = await page.evaluate(() => history.length);
  await skip.focus();
  await skip.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page.locator('#basket-view')).toBeVisible();
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => history.length)).toBe(entries);
  expect(await result.innerText()).toBe(resultText);
  expect(await basketValue(page)).toBe(savedBasket);
  expect(calls.retail).toHaveLength(1);
  expect(calls.gateway).toEqual([]);
  expect(calls.ai).toBe(0);
});

test('browser history closes Hory before destination focus and preserves its unsent draft', async ({ page }) => {
  const { calls } = await setup(page, { history: true });
  await addButton(page.locator('#product-grid .product-card').first()).click();
  const savedBasket = await basketValue(page);
  await search(page).fill('молоко');
  await submit(page).click();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  await openBasket(page);
  await openHory(page);
  const input = page.locator('#basket-proposal-input');
  await input.fill('Мой незавершённый список');
  await page.goBack();
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
  await expect(page.locator('#pixel-storefront-title')).toBeFocused();
  await expect(search(page)).toHaveValue('молоко');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
  await expect(page.locator('#product-grid')).toContainText('Молоко Parmalat');
  await openHory(page);
  await expect(input).toHaveValue('Мой незавершённый список');
  await page.goForward();
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
  await expect(page.locator('#basket-title')).toBeFocused();
  await openHory(page);
  await expect(input).toHaveValue('Мой незавершённый список');
  await page.locator('.pixel-dialog-close').click();
  await expect(page.locator('[data-pixel-action="hory"]')).toBeFocused();
  await openHory(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-pixel-action="hory"]')).toBeFocused();
  expect(await basketValue(page)).toBe(savedBasket);
  expect(calls.retail).toHaveLength(1);
  expect(calls.gateway).toEqual([]);
  expect(calls.ai).toBe(0);
});

for (const first of ['globus', 'magnit']) {
  for (const failRestoredRoots of [false, true]) {
    test(`history isolates ${first} collection cards and late replies through ${failRestoredRoots ? 'a root failure and retry' : 'delayed roots and products'}`, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-20T09:00:00Z'));
      const calls = { gateway: 0, ai: 0 };
      await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort());
      await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
      await page.route('**/functions/v1/ai-basket-proposal', route => { calls.ai++; return route.abort(); });
      await page.route('**/functions/v1/catalog-search', route => {
        calls.gateway++;
        return route.fulfill({ json: { kind: 'catalog', products: [], partial: false } });
      });
      const other = first === 'globus' ? 'magnit' : 'globus';
      const names = { globus: 'Глобус', magnit: 'Магнит' };
      const stores = { globus: 'globus-store-5011', magnit: 'magnit-777312' };
      const categoryIds = { globus: 10111111, magnit: 22222 };
      const roots = {
        globus: 'https://www.globus.ru/catalog/gotovaya-eda-10111111',
        magnit: 'https://magnit.ru/catalog/gotovaya-eda/'
      };
      const product = (retailer, kind) => ({
        retailer_id: retailer, store_id: stores[retailer], store_name: names[retailer],
        locality_id: 'city-moscow', locality_name: 'Москва', source_product_id: `${retailer}-${kind}`,
        name: `${kind === 'old' ? 'Старая готовая еда' : kind === 'new' ? 'Новая готовая еда' : 'Обычный товар'} ${names[retailer]}`,
        price_minor: 12300, currency: 'RUB', price_condition: 'regular', availability: 'unknown',
        product_url: retailer === 'globus' ? `https://www.globus.ru/products/${retailer}-${kind}/`
          : `https://magnit.ru/product/${retailer}-${kind}?shopCode=777312`,
        image_url: null, weight_text: '250 г', main_category_id: kind === 'general' ? null : categoryIds[retailer],
        source_url: roots[retailer], observed_at: '2026-10-20T08:30:00Z',
        ...(retailer === 'globus' ? {
          sales_channel: 'store', scope_binding: 'same-source', binding_id: 'store:5011',
          location_label: products[0].location_label, scope_evidence_url: roots.globus
        } : {})
      });
      let releaseOld, releaseRoots, releaseProducts;
      const oldGate = new Promise(resolve => { releaseOld = resolve; });
      const rootGate = new Promise(resolve => { releaseRoots = resolve; });
      const productGate = new Promise(resolve => { releaseProducts = resolve; });
      const rootReads = { globus: 0, magnit: 0 }, collectionReads = { globus: 0, magnit: 0 };
      let restoring = false, oldFulfilled = false;
      await page.route('**/rest/v1/retail_catalog_categories**', async route => {
        const params = new URL(route.request().url()).searchParams;
        const retailer = params.get('retailer_id')?.slice(3);
        let rows = [], status = 200;
        if (retailer in names && params.get('depth') === 'eq.0') {
          const call = ++rootReads[retailer];
          if (retailer === first && call === 2) {
            await rootGate;
            if (failRestoredRoots) status = 503;
          }
          rows = [{ retailer_id: retailer, store_id: stores[retailer], category_id: categoryIds[retailer],
            name: 'Готовая еда', parent_id: null, root_id: categoryIds[retailer], depth: 0,
            source_url: roots[retailer], product_count: 1 }];
        }
        await route.fulfill({ status, json: status === 200 ? rows : { code: 'controlled_unavailable' } });
      });
      await page.route('**/rest/v1/retail_catalog_items**', async route => {
        const params = new URL(route.request().url()).searchParams;
        const retailer = params.get('retailer_id')?.slice(3);
        const scoped = params.has('main_category_id') || params.has('category_url');
        let rows = [], isOldReply = false;
        if (retailer in names) {
          if (scoped) {
            const call = ++collectionReads[retailer];
            if (retailer === first && call === 1) {
              isOldReply = true;
              await oldGate;
              rows = [product(retailer, 'old')];
            } else {
              if (retailer === first && restoring) await productGate;
              rows = [product(retailer, retailer === first ? 'new' : 'old')];
            }
          } else {
            if (retailer === first && restoring) await productGate;
            rows = [product(retailer, 'general')];
          }
        }
        // Exercise a late live reply rather than a request already aborted
        // by the unchanged transport deadline.
        if (isOldReply) expect(route.request().failure()).toBeNull();
        await route.fulfill({ json: rows });
        if (isOldReply) oldFulfilled = true;
      });
      await page.goto('/?comparison=observed&catalog=retail#shop');
      await selectStore(page, first);
      await expect(page.locator(`[data-product-id="retail:${first}:${stores[first]}:${first}-general"]`)).toBeVisible();
      await expect.poll(() => collectionReads[first]).toBe(1);
      await selectStore(page, other);
      const oldOtherCard = page.locator(`#pixel-collections [data-product-id="retail:${other}:${stores[other]}:${other}-old"]`);
      await expect(oldOtherCard).toBeVisible();
      const oldButton = await page.locator('#pixel-collections').getByRole('button', { name: 'Все товары: Вся готовая еда' }).elementHandle();
      restoring = true;
      await page.evaluate(() => history.go(-2));
      await expect.poll(() => rootReads[first]).toBe(2);
      await expect(page.locator('#pixel-storefront-title')).toContainText(names[first]);
      await expect(page.locator('#pixel-collections .pixel-collection')).toHaveCount(0);
      await expect(oldOtherCard).toHaveCount(0);
      expect(await oldButton.evaluate(node => node.isConnected)).toBe(false);
      releaseOld();
      await expect.poll(() => oldFulfilled).toBe(true);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator('#pixel-collections .pixel-collection')).toHaveCount(0);
      releaseRoots();
      if (failRestoredRoots) {
        await expect(page.locator('.retail-category-retry')).toBeVisible();
        await expect(page.locator('#pixel-collections button')).toHaveCount(0);
        releaseProducts();
        await page.locator('.retail-category-retry').click();
      } else {
        await expect.poll(() => collectionReads[first]).toBe(2);
        await expect(page.locator('#pixel-collections .pixel-collection')).toHaveCount(0);
        releaseProducts();
      }
      await expect(page.locator(`#pixel-collections [data-product-id="retail:${first}:${stores[first]}:${first}-new"]`)).toBeVisible();
      await expect(oldOtherCard).toHaveCount(0);
      await expect(page.locator(`#pixel-collections [data-product-id="retail:${first}:${stores[first]}:${first}-old"]`)).toHaveCount(0);
      await page.locator('#pixel-collections').getByRole('button', { name: 'Все товары: Вся готовая еда' }).click();
      await expect.poll(() => page.evaluate(() => history.state.checkniRetailPath.at(-1)?.categoryId)).toBe(categoryIds[first]);
      await expect(page.locator('#retail-category-title')).toHaveText('Готовая еда');
      expect(calls.gateway).toBe(0);
      expect(calls.ai).toBe(0);
    });
  }
}
