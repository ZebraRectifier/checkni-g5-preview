import { test, expect } from '@playwright/test';
import { selectStore, openBasket, openHory, closeHory } from './helpers/pixel-surface.mjs';
const START = Date.parse('2026-10-22T20:00:00.000Z');
const specs = [
  ['241097', 'milk-25-900', 'Молоко Простоквашино пастеризованное 2.5%, 930мл', 'moloko-prostokvashino-pasterizovannoye-2-5-930ml', 10600],
  ['241096', 'kefir-1l', 'Кефир Простоквашино 2.5%, 930г', 'kefir-prostokvashino-25-930g', 11100],
  ['644791', 'butter-825-180', 'Масло сливочное Брест-Литовск 82.5%, 180г', 'brest-litovskoe-825-180g-bzmzh', 22900]
];
function live(spec, observedAt) {
  const [sku, id, name, slug, price] = spec;
  return { sourceId: 'metro-public-live', sourceName: 'METRO · публичный каталог',
    sourceUrl: `https://online.metro-cc.ru/products/${slug}`, observedAt, granularity: 'exact-store',
    locationTruthLevel: 'store', locationId: 'metro:metro-address-c5gsqz', countryCode: 'RU',
    regionId: '77', regionName: 'Москва', localityId: 'moscow', localityName: 'Москва', retailerId: 'metro',
    canonicalProductId: id, sourceProductId: sku, sourceProductName: name, unitPriceMinor: price, currency: 'RUB',
    priceCondition: 'regular', salesChannel: 'online', minimumQuantity: 1, storeId: 'metro-address-c5gsqz',
    storeName: 'METRO · Ленинградское ш. 71Г', locationLabel: '125445, г. Москва, Ленинградское ш., д.71Г', availability: 'unknown' };
}
function row(spec, observedAt) {
  const [sku, , name, slug, price] = spec; const source = `https://online.metro-cc.ru/products/${slug}`;
  return { retailer_id: 'metro', store_id: 'metro-address-c5gsqz', store_name: 'METRO · Ленинградское ш. 71Г',
    locality_id: 'city-moscow', locality_name: 'Москва', source_product_id: sku, name, weight_text: null,
    price_minor: price, currency: 'RUB', price_condition: 'regular', sales_channel: 'online', minimum_quantity: 1,
    quantity_semantics: {}, availability: 'unknown', image_url: null, product_url: source, source_url: source,
    scope_evidence_url: source, scope_binding: 'same-source', binding_id: 'metro-address-c5gsqz',
    location_label: '125445, г. Москва, Ленинградское ш., д.71Г', observed_at: observedAt };
}
const counters = new WeakMap();
async function fixtures(page, state = {}) {
  const counts = { apiFixtures: 0, exactReads: 0, photoFixtures: 0, tileFixtures: 0, aiAttempts: 0, retailerAttempts: 0, blocked: [] };
  counters.set(page, counts);
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(test.info().project.use.baseURL).origin) return route.continue();
    if (url.pathname === '/functions/v1/catalog-photos') {
      counts.photoFixtures++; return route.fulfill({ json: { kind: 'photos', photos: [] } });
    }
    if (url.hostname === 'tile.openstreetmap.org') {
      counts.tileFixtures++; return route.fulfill({ status: 204, body: '' });
    }
    if (url.pathname === '/rest/v1/retail_catalog_categories') {
      counts.apiFixtures++; return route.fulfill({ contentType: 'application/json', body: '[]' });
    }
    if (url.pathname === '/rest/v1/retail_catalog_items') {
      counts.apiFixtures++; const query = url.searchParams;
      if (query.has('source_product_id')) counts.exactReads++;
      const rows = query.get('retailer_id') === 'eq.metro' ? specs.map(spec => row(spec,
        state.catalogAt ?? new Date(START - 12 * 60000).toISOString())) : [];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) });
    }
    if (url.pathname === '/functions/v1/beta-retail-prices') {
      counts.apiFixtures++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        kind: 'insufficient', refreshedAt: new Date(START).toISOString(), offers: state.liveSpecs?.map(index =>
          live(specs[index], state.liveAt ?? new Date(START - 4 * 60000).toISOString())) ?? [] }) });
    }
    if (/ai-basket-proposal|gptunnel|openrouter/u.test(url.href)) counts.aiAttempts++;
    if (/metro-cc\.ru|magnit\.ru|globus\.ru/u.test(url.hostname)) counts.retailerAttempts++;
    counts.blocked.push(url.origin + url.pathname); return route.abort('blockedbyclient');
  });
  await page.clock.install({ time: new Date(START) });
  return counts;
}
async function selectedBasket(page) {
  await page.goto('/?comparison=observed&catalog=retail#shop'); await selectStore(page, 'metro');
  for (const [sku] of specs) await page.locator(`#product-grid [data-product-id="retail:metro:metro-address-c5gsqz:${sku}"] .add-button`).click();
  await openBasket(page); await page.locator('#compare-basket').click();
  await page.getByRole('button', { name: 'Подтвердить товары и сравнить' }).click();
  const result = page.getByLabel('Результат по наблюдаемым ценам');
  await expect(result).toContainText('446,00 ₽'); await expect(result).toContainText('Наличие не подтверждено');
  return result;
}
async function expired(page) {
  await expect(page.locator('#comparison-output')).toContainText('Цены устарели');
  await expect(page.getByLabel('Результат по наблюдаемым ценам')).toHaveCount(0);
  await expect(page.locator('#comparison-output')).not.toContainText('446,00 ₽');
  await expect(page.locator('.basket-summary')).toContainText('3 шт.');
}
async function pause(page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1000));
}
async function runTo(page, timestamp) {
  const now = await page.evaluate(() => Date.now());
  expect(timestamp).toBeGreaterThanOrEqual(now);
  await page.clock.runFor(timestamp - now);
}
test.afterEach(async ({ page }, info) => {
  const counts = counters.get(page); if (!counts) return;
  await info.attach('zero-outbound-receipt', { body: JSON.stringify(counts, null, 2), contentType: 'application/json' });
  expect(counts.aiAttempts).toBe(0); expect(counts.retailerAttempts).toBe(0); expect(counts.blocked).toEqual([]);
});

test('saved 12-minute catalogue prices expire at original hour; manual fresh retry preserves basket', async ({ page }, info) => {
  const state = {}; const counts = await fixtures(page, state); const result = await selectedBasket(page);
  await expect(result).toContainText('Сохранённые цены METRO');
  await expect(result).toContainText('19:48 UTC'); await expect(result).toContainText('1 час от наблюдения');
  await expect(result).not.toContainText('Экономия');
  await page.screenshot({ path: info.outputPath('saved-prices.png'), fullPage: true });
  await pause(page); const reads = counts.exactReads;
  await runTo(page, START + 48 * 60000); await expect(result).toContainText('446,00 ₽');
  await page.clock.runFor(1); await expired(page); expect(counts.exactReads).toBe(reads);
  state.catalogAt = new Date(START + 48 * 60000 + 1).toISOString();
  await page.locator('#compare-basket').click(); await expect(result).toContainText('446,00 ₽');
  expect(counts.exactReads).toBe(reads + 1);
  await page.reload(); await openBasket(page); await expect(page.locator('.basket-summary')).toContainText('3 шт.');
  await expect(page.getByLabel('Результат по наблюдаемым ценам')).toHaveCount(0);
});

test('unmarked live Beta prices retain five minutes and never receive the saved catalogue label', async ({ page }) => {
  const counts = await fixtures(page, { liveSpecs: [0, 1, 2], liveAt: new Date(START).toISOString() });
  await page.goto('/?comparison=observed'); await page.locator('#beta-live-button').click();
  const result = page.getByLabel('Результат по наблюдаемым ценам');
  await expect(result).toContainText('446,00 ₽'); await expect(result).not.toContainText('Сохранённые цены METRO');
  await pause(page); const reads = counts.apiFixtures;
  await runTo(page, START + 300000); await expect(result).toContainText('446,00 ₽');
  await page.clock.runFor(1); await expired(page); expect(counts.apiFixtures).toBe(reads);
});

test('mixed saved catalogue and newer live SKU expire at the earliest five-minute line deadline', async ({ page }) => {
  const counts = await fixtures(page, { liveSpecs: [1] }); const result = await selectedBasket(page);
  await expect(result).toContainText('Сохранённые цены METRO');
  await pause(page); const reads = counts.exactReads;
  await runTo(page, START + 60000); await expect(result).toContainText('446,00 ₽');
  await page.clock.runFor(1); await expired(page); expect(counts.exactReads).toBe(reads);
});

test('focus/pageshow/visibility after paused timers clears expired output without AI or source retry', async ({ page }) => {
  const state = {}; const counts = await fixtures(page, state); await selectedBasket(page);
  await pause(page);
  for (const [index, event] of ['focus', 'pageshow', 'visibilitychange'].entries()) {
    const resumed = START + (index + 1) * 3600001; const reads = counts.exactReads;
    await page.clock.setSystemTime(new Date(resumed));
    await page.evaluate(name => (name === 'visibilitychange' ? document : window).dispatchEvent(new Event(name)), event);
    await expired(page); expect(counts.exactReads).toBe(reads);
    state.catalogAt = new Date(resumed).toISOString(); await page.locator('#compare-basket').click();
    await expect(page.getByLabel('Результат по наблюдаемым ценам')).toContainText('446,00 ₽');
  }
});
