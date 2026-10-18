import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {parsePublishedCatalogue,PUBLISHED_URL} from '../../src/observations/okeyPublishedPromotions.mjs';
const rows=JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-retail/magnit.json',import.meta.url),'utf8'));
const say=async(page,text)=>{await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
test('weekly Magnit and OKEY selection shows real-unit fixtures, incomplete coverage, confirmation and reload',async({page,context})=>{
  let ai=0;
  await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.fulfill({status:503,json:{kind:'unavailable'}});});
  await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
  await page.route('**/rest/v1/retail_catalog_items**',r=>{
    const p=new URL(r.request().url()).searchParams,q=(p.get('name')??'').replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' '),id=(p.get('store_id')??'').replace('eq.','');
    return r.fulfill({json:rows.filter(x=>x.store_id===id&&x.name.toLowerCase().includes(q.toLowerCase())).slice(0,Number(p.get('limit')??40))});
  });
  const snapshot=parsePublishedCatalogue({sourceUrl:PUBLISHED_URL,title:'Каталог акций «Окей Гипермаркет» — Москва',period:'с 15 по 21 октября 2026',observedAt:'2026-10-17T23:50:00.000Z',products:[
    {id:'51922605',name:'Свинина шея без кости п/ф охлажденный кг',rubles:'459',cents:'00',endText:'до 21 октября'},
    {id:'51922403',name:'БЗМЖ Сыр Ламбер мдж в сух в-е 50% сычужный Россия кг',rubles:'999',cents:'00',endText:'до 28 октября'}]});
  // Frozen source evidence plus a controlled clock, not retailer-network proof.
  await page.clock.setFixedTime(new Date('2026-10-18T00:00:00Z'));
  await page.route('**/src/data/okeyPublishedPromotions.json',r=>r.fulfill({json:snapshot}));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  const output=page.locator('#basket-proposal-status');
  await say(page,'Собери недорогую корзину на неделю для троих в Магните и О’КЕЙ');
  await expect(output).toContainText('Какие продукты исключить');await say(page,'Ограничений нет');
  const table=output.getByRole('table');await expect(table).toBeVisible();await expect(table.getByRole('row')).toHaveCount(7);
  await expect(output).toContainText('Ещё нужно подобрать: 10 поз.');
  await expect(output.getByLabel('Проверенные каталоги')).toContainText('акции города, условия карты неизвестны');
  await expect(output).toContainText('Сумма только найденной части');await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  await output.getByRole('button',{name:'Показать О’КЕЙ',exact:true}).click();await expect(table).toContainText('459,00 ₽');
  await expect(table).toContainText('1 кг');await expect(table.locator('a[href*="mos.proshoper.ru"]')).toHaveCount(2);
  await output.getByRole('button',{name:'Добавить найденное',exact:true}).click();
  await expect(output).toContainText('Корзина собрана');await expect(page.locator('#basket-dock-copy')).toContainText('2 поз.');
  await output.getByRole('button',{name:'Открыть корзину',exact:true}).click();await expect(page.locator('#basket-view')).toContainText('Свинина');
  await page.reload();await expect(page.locator('#basket-view')).toContainText('Свинина');await expect(page.locator('#basket-view')).toContainText('Сыр Ламбер');
  expect(ai).toBe(0);
});

test('weekly grocery completion labels weighed portions and persists all 16 explicitly reviewed positions',async({page,context})=>{
  const fixture=JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-retail/magnit-groceries-773505.json',import.meta.url),'utf8'));
  const now=Math.max(...fixture.rows.map(r=>Date.parse(r.observed_at)))+1000;
  await page.clock.setFixedTime(new Date(now));
  await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await page.route('**/functions/v1/catalog-search',r=>r.fulfill({json:{kind:'catalog',products:[],partial:false}}));
  await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
  await page.route('**/rest/v1/retail_catalog_items**',r=>{
    const p=new URL(r.request().url()).searchParams,q=(p.get('name')??'').replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' '),id=(p.get('store_id')??'').replace('eq.','');
    return r.fulfill({json:fixture.rows.filter(x=>x.store_id===id&&x.name.toLowerCase().includes(q.toLowerCase())).slice(0,Number(p.get('limit')??40))});
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await page.locator('#retail-store-card-magnit').click();
  await page.locator('#magnit-store-address').selectOption('773505');
  const output=page.locator('#basket-proposal-status');
  await say(page,'Собери недорогую корзину на неделю для троих в Магните');await say(page,'Ограничений нет');
  const table=output.getByRole('table');await expect(table.getByRole('row')).toHaveCount(17);
  await expect(output).toContainText('на 7 дн. для 3 человек');
  await expect(table).toContainText('🥔 Картофель');await expect(table).toContainText('🥚 Яйца');await expect(table).toContainText('🥛 Молоко');
  await expect(table).toContainText('≈700 г (весовая порция)');await expect(output).toContainText('Ориентировочная сумма:');
  await expect(output).not.toContainText('Ещё нужно подобрать:');await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  await test.info().attach('weekly-grocery-review',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await output.getByRole('button',{name:'Добавить показанное',exact:true}).click();
  await expect(output).toContainText('Корзина собрана');await expect(page.locator('#basket-dock-copy')).toContainText('16 поз.');
  await output.getByRole('button',{name:'Открыть корзину',exact:true}).click();
  await page.reload();await expect(page.locator('#basket-view')).toContainText('весовая порция');
  const basket=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
  expect(basket).toHaveLength(16);
});
