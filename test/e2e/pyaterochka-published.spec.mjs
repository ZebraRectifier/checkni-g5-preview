import { openHory } from './helpers/pixel-surface.mjs';
import{test,expect}from'@playwright/test';import{readFile}from'node:fs/promises';
import{parsePyatCatalogue}from'../../src/observations/pyaterochkaPublishedPromotions.mjs';
test.setTimeout(60000);
const raw=JSON.parse(await readFile(new URL('../../tests/fixtures/pyaterochka-public/raw-20261018.json',import.meta.url),'utf8'));
const say=async(page,text)=>{await openHory(page);await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
async function isolate(page){
  await page.clock.setFixedTime(new Date('2026-10-18T02:00:00Z'));
  await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await page.route('**/rest/v1/**',r=>r.fulfill({json:[]}));
}
test('food catalogue stays compact, searches actual pack facts and hides expired offers',async({page})=>{
  await isolate(page);let expired=false;
  await page.route('**/src/data/pyaterochkaPublishedPromotions.json',r=>r.fulfill({json:parsePyatCatalogue({...raw,
    ...(expired?{observedAt:'2026-10-17T00:00:00Z'}:{})})}));
  await page.goto('/?comparison=observed&catalog=retail#shop');await page.locator('#retail-store-card-pyaterochka').click();const root=page.locator('#pixel-storefront');await expect(root).toBeVisible();
  await expect(page.locator('#product-grid .product-card')).toHaveCount(24);
  await expect(root).toContainText('цена конкретного магазина');await expect(page.locator('#beta-live-section')).toBeHidden();await expect(page.locator('.okey-directory,#pyaterochka-published')).toHaveCount(0);
  // Literal catalogue search also finds the two confectionery names containing
  // «молоко». The separate shopping path admits only the reviewed adult milk.
  await page.locator('#product-search').fill('молоко');await page.locator('#product-search').press('Enter');await expect(page.locator('#product-grid .product-card')).toHaveCount(6);
  await expect(root).toContainText('925мл');await expect(root).toContainText('94,99');
  expect(await page.locator('#product-grid .product-card').count()).toBe(6);
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  expired=true;await page.reload();
  await expect(page.locator('#empty-search')).toContainText('Свежих цен пока нет');await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
  await expect(root.getByRole('button',{name:'Подобрать часть корзины по акциям',exact:true})).toHaveCount(0);
  expired=false;await root.getByRole('button',{name:'Повторить загрузку',exact:true}).click();await expect(page.locator('#product-grid .product-card')).toHaveCount(24);
});
test('city catalogue → household → partial real-pack table → explicit basket → reload stays out of physical-store and paid-provider claims',async({page})=>{
  await isolate(page);let ai=0;await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
  await page.route('**/src/data/pyaterochkaPublishedPromotions.json',r=>r.fulfill({json:parsePyatCatalogue(raw)}));
  await page.goto('/?comparison=observed&catalog=retail#shop');await page.locator('#retail-store-card-pyaterochka').click();const root=page.locator('#pixel-storefront');await expect(root).toBeVisible();
  await say(page,'Собери недорогую корзину в Пятёрочке');
  await openHory(page);
  const output=page.locator('#basket-proposal-status');await expect(output).toContainText('На сколько человек');
  await say(page,'На троих');await say(page,'На неделю');await expect(output).toContainText('Какие продукты исключить');
  await say(page,'Ограничений нет');const commerce=page.locator('#hori-shopping-results');const table=commerce.getByRole('table');await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table).toContainText('925 мл');await expect(table).toContainText('Гречка');await expect(table).toContainText('Рис');
  await expect(commerce).toContainText('Ещё нужно подобрать: 13 поз.');
  const conditions=commerce.locator('.guided-store-condition');await expect(conditions).toBeVisible();
  await expect(conditions).toContainText('Акции города');await expect(conditions).toContainText('условия карты неизвестны');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  await output.getByRole('button',{name:'Добавить найденное',exact:true}).click();await expect(page.locator('#basket-dock-copy')).toContainText('3 поз.');
  await commerce.getByRole('button',{name:'Открыть корзину',exact:true}).click();await page.reload();
  await expect(page.locator('#basket-view')).toContainText('Му-у');await expect(page.locator('#basket-view')).toContainText('925 мл');
  expect(ai).toBe(0);
});
