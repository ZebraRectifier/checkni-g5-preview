import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseOfficialProduct, OFFICIAL_CATALOG_URL, OFFICIAL_SCOPE } from '../../src/observations/okeyOfficialPromotions.mjs';
import { parsePublishedCatalogue, PUBLISHED_URL } from '../../src/observations/okeyPublishedPromotions.mjs';
import { parsePyatCatalogue } from '../../src/observations/pyaterochkaPublishedPromotions.mjs';
import { RETAIL_CATALOG_TIMEOUT_MS } from '../../src/ports/retailCatalogPort.mjs';
import { selectStore } from './helpers/pixel-surface.mjs';

// Synthetic transport only. No retailer, paid provider, stock or live price claim.
const at = '2026-10-18T01:00:00.000Z';
const official = { version: 1, kind: 'okey-official-city-promotions', retailerId: 'okey', sourceUrl: OFFICIAL_CATALOG_URL,
  scope: OFFICIAL_SCOPE, selectedCity: 'Москва', physicalStoreId: null, physicalStoreAddress: null, complete: false,
  observedAt: at, products: [parseOfficialProduct({ name: 'Молоко для проверки 900г', rubles: '82', cents: '59',
    selectedCity: 'Москва', endText: 'Акция действует до 18 октября', observedAt: at,
    productUrl: 'https://www.okmarket.ru/product/fixture_milk/' })] };
const published = parsePublishedCatalogue({ sourceUrl: PUBLISHED_URL, title: 'КАТАЛОГ АКЦИЙ «ОКЕЙ ГИПЕРМАРКЕТ» — МОСКВА',
  period: 'с 15 по 21 октября 2026', observedAt: at,
  products: [{ id: '51922605', name: 'Свинина для проверки 1кг', rubles: '459', cents: '00', endText: 'до 21 октября' }] });
const pyat = parsePyatCatalogue(JSON.parse(await readFile(new URL('../../tests/fixtures/pyaterochka-public/raw-20261018.json', import.meta.url), 'utf8')));
const files = { 'okeyOfficialPromotions.json': official, 'okeyOfficialRefresh.json': { status: 'blocked' },
  'okeyPublishedPromotions.json': published, 'okeyPublishedRefresh.json': { status: 'collected' } };
const milk = { retailer_id: 'magnit', store_id: 'magnit-777312', store_name: 'Магнит', locality_id: 'city-moscow', locality_name: 'Москва',
  source_product_id: '1899800733', name: 'Молоко Простоквашино пастеризованное 2.5% 930мл', weight_text: '930мл', price_minor: 9499,
  currency: 'RUB', price_condition: 'public-online', sales_channel: 'public-store-product-page', availability: 'unknown', main_category_id: 63963,
  product_url: 'https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=777312&shopType=1',
  source_url: 'https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=777312&shopType=1',
  location_label: 'г Москва, аллея Берёзовая, д 17 к 2', observed_at: at };

async function setup(page, { now = '2026-10-18T02:00:00Z', items = [], instrumentMock = false } = {}) {
  await page.clock.install({ time: new Date(now) });
  const calls = { retail: 0, global: 0, ai: 0, beta: 0, files: [], images: 0, external: [] };
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : (calls.external.push(route.request().url()), route.abort()));
  if (instrumentMock) {
    const source = await readFile(new URL('../../src/data/mockCatalog.mjs', import.meta.url), 'utf8');
    const signature = 'export function searchMockCatalog(query, catalog = MOCK_CATALOG) {';
    expect(source).toContain(signature);
    await page.route('**/src/data/mockCatalog.mjs', route => route.fulfill({ contentType: 'text/javascript',
      body: source.replace(signature, signature + '\n  globalThis.__auditMockCalls = (globalThis.__auditMockCalls ?? 0) + 1;') }));
  }
  await page.route('**/rest/v1/**', route => { calls.retail++; return route.fulfill({ json: [] }); });
  await page.route('**/rest/v1/retail_catalog_items**', route => {
    calls.retail++; const retailer = new URL(route.request().url()).searchParams.get('retailer_id');
    return route.fulfill({ json: items.filter(row => 'eq.' + row.retailer_id === retailer) });
  });
  await page.route('**/functions/v1/catalog-search', route => { calls.global++; return route.abort(); });
  await page.route('**/functions/v1/catalog-photos', route => route.fulfill({ json: { kind: 'photos', photos: [] } }));
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//u, route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>' }));
  await page.route('**/functions/v1/ai-basket-proposal', route => { calls.ai++; return route.abort(); });
  await page.route('**/functions/v1/beta-retail-prices', route => { calls.beta++; return route.abort(); });
  await page.route('**/src/data/okey*.json', route => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1); calls.files.push(file);
    return route.fulfill({ json: files[file] ?? {} });
  });
  await page.route('**/src/data/pyaterochkaPublishedPromotions.json', route => {
    calls.files.push('pyaterochkaPublishedPromotions.json'); return route.fulfill({ json: pyat });
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await expect(page.locator('#pixel-store-home')).toBeVisible();
  return calls;
}
const openOkey = async page => {
  await page.locator('#retail-store-card-okey').click();
  const root = page.locator('#okey-official-promotions');
  await expect(root).toHaveJSProperty('open', true); return root;
};
const basketValue = page => page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'));

test('cold stores include existing city catalogues and fold spelling without a data request', async ({ page }) => {
  const calls = await setup(page);
  for (const [query, id] of [['окей', 'okey'], ["o'key", 'okey'], ['пятерочка', 'pyaterochka'], ['Перекресток', 'perekrestok']]) {
    await page.locator('#pixel-store-search').fill(query);
    await expect(page.locator('.retail-store-card:visible')).toHaveCount(1);
    await expect(page.locator('#retail-store-card-' + id)).toBeVisible();
  }
  await page.locator('#pixel-store-search').fill('');
  await expect(page.locator('#retail-store-card-okey')).toContainText('цена в конкретном магазине не подтверждена');
  for (const id of ['okey', 'pyaterochka']) {
    const label = page.locator('#retail-store-card-' + id + ' .retail-store-kicker');
    await expect(label).toHaveText('Акции Москвы');
    expect((await label.boundingBox()).height).toBeGreaterThan(10);
  }
  await page.screenshot({ path: test.info().outputPath('home-catalog-entries.png') });
  await page.waitForTimeout(350);
  expect(calls).toEqual({ retail: 0, global: 0, ai: 0, beta: 0, files: [], images: 0, external: [] });
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
});

test('city catalogue entries preserve a confirmed basket, Hory draft and exact-store selection through rerenders', async ({ page }) => {
  const calls = await setup(page, { items: [milk] });
  await selectStore(page, 'magnit');
  await page.locator('[data-product-id$=":1899800733"]').getByRole('button', { name: /^Добавить /u }).click();
  const before = await basketValue(page);
  await page.locator('[data-pixel-action="hory"]').click(); await page.locator('#basket-proposal-input').fill('Что взять на ужин?');
  await page.keyboard.press('Escape'); await page.locator('[data-pixel-action="stores"]').click();
  const okey = await openOkey(page);
  await expect(okey).toContainText('Свежих действующих наблюдений: 2');
  await expect(okey).toContainText('Прямой сбор с официального сайта приостановлен источником');
  await expect(page.locator('#magnit-store-address')).toHaveValue('777312'); expect(await basketValue(page)).toBe(before);
  await page.locator('[data-pixel-action="stores"]').click(); await page.locator('#retail-store-card-pyaterochka').click();
  await expect(page.locator('#pyaterochka-published')).toContainText('Цена в конкретном магазине');
  await page.locator('[data-pixel-action="stores"]').click(); await selectStore(page, 'magnit');
  await page.locator('[data-pixel-action="stores"]').click();
  await expect(page.locator('#retail-store-card-okey')).toHaveCount(1); await expect(page.locator('#retail-store-card-pyaterochka')).toHaveCount(1);
  await page.locator('[data-pixel-action="hory"]').click(); await expect(page.locator('#basket-proposal-input')).toHaveValue('Что взять на ужин?');
  await page.keyboard.press('Escape'); await page.locator('[data-pixel-action="basket"]').click();
  await page.reload(); await expect(page.locator('#basket-view .basket-row')).toHaveCount(1); expect(await basketValue(page)).toBe(before);
  expect(calls.ai).toBe(0); expect(calls.beta).toBe(0); expect(calls.external).toEqual([]);
});

test('one hung JSON request has a finite deadline, preserves the independent source and permits one explicit retry', async ({ page }) => {
  const calls = await setup(page); let attempt = 0; let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/src/data/okeyOfficialPromotions.json', async route => {
    attempt++; if (attempt === 1) { await gate; return route.abort().catch(() => {}); }
    return route.fulfill({ json: official });
  });
  try {
    const root = await openOkey(page); await expect.poll(() => attempt).toBe(1);
    await expect(root.getByRole('button', { name: 'Обновить каталог', exact: true })).toBeDisabled();
    await page.clock.fastForward(5100);
    await expect(root).toHaveAttribute('aria-busy', 'false'); await expect(root.locator('article')).toHaveCount(1);
    await expect(root).toContainText('Часть каталогов сейчас не обновилась'); await expect(root).toContainText('Свинина для проверки');
    release(); await root.getByRole('button', { name: 'Обновить каталог', exact: true }).click();
    await expect(root.locator('article')).toHaveCount(2); expect(attempt).toBe(2);
    await expect(root).not.toContainText('Часть каталогов сейчас не обновилась');
    expect(calls.ai).toBe(0); expect(calls.external).toEqual([]);
  } finally { release(); }
});

test('the deadline also aborts a stalled response body without dropping another valid source', async ({ page }) => {
  await setup(page);
  await page.evaluate(async data => {
    const { createOkeyOfficialCatalog } = await import('/src/components/OkeyOfficialCatalog.mjs');
    window.auditBodyAborts = 0;
    const root = createOkeyOfficialCatalog({ fetchImpl: async (url, { signal }) => {
      const file = new URL(url).pathname.split('/').at(-1);
      if (file === 'okeyOfficialPromotions.json') return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => { window.auditBodyAborts++; controller.error(new DOMException('Aborted', 'AbortError')); }, { once: true });
      } }), { status: 200 });
      return new Response(JSON.stringify(data[file]), { status: 200 });
    } });
    root.id = 'audit-body-deadline'; document.getElementById('main').append(root); root.open = true;
  }, files);
  const root = page.locator('#audit-body-deadline'); await expect(root).toHaveAttribute('aria-busy', 'true');
  await page.clock.fastForward(5100); await expect(root).toHaveAttribute('aria-busy', 'false');
  await expect(root.locator('article')).toHaveCount(1); expect(await page.evaluate(() => window.auditBodyAborts)).toBe(1);
  await expect(root.getByRole('button', { name: 'Обновить каталог', exact: true })).toBeEnabled();
});

test('an unavailable catalogue recovers explicitly without pretending missing prices are zero', async ({ page }) => {
  const calls = await setup(page); let fail = true;
  await page.route('**/src/data/okey*.json', route => fail ? route.fulfill({ status: 503, json: {} })
    : route.fulfill({ json: files[new URL(route.request().url()).pathname.split('/').at(-1)] ?? {} }));
  const root = await openOkey(page); await expect(root).toContainText('Каталоги сейчас недоступны');
  await expect(root.locator('article')).toHaveCount(0); await expect(root).not.toContainText('0,00');
  fail = false; await root.getByRole('button', { name: 'Обновить каталог', exact: true }).click();
  await expect(root.locator('article')).toHaveCount(2); await expect(root).toContainText('Условия цены уточняйте');
  expect(calls.ai).toBe(0); expect(calls.external).toEqual([]);
});

test('persistent address-service 503 keeps the same consented query ready for an explicit successful retry', async ({ page }) => {
  const calls = await setup(page), requests = [], query = 'Москва, Тверская, 7';
  await page.route('**/functions/v1/nearby-address', route => {
    requests.push(route.request().postDataJSON());
    return requests.length <= 2 ? route.fulfill({ status: 503, json: { version: 1, error: 'source_unavailable' } })
      : route.fulfill({ json: { version: 1, candidates: [{ lat: 55.759, lon: 37.61, label: query, precision: 'house' }] } });
  });
  await page.locator('.pixel-location').click();
  await page.locator('#nearby-address').fill(query); expect(requests).toEqual([]);
  await page.locator('#nearby-address-search').click();
  await expect(page.locator('#nearby-status')).toHaveText('Сервис поиска адресов временно недоступен. Попробуй ещё раз или выбери точку на карте.');
  await expect(page.locator('#nearby-status')).not.toContainText('Адрес не удалось найти');
  await expect(page.locator('#nearby-address')).toHaveValue(query);
  await expect(page.locator('#nearby-address-search')).toBeEnabled();
  await page.locator('.nearby-extra > summary').click();
  await expect(page.locator('#nearby-shopping').getByRole('button', { name: 'Выбрать точку на карте', exact: true })).toBeVisible();
  await page.locator('#nearby-address-search').click();
  await expect(page.locator('#nearby-status')).toHaveText('Это нужное место? Выбери один из адресов.');
  await expect(page.locator('#nearby-address-candidates').getByRole('button', { name: query, exact: true })).toBeVisible();
  expect(requests).toEqual([{ query, consent: true }, { query, consent: true }, { query, consent: true }]);
  await expect(page.locator('#nearby-status')).not.toContainText('сохранён');
  expect(calls.ai).toBe(0); expect(calls.external).toEqual([]);
});

test('a successful empty address lookup keeps the search guidance instead of reporting a service outage', async ({ page }) => {
  const calls = await setup(page), requests = [], query = 'Москва, Несуществующая улица, 7';
  await page.route('**/functions/v1/nearby-address', route => {
    requests.push(route.request().postDataJSON()); return route.fulfill({ json: { version: 1, candidates: [] } });
  });
  await page.locator('.pixel-location').click();
  await page.locator('#nearby-address').fill(query); await page.locator('#nearby-address-search').click();
  await expect(page.locator('#nearby-status')).toHaveText('Адрес не удалось найти. Добавь город и номер дома или укажи место на карте.');
  await expect(page.locator('#nearby-status')).not.toContainText(/сервис|недоступен|сохранён/iu);
  await expect(page.locator('#nearby-address-candidates')).toBeEmpty();
  await expect(page.locator('#nearby-address')).toHaveValue(query); await expect(page.locator('#nearby-address-search')).toBeEnabled();
  expect(requests).toEqual([{ query, consent: true }]); expect(calls.ai).toBe(0); expect(calls.external).toEqual([]);
});

test('Moscow midnight hides expired promotions while the other source retains its own date and unknown conditions', async ({ page }) => {
  await setup(page, { now: '2026-10-18T20:59:30Z' }); const root = await openOkey(page);
  await expect(root.locator('article')).toHaveCount(2); await page.clock.fastForward(61_000);
  await expect(root.locator('article')).toHaveCount(1); await expect(root).not.toContainText('Молоко для проверки');
  await expect(root).toContainText('Прошопер: проверено 18.10.2026');
  await expect(root).toContainText('наличие и условия О’КАРТЫ / без карты не подтверждены');
});

test('the Okey address disclosure stays readable in both pixel themes and fits the viewport', async ({ page }) => {
  await setup(page);
  await page.locator('[data-retailer-id="okey"]').click();
  const directory = page.locator('.okey-directory'); await directory.scrollIntoViewIfNeeded();
  for (const theme of ['dark', 'light']) {
    if (await page.locator('body').getAttribute('data-hori-theme') !== theme) await page.locator('#hori-theme').click();
    const ratios = () => directory.evaluate(root => {
      const rgb = value => value.match(/[\d.]+/gu).slice(0, 3).map(Number);
      const luminance = value => rgb(value).map(v => { const x = v / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
      const background = luminance(getComputedStyle(root).backgroundColor);
      return [...root.querySelectorAll('summary strong,h3,li a,li span,.okey-directory-note')].map(node => {
        const foreground = luminance(getComputedStyle(node).color); return { text: node.textContent.slice(0, 35), color: getComputedStyle(node).color,
          background: getComputedStyle(root).backgroundColor, ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
      });
    });
    await expect.poll(async () => Math.min(...(await ratios()).map(row => row.ratio))).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await directory.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`okey-${theme}.png`) });
  }
});

for (const failure of ['503', 'timeout', 'empty']) {
  test(`public manual search distinguishes ${failure} and preserves the selected store, basket and query without global/MOCK fallback`, async ({ page }) => {
    const calls = await setup(page, { items: [milk], instrumentMock: true }), requests = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/rest/v1/retail_catalog_items**', async route => {
      const params = new URL(route.request().url()).searchParams;
      if (!params.has('name')) return route.fulfill({ json: [milk] });
      requests.push({ query: params.get('name'), retailer: params.get('retailer_id'), store: params.get('store_id') });
      if (requests.length === 1 && failure === 'timeout') { await gate; return route.abort().catch(() => {}); }
      if (requests.length === 1 && failure === '503') return route.fulfill({ status: 503, json: [] });
      return route.fulfill({ json: failure === 'empty' ? [] : [milk] });
    });
    try {
      await selectStore(page, 'magnit');
      await page.locator('[data-product-id$=":1899800733"]').getByRole('button', { name: /^Добавить /u }).click();
      const before = await basketValue(page), input = page.locator('#product-search');
      const submit = page.locator('#search-form').getByRole('button', { name: 'Найти', exact: true });
      await input.fill('молоко'); await submit.click(); await expect.poll(() => requests.length).toBe(1);
      if (failure === 'timeout') {
        await expect(page.locator('#search-status')).toHaveText('Ищем товары в живом каталоге');
        await page.clock.fastForward(RETAIL_CATALOG_TIMEOUT_MS + 100);
      }
      await expect(page.locator('#empty-search')).toBeVisible();
      await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
      if (failure === 'empty') {
        await expect(page.locator('#search-status')).toHaveText('Подтверждённых товаров не найдено');
        await expect(page.locator('#empty-search-copy')).toHaveText('В живом каталоге по этому запросу ничего не найдено.');
        await expect(page.locator('#catalog-eyebrow')).toHaveText('Живой каталог · Магнит');
        await expect(page.locator('#catalog-eyebrow')).not.toContainText('Open Food Facts');
      } else {
        await expect(page.locator('#search-status')).toHaveText('Живой каталог временно недоступен');
        await expect(page.locator('#empty-search-copy')).toHaveText('Живой каталог сейчас не загрузился. Попробуйте ещё раз.');
        await expect(page.locator('#catalog-eyebrow')).toHaveText('Живой каталог недоступен');
        await expect(page.locator('#empty-search-copy')).not.toContainText('ничего не найдено');
      }
      await expect(input).toHaveValue('молоко'); await expect(submit).toBeEnabled();
      await expect(page.locator('#magnit-store-address')).toHaveValue('777312'); expect(await basketValue(page)).toBe(before);
      expect(requests).toHaveLength(1); expect(calls.global).toBe(0); expect(calls.ai).toBe(0);
      expect(await page.evaluate(() => globalThis.__auditMockCalls ?? 0)).toBe(0);
      if (failure !== 'empty') {
        release(); await submit.click();
        await expect(page.locator('#product-grid [data-product-id$=":1899800733"]')).toBeVisible();
        await expect(page.locator('#search-status')).toHaveText('Найдено товаров: 1');
        await expect(page.locator('#empty-search')).toBeHidden();
        await expect(input).toHaveValue('молоко'); await expect(page.locator('#magnit-store-address')).toHaveValue('777312');
        expect(await basketValue(page)).toBe(before); expect(requests).toHaveLength(2);
      }
      expect(requests.every(row => row.query === 'ilike.*молоко*' && row.retailer === 'eq.magnit' && row.store === 'eq.magnit-777312')).toBe(true);
      expect(calls.global).toBe(0); expect(calls.ai).toBe(0); expect(calls.external).toEqual([]);
      expect(await page.evaluate(() => globalThis.__auditMockCalls ?? 0)).toBe(0);
    } finally { release(); }
  });
}

test('the served CSP permits the admitted Yandex food image without widening scripts or connection policy', async ({ page }) => {
  const image = 'https://avatars.mds.yandex.net/get-eda/1/audit-image/500x500';
  const productUrl = 'https://eda.yandex.ru/retail/perekrestok/product/fixture';
  const row = { retailer_id: 'perekrestok', store_id: 'perekrestok-yandex-3186917', store_name: 'Перекрёсток', locality_id: 'city-moscow',
    locality_name: 'Москва', source_product_id: '10001', name: 'Молоко для проверки 1л', weight_text: '1л', price_minor: 9999, currency: 'RUB',
    price_condition: 'yandex-eda-regular', sales_channel: 'delivery', availability: 'unknown', main_category_id: 1,
    product_url: productUrl, source_url: productUrl, image_url: image, observed_at: at };
  const calls = await setup(page, { items: [row] });
  await page.route('https://avatars.mds.yandex.net/**', route => { calls.images++; return route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="white"/></svg>' }); });
  await page.locator('#retail-store-card-perekrestok').click();
  const card = page.locator('#product-grid [data-product-id$=":10001"]'); await expect(card).toBeVisible(); await card.scrollIntoViewIfNeeded();
  await expect(card.locator('img')).toHaveAttribute('src', image);
  await expect.poll(() => card.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("script-src 'self';"); expect(policy).not.toContain('unsafe-inline'); expect(policy).not.toContain('https://*');
  expect(calls.images).toBeGreaterThan(0); expect(calls.external).toEqual([]); expect(calls.ai).toBe(0);
});
