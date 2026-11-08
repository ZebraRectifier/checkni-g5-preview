import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {selectStore, openBasket, expectNoOverflow} from './helpers/pixel-surface.mjs';

const {rows} = JSON.parse(await readFile(new URL('../../tests/fixtures/source-catalog-list-20261107.json', import.meta.url)));
const time = new Date('2026-11-07T07:00:00Z');
const storageKey = 'checkni.surface.basket.v1';
const cardId = row => `retail:${row.retailer_id}:${row.store_id}:${row.source_product_id}`;
const snapshot = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), storageKey);

async function setup(page) {
  const errors = [], requests = [];
  let aiRequests = 0;
  page.on('pageerror', error => errors.push(String(error)));
  await page.clock.install({time});
  await page.route('**/functions/v1/ai-basket-proposal', route => {aiRequests++; return route.abort();});
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({json: []}));
  await page.route('**/rest/v1/**retail_catalog_items**', route => {
    const url = new URL(route.request().url());
    requests.push({retailer: url.searchParams.get('retailer_id'), store: url.searchParams.get('store_id')});
    const selected = rows.filter(row => url.searchParams.get('retailer_id') === `eq.${row.retailer_id}`
      && url.searchParams.get('store_id') === `eq.${row.store_id}`);
    return route.fulfill({json: selected});
  });
  // No quoted offers or paid AI: the retained source fixture tests the actual
  // normalizer/UI/persistence path, not the availability of a live comparison.
  await page.route('**/src/ports/observedOffersPort.mjs', route => route.fulfill({contentType: 'text/javascript',
    body: 'export const observedOffersPort={async load(){return []}};'}));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  return {errors, requests, aiRequests: () => aiRequests};
}

for (const row of rows) {
  test(`${row.retailer_id}: source SKU → quantity → saved list → reload → unknown comparison`, async ({page}) => {
    const evidence = await setup(page);
    await selectStore(page, row.retailer_id);
    const card = page.locator(`[data-product-id="${cardId(row)}"]`);
    await expect(card.locator('.add-button')).toBeEnabled();
    await card.locator('.add-button').click();
    await expect(card.locator('.pixel-quantity')).toHaveText('1');
    await card.locator('.add-button').click();
    await expect(card.locator('.pixel-quantity')).toHaveText('2');
    await openBasket(page);
    const list = page.locator('#basket-content');
    await expect(list).toContainText(row.name);
    await page.getByRole('button', {name: 'Увеличить количество ' + row.name, exact: true}).click();
    const before = await snapshot(page);
    expect(before).toEqual([{id: cardId(row), name: row.name, unit: row.weight_text ?? '170 г', quantity: 3}]);
    const source = list.getByRole('link', {name: 'Источник цены', exact: true});
    await list.locator('.basket-price-details > summary').click();
    await expect(source).toHaveAttribute('href', row.source_url);
    await expect(list).toContainText('Текущая цена и наличие не подтверждены');
    await page.reload();
    await expect(list).toContainText(row.name);
    expect(await snapshot(page)).toEqual(before);
    await expect(page.locator('#compare-basket')).toBeEnabled();
    await page.locator('#compare-basket').click();
    const output = page.locator('#comparison-output');
    await expect(output).toContainText(/Недостаточно|не удалось|Не удалось|не найдены|Нет.*данных/u);
    await expect(output).not.toContainText(/Экономия|Дешевле на|Самый дешёвый/u);
    expect(await snapshot(page)).toEqual(before);
    expect(evidence.requests).toContainEqual({retailer: `eq.${row.retailer_id}`, store: `eq.${row.store_id}`});
    expect(evidence.errors).toEqual([]);
    expect(evidence.aiRequests()).toBe(0);
    await expectNoOverflow(page);
  });
}

test('an already open source card expires at click time while saved quantities survive', async ({page}, testInfo) => {
  const evidence = await setup(page);
  for (const row of rows) {
    await page.clock.setSystemTime(time);
    await selectStore(page, row.retailer_id);
    const card = page.locator(`[data-product-id="${cardId(row)}"]`);
    const add = card.locator('.add-button');
    await expect(add).toBeEnabled();
    await add.click();
    await expect(card.locator('.pixel-quantity')).toHaveText('1');
    const before = await snapshot(page);
    await page.clock.setSystemTime(new Date(Date.parse(row.observed_at) + 24 * 60 * 60 * 1000));
    await add.click();
    await expect(add).toBeDisabled();
    await expect(add).toHaveText('Цена устарела');
    const notice = card.getByRole('status').filter({hasText: 'Обнови каталог'});
    await expect(notice).toHaveText('Обнови каталог, чтобы добавить товар. Список сохранён.');
    expect(await snapshot(page)).toEqual(before);
    await expectNoOverflow(page);
    await notice.scrollIntoViewIfNeeded();
    expect(await notice.evaluate(node => {
      const box = node.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top === node || node.contains(top);
    })).toBe(true);
    await page.screenshot({path: testInfo.outputPath(`expired-${row.retailer_id}.png`)});
  }
  expect((await snapshot(page)).map(item => item.quantity)).toEqual([1, 1, 1]);
  expect(evidence.errors).toEqual([]);
  expect(evidence.aiRequests()).toBe(0);
});
