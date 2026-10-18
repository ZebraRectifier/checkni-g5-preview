import{test,expect}from'@playwright/test';import{readFile}from'node:fs/promises';
import{parsePyatCatalogue}from'../../src/observations/pyaterochkaPublishedPromotions.mjs';
test.setTimeout(60000);
const raw=JSON.parse(await readFile(new URL('../../tests/fixtures/pyaterochka-public/raw-20261018.json',import.meta.url),'utf8'));
const say=async(page,text)=>{await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
async function isolate(page){
  await page.clock.setFixedTime(new Date('2026-10-18T02:00:00Z'));
  await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await page.route('**/rest/v1/**',r=>r.fulfill({json:[]}));
}
test('food catalogue stays compact, searches actual pack facts and hides expired offers',async({page})=>{
  await isolate(page);let expired=false;
  await page.route('**/src/data/pyaterochkaPublishedPromotions.json',r=>r.fulfill({json:parsePyatCatalogue({...raw,
    ...(expired?{observedAt:'2026-10-17T00:00:00Z'}:{})})}));
  await page.goto('/?comparison=observed&catalog=retail#shop');const root=page.locator('#pyaterochka-published');
  await root.locator('summary').click();await expect(root).toContainText('160 продуктов');
  await expect(root.locator('article')).toHaveCount(8);await expect(root).toContainText('Цена в конкретном магазине');
  // Literal catalogue search also finds the two confectionery names containing
  // «молоко». The separate shopping path admits only the reviewed adult milk.
  await page.locator('#pyat-published-search').fill('молоко');await expect(root.locator('article')).toHaveCount(6);
  await expect(root).toContainText('925мл');await expect(root).toContainText('94,99');
  await expect(root.locator('a[href^="https://mos.proshoper.ru/actions/pyaterochka/moskva/#id_product_"]')).toHaveCount(6);
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  expired=true;await page.reload();await root.locator('summary').click();
  await expect(root).toContainText('Свежего каталога сейчас нет');await expect(root.locator('article')).toHaveCount(0);
  await expect(root.getByRole('button',{name:'Подобрать часть корзины по акциям',exact:true})).toHaveCount(0);
  expired=false;await root.getByRole('button',{name:'Обновить каталог',exact:true}).click();await expect(root).toContainText('160 продуктов');
});
test('city catalogue → household → partial real-pack table → explicit basket → reload stays out of physical-store and paid-provider claims',async({page})=>{
  await isolate(page);let ai=0;await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
  await page.route('**/src/data/pyaterochkaPublishedPromotions.json',r=>r.fulfill({json:parsePyatCatalogue(raw)}));
  await page.goto('/?comparison=observed&catalog=retail#shop');const root=page.locator('#pyaterochka-published');await root.locator('summary').click();
  await root.getByRole('button',{name:'Подобрать часть корзины по акциям',exact:true}).click();
  const output=page.locator('#basket-proposal-status');await expect(output).toContainText('На сколько человек');
  await say(page,'На троих');await say(page,'На неделю');await expect(output).toContainText('Какие продукты исключить');
  await say(page,'Ограничений нет');const table=output.getByRole('table');await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table).toContainText('925 мл');await expect(table).toContainText('Гречка');await expect(table).toContainText('Рис');
  await expect(output).toContainText('Ещё нужно подобрать: 13 поз.');await expect(output).toContainText('акции города, условия карты неизвестны');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  await output.getByRole('button',{name:'Добавить найденное',exact:true}).click();await expect(page.locator('#basket-dock-copy')).toContainText('3 поз.');
  await output.getByRole('button',{name:'Открыть корзину',exact:true}).click();await page.reload();
  await expect(page.locator('#basket-view')).toContainText('Му-у');await expect(page.locator('#basket-view')).toContainText('925 мл');
  expect(ai).toBe(0);
});
