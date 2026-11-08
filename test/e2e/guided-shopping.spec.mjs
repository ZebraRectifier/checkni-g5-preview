import { openHory, closeHory, selectStore, openStoreDetails } from './helpers/pixel-surface.mjs';
import { test, expect } from '@playwright/test';
import { resolveGlobusMoscowRegionStore } from '../../src/data/globusMoscowRegionStores.mjs';

// Controlled transport fixtures prove the complete interaction and arithmetic,
// not live prices. The separate manual preview uses the real catalogue.
const submit = async (page, text) => { await openHory(page); await page.locator('#basket-proposal-input').fill(text); await page.locator('#basket-proposal-submit').click(); };
test('city-only intake preserves household and a mixed pork restriction', async ({ page, context }) => {
  const scopes = [];
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('name')) scopes.push(params.get('store_id'));
    return route.fulfill({ json: products.map(row => ({ ...row,
      name: row.source_product_id === 'mince' ? 'Фарш свиной' : row.name,
      observed_at: new Date().toISOString() })) });
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  const status = page.locator('#basket-proposal-status');
  await submit(page, 'Нужны недорогие продукты на 4 человек на 7 дней');
  await expect(status).toContainText('Где закупаемся');
  await submit(page, 'Москва');
  await expect(status).toContainText('для 4 человек, на 7 дн');
  await submit(page, 'Без свинины, что посоветуешь вместо неё?');
  await expect(status).toContainText('приблизительный ориентир');
  await expect(status).not.toContainText('непонятое ограничение');
  await closeHory(page);
  await selectStore(page);
  scopes.length = 0;
  await submit(page, 'Подобрать товары и цены');
  const commerce = page.locator('#hori-shopping-results');
  await expect(commerce.getByRole('table')).toBeVisible();
  await expect(commerce).toContainText('Фарш Говяжий');
  await expect(commerce).not.toContainText('Фарш свиной');
  expect(scopes.length).toBeGreaterThan(0);
  expect(new Set(scopes)).toEqual(new Set(['eq.globus-store-5011']));
  await status.getByRole('button', { name: /Добавить (найденное|показанное)/u }).click();
  await expect(status).toContainText('Корзина собрана');
  const basket = await page.evaluate(() => JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
  expect(basket.length).toBeGreaterThan(0);
  expect(basket.every(row => row.id.startsWith('retail:globus:globus-store-5011:'))).toBe(true);
  expect(basket.some(row => row.id.endsWith(':mince'))).toBe(false);
  // 4 people × 7 days × 200 ml, rounded up to whole one-litre packages.
  expect(basket.find(row => row.id.endsWith(':milk')).quantity).toBe(6);
});
const products = [
  ['mayo', 'Майонез на перепелином яйце', '400 мл', 12799],
  ['yogurt', 'Йогурт греческий', '250 г', 8799], ['porridge', 'Каша яблоко-корица', '60 г', 9799],
  ['mince', 'Фарш Домашний', '500 г', 24999], ['mince2', 'Фарш Говяжий', '500 г', 31999],
  ['milk', 'Молоко питьевое', '1 л', 9999], ['apples', 'Яблоки свежие', '1 кг', 12999]
].map(([id, name, weight, price]) => ({ retailer_id: 'globus', store_id: 'globus-store-5011', store_name: 'Глобус Красногорск',
  locality_id: 'city-moscow', locality_name: 'Москва', source_product_id: id, name, weight_text: weight,
  price_minor: price, currency: 'RUB', price_condition: 'regular', sales_channel: 'store', minimum_quantity: 1,
  availability: 'unknown', product_url: `https://www.globus.ru/products/${id}`, image_url: null,
  source_url: 'https://www.globus.ru/catalog/food', scope_evidence_url: 'https://www.globus.ru/catalog/food',
  scope_binding: 'same-source', binding_id: 'store:5011', location_label: 'г. Москва, вн.тер.г. муниципальный округ Кунцево, Новорижское шоссе 22-й км, д. 1 стр. 1',
  observed_at: '2026-10-10T08:30:00Z' }));

test('three-turn fish exclusion creates only a confirmable store draft and never calls advice',async({page,context})=>{
  let aiCalls=0;
  await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.route('**/functions/v1/ai-basket-proposal',route=>{aiCalls++;return route.abort();});
  await page.route('**/rest/v1/retail_catalog_categories**',route=>route.fulfill({json:[]}));
  await page.route('**/rest/v1/retail_catalog_items**',route=>route.fulfill({json:[...products,
    {...products[0],source_product_id:'fish',name:'Филе трески',product_url:'https://www.globus.ru/products/fish',price_minor:39999}]
    .map(row=>({...row,observed_at:new Date().toISOString()}))}));
  await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page);
  const status=page.locator('#basket-proposal-status');
  await submit(page,'Собери корзину для двоих на 3 дня');await expect(status).toContainText('Какой общий бюджет');
  await submit(page,'Без лимита');await expect(status).toContainText('Какие продукты исключить');
  await submit(page,'Рыбу исключи. Остальное можно. Собери корзину в выбранном магазине.');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')??'[]'))).toEqual([]);
  await status.getByRole('button',{name:'Подобрать товары и цены',exact:true}).click();
  const table=page.locator('#hori-shopping-results').getByRole('table');await expect(table).toBeVisible();
  await expect(table).not.toContainText(/треск|рыб/iu);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')??'[]'))).toEqual([]);
  expect(aiCalls).toBe(0);
  const add=status.getByRole('button',{name:/Добавить (найденное|показанное)/u});await expect(add).toBeVisible();await add.click();
  const basket=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')??'[]'));
  expect(basket.length).toBeGreaterThan(0);expect(basket.every(row=>!/треск|рыб/iu.test(row.name))).toBe(true);
});

test('switching store during an in-flight guided lookup cannot publish the previous quote', async ({ page, context }) => {
  let releaseOld, oldStarted = 0, oldCompleted = 0;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', async route => {
    const params = new URL(route.request().url()).searchParams;
    const old = params.get('store_id') === 'eq.globus-store-5011';
    const delayed = old && params.has('name');
    if (delayed) { oldStarted++; await oldGate; }
    await route.fulfill({ json: products.map(row => ({ ...row, observed_at: new Date().toISOString(),
      ...(old ? { price_minor: 111 } : { store_id: 'globus-store-5014', store_name: 'Глобус Пушкино',
        locality_id: 'region-moscow-oblast', locality_name: 'Московская область', binding_id: 'store:5014',
        location_label: 'г. Пушкино, Красноармейское ш., вл. 105' }) })) });
    if (delayed) oldCompleted++;
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page);
  await submit(page, 'Нужны недорогие продукты на 4 человек на 7 дней');
  await expect(page.locator('#basket-proposal-status')).toContainText('Какие продукты исключить');
  await submit(page, 'Ограничений нет');
  await expect.poll(() => oldStarted).toBeGreaterThan(0);
  await closeHory(page);
  await openStoreDetails(page);
  await page.locator('#globus-store-address').selectOption('5014');
  releaseOld();
  await expect.poll(() => oldCompleted).toBeGreaterThan(0);
  await openHory(page);
  await expect(page.locator('#hori-shopping-results').getByRole('table')).toHaveCount(0);
  await expect(page.locator('#basket-proposal-status')).not.toContainText('1,11');
  await submit(page, 'Подобрать товары и цены');
  const commerce = page.locator('#hori-shopping-results');
  await expect(commerce.getByRole('table')).toBeVisible();
  await expect(commerce).not.toContainText('1,11');
  await page.locator('#basket-proposal-status').getByRole('button', { name: /Добавить (найденное|показанное)/u }).click();
  await expect(page.locator('#basket-proposal-status')).toContainText('Корзина собрана');
  const basket = await page.evaluate(() => JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
  expect(basket.length).toBeGreaterThan(0);
  expect(basket.every(row => row.id.startsWith('retail:globus:globus-store-5014:'))).toBe(true);
});

test('the user dialogue → intake → editable real-card table → honest comparison → confirmation → reload', async ({ page, context }) => {
  let aiCalls = 0;
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/functions/v1/ai-basket-proposal', route => { aiCalls++; return route.fulfill({ json: {
    kind: 'advice', message: 'Для трёх дней можно взять фарш, молоко и яблоки. Состав подберём под твои предпочтения.' } }); });
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', route => {
    const params = new URL(route.request().url()).searchParams;
    const selected = params.get('store_id') === 'eq.globus-store-5014';
    return route.fulfill({ json: selected ? products.map(row => ({ ...row,
      store_id: 'globus-store-5014', store_name: 'Глобус Пушкино', locality_id: 'region-moscow-oblast', locality_name: 'Московская область',
      binding_id: 'store:5014', location_label: 'г. Пушкино, Красноармейское ш., вл. 105' })) : products });
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page);
  await openStoreDetails(page);
  await page.locator('#globus-store-address').selectOption('5014');
  const output = page.locator('#basket-proposal-status');
  await submit(page, 'хочу качественную еду на 3 дня');
  await expect(output.getByRole('button', { name: 'Собрать корзину', exact: true })).toBeVisible();
  await submit(page, 'Ну собери'); await expect(output).toContainText('На сколько человек');
  await submit(page, 'на 3'); await expect(output).toContainText('общий бюджет');
  await submit(page, '5000'); await expect(output).toContainText('Какие продукты исключить');
  await output.getByRole('button', { name: 'Ограничений нет', exact: true }).click();
  await output.getByRole('button', { name: 'Подобрать товары и цены', exact: true }).click();
  const commerce = page.locator('#hori-shopping-results');
  const table = commerce.getByRole('table'); await expect(table).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table).not.toContainText('Майонез'); await expect(table).not.toContainText('Каша');
  await expect(table).toContainText('249,99 ₽'); await expect(table).toContainText('старое наблюдение');
  await expect(commerce).toContainText('не подтверждает сегодняшнюю стоимость');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  await table.getByText('Изменить: Фарш', { exact: true }).click();
  await table.getByLabel('Количество: Фарш', { exact: true }).fill('3');
  await table.getByRole('button', { name: 'Изменить количество: Фарш', exact: true }).click();
  await expect(table).toContainText('749,97 ₽');
  await table.getByText('Изменить: Фарш', { exact: true }).click();
  await table.getByLabel('Вариант: Фарш', { exact: true }).selectOption('2');
  await expect(table).toContainText('Фарш Говяжий');
  await output.getByRole('button', { name: 'Сравнить этот список', exact: true }).click();
  await expect(commerce.getByLabel('Результат сравнения списка')).toContainText('Недостаточно данных');
  await expect(commerce.getByLabel('Результат сравнения списка')).not.toContainText('Экономия');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  await output.getByRole('button', { name: 'Добавить показанное', exact: true }).click();
  await expect(output).toContainText('Корзина собрана');
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
  expect(snapshot).toHaveLength(3); expect(snapshot.map(row => row.id)).toContain('retail:globus:globus-store-5014:mince2');
  expect(snapshot.find(row => row.id.endsWith(':mince2')).quantity).toBe(3);
  expect(aiCalls).toBe(1);
  await commerce.getByRole('button', { name: 'Открыть корзину', exact: true }).click();
  await expect(page.locator('#basket-content')).toContainText('Фарш Говяжий');
  await page.reload(); await expect(page.locator('#basket-content')).toContainText('Фарш Говяжий');
  await expect(page.locator('#basket-content')).toContainText('Глобус Пушкино');
  await expect(page.locator('#basket-content')).toContainText('Молоко питьевое');
  await page.goBack();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('checkni.surface.basket.v1')))).toEqual(snapshot);
});

test('welcome → inexpensive weekly groceries for three near Zavety Ilyicha → emoji prices → basket and reload', async ({ page, context }) => {
  let paidCalls = 0; const scopes = new Set();
  const groceries = [
    ['mince', 'Фарш Домашний', '500 г'], ['chicken', 'Филе куриное', '500 г'], ['buckwheat', 'Крупа гречневая', '800 г'],
    ['pasta', 'Макароны', '450 г'], ['potatoes', 'Картофель', '1 кг'], ['carrots', 'Морковь', '1 кг'],
    ['onions', 'Лук репчатый', '1 кг'], ['cabbage', 'Капуста белокочанная', '1 кг'], ['milk', 'Молоко', '1 л'],
    ['eggs', 'Яйца куриные', '10 шт'], ['apples', 'Яблоки свежие', '1 кг'], ['bananas', 'Бананы', '1 кг'],
    ['oats', 'Хлопья овсяные', '400 г'], ['oil', 'Масло подсолнечное', '1 л']
  ];
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/functions/v1/ai-basket-proposal', route => { paidCalls++; return route.fulfill({ status: 429, json: { kind: 'unavailable' } }); });
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', route => {
    const params = new URL(route.request().url()).searchParams, storeId = params.get('store_id')?.replace('eq.globus-store-', '');
    const store = resolveGlobusMoscowRegionStore(storeId);
    if (!store) return route.fulfill({ json: [] });
    if (params.has('name')) scopes.add(storeId);
    const rows = groceries.map(([id, name, weight]) => ({ ...products[3], source_product_id: id, name, weight_text: weight,
      ...(['apples', 'bananas', 'potatoes', 'carrots', 'onions'].includes(id)
        ? { quantity_semantics: { packageType: 'weight-by-piece', unitPriceText: '1 кг' } } : {}),
      product_url: `https://www.globus.ru/products/${id}`, store_id: `globus-store-${storeId}`, store_name: store.name,
      locality_id: store.scope === 'moscow-city' ? 'city-moscow' : 'region-moscow-oblast',
      locality_name: store.scope === 'moscow-city' ? 'Москва' : 'Московская область',
      location_label: store.address, binding_id: `store:${storeId}`,
      price_minor: storeId === '5010' ? 10000 : 15000 }));
    return route.fulfill({ json: rows });
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page);
  await openStoreDetails(page);
  await openHory(page);
  const welcome = page.getByRole('region', { name: 'С чего начнём покупки' });
  await expect(welcome).toContainText('Привет! Я Хоря. Что покупаем?');
  await welcome.getByRole('button', { name: 'Собрать корзину', exact: true }).click();
  const output = page.locator('#basket-proposal-status');
  await expect(output).toContainText('На сколько человек');
  await submit(page, 'на 3 да есть морозилка'); await expect(output).toContainText('На сколько дней');
  await output.getByRole('button', { name: 'На неделю', exact: true }).click();
  // The welcome now offers a general place picker; the legacy spoken example
  // remains supported without hard-coding one station into every greeting.
  await submit(page,'Заветы Ильича · до 20 км');
  await expect(output).toContainText('Какие продукты исключить');
  await output.getByRole('button', { name: 'Ограничений нет', exact: true }).click();
  const commerce = page.locator('#hori-shopping-results');
  const table = commerce.getByRole('table');
  // The nearby-store lookup has one explicit 15-second application deadline.
  await expect(table).toBeVisible({timeout:16000}); await expect(table.getByRole('columnheader')).toHaveCount(2);
  await expect(table.getByRole('row')).toHaveCount(14);
  await expect(table).toContainText('🥔 Картофель'); await expect(table).toContainText('🥛 Молоко');
  await expect(table).toContainText('100,00 ₽'); await expect(table).toContainText('старое наблюдение');
  await expect(commerce.getByLabel('Проверенные магазины в радиусе')).toContainText('Глобус Пушкино');
  await expect(commerce.getByLabel('Проверенные магазины в радиусе')).toContainText('Глобус Щелково');
  await expect(table).toContainText('Глобус Королёв'); await expect(commerce).toContainText('частичный охват');
  expect([...scopes].sort()).toEqual(['5001', '5010', '5014']); expect(paidCalls).toBe(0);
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  const overflow = await table.evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
  await output.getByRole('button', { name: 'Добавить показанное', exact: true }).click();
  await commerce.getByRole('button', { name: 'Открыть корзину', exact: true }).click();
  await expect(page.locator('#basket-content')).toContainText('Глобус Королёв');
  await expect(page.locator('#basket-content')).not.toContainText('Изменить адрес Магнит');
  await expect(page.locator('#basket-content')).not.toContainText('Изменить адрес METRO');
  await expect(page.locator('#basket-dock-copy')).toHaveText('13 поз.');
  await expect(page.locator('#basket-content')).toContainText('Фарш Домашний');
  const basket = await page.evaluate(() => JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
  expect(basket).toHaveLength(13); expect(basket.every(row => row.id.startsWith('retail:globus:globus-store-5010:'))).toBe(true);
  await page.reload(); await expect(page.locator('#basket-content')).toContainText('Глобус Королёв');
  await expect(page.locator('#basket-content')).not.toContainText('Изменить адрес Магнит');
  await expect(page.locator('#basket-content')).not.toContainText('Изменить адрес METRO');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('checkni.surface.basket.v1')))).toEqual(basket);
  await page.goBack(); await openHory(page); await expect(welcome).toBeVisible();
  await closeHory(page);
  await page.goForward(); await expect(page.locator('#basket-content')).toContainText('Глобус Королёв');
  await expect(page.locator('#basket-content')).not.toContainText('Изменить адрес Магнит');
});
