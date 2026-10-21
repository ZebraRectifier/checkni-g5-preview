import {test,expect} from '@playwright/test';
import {openStoreDetails,selectStore,openBasket,openHory,expectNoOverflow} from '../../test/e2e/helpers/pixel-surface.mjs';

const points=[
 ['770309','1','Петровско-Разумовский','г Москва, проезд Петровско-Разумовский, д 10'],
 ['402835','9','Чугунные Ворота','г Москва, ул Чугунные Ворота, д 21 к 4'],
 ['997740','2','Белоозёрский','Московская обл, г Белоозёрский, ул Коммунальная, зд 16А'],
 ['997710','6','Зелинского','Московская обл, г Воскресенск, ул Зелинского, зд 7А'],
 ['370811','9','Софрино-1','Московская обл, г Пушкино, мкр Софрино-1 (д Нововоронино), стр 16']
];
const packs=[['1899800733','930 мл','Молоко Простоквашино'],['1899800689','930 г','Кефир Простоквашино'],['1000084229','180 г','Брест-Литовск']];

for(const [code,type,query,address] of points)test(`new Magnit ${code}, format ${type}: address → real products → basket → reload`,async({page})=>{
 const responses=new Map();let aiRequests=0;
 page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/functions/v1/ai-basket-proposal'))aiRequests++;});
 page.on('response',async response=>{
  const u=new URL(response.url());
  if(!u.pathname.endsWith('/rest/v1/retail_catalog_items')||u.searchParams.get('retailer_id')!=='eq.magnit'||response.status()!==200||u.searchParams.has('category_url')||u.searchParams.has('main_category_id'))return;
  try{const key=u.searchParams.get('store_id'),rows=await response.json();responses.set(key,[...new Map([...(responses.get(key)??[]),...rows].map(r=>[r.source_product_id,r])).values()]);}catch{}
 });
 await page.goto('./?comparison=observed&catalog=retail#shop');await selectStore(page,'magnit');await openStoreDetails(page);
 await page.getByRole('searchbox',{name:'Найти адрес Магнита',exact:true}).fill(query);
 const option=page.locator(`#magnit-store-address option[value="${code}"]`);
 await expect(option).toHaveText(address);await expect(option).toBeEnabled();
 await page.locator('#magnit-store-address').selectOption(code);
 const cards=page.locator(`#product-grid [data-product-id^="retail:magnit:magnit-${code}:"]`);
 await expect(cards.first()).toBeVisible();
 await expect.poll(()=>responses.get('eq.magnit-'+code)?.length??0).toBeGreaterThan(2);
 const rows=responses.get('eq.magnit-'+code);
 expect(rows.every(r=>r.store_id==='magnit-'+code&&r.location_label===address&&r.availability==='unknown'&&r.price_condition==='public-online'&&new URL(r.product_url).searchParams.get('shopCode')===code&&new URL(r.product_url).searchParams.get('shopType')===type)).toBe(true);
 await page.locator('#pixel-store-details > summary').click();
 for(const [sku,unit,query] of packs){
  await page.getByRole('searchbox',{name:'Найти продукты',exact:true}).fill(query);
  await page.locator('#search-form').getByRole('button',{name:'Найти',exact:true}).click();
  const card=page.locator(`#product-grid [data-product-id="retail:magnit:magnit-${code}:${sku}"]`);
  await expect(card).toBeVisible();
  await expect.poll(()=>responses.get('eq.magnit-'+code)?.some(r=>r.source_product_id===sku)).toBe(true);
  const row=responses.get('eq.magnit-'+code).find(r=>r.source_product_id===sku);
  expect(row).toBeTruthy();await expect(card).toContainText(row.name);await expect(card).toContainText(unit);
  await expect(card).toContainText((row.price_minor/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}));
  await card.scrollIntoViewIfNeeded();await expect(card.locator('img')).toHaveAttribute('src',row.image_url);
  await expect.poll(()=>card.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await card.getByRole('button',{name:/^Добавить /u}).click();
 }
 await openBasket(page);await expect(page.locator('#basket-view').getByRole('button',{name:/^Удалить(?: |$)/u})).toHaveCount(3);
 await expect(page.locator('#basket-view')).toContainText(address);await expectNoOverflow(page);
 await page.reload();await expect(page.locator('#basket-view')).toBeVisible();
 await expect(page.locator('#basket-view').getByRole('button',{name:/^Удалить(?: |$)/u})).toHaveCount(3);
 await page.goBack();await expect(page.locator('#pixel-storefront')).toBeVisible();
 await expect(page.locator('#magnit-store-address')).toHaveValue(code);await expectNoOverflow(page);
 expect(aiRequests).toBe(0);console.log(JSON.stringify({code,type,realProducts:rows.length,basketItems:3,restored:true,aiRequests}));
});

test('new My Price point: weekly request uses real source packs and preserves its partial basket',async({page})=>{
 let aiRequests=0;
 await page.route('**/functions/v1/ai-basket-proposal',route=>{aiRequests++;return route.abort();});
 await page.goto('./?comparison=observed&catalog=retail#shop');await selectStore(page,'magnit');await openStoreDetails(page);
 await page.locator('#magnit-store-address').selectOption('402835');
 await expect(page.locator('#product-grid [data-product-id^="retail:magnit:magnit-402835:"]').first()).toBeVisible();
 await page.locator('#pixel-store-details > summary').click();await openHory(page);
 const say=async text=>{await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
 const output=page.locator('#basket-proposal-status');
 await say('Собери недорогую корзину на неделю для троих');
 await output.getByRole('button',{name:'Текущий магазин',exact:true}).click();
 await expect(output).toContainText('Какие продукты исключить');
 await say('Ограничений нет');const commerce=page.locator('#hori-shopping-results');
 const table=commerce.getByRole('table');await expect(table).toBeVisible();
 await expect(output).toContainText('на 7 дн. для 3 человек');
 expect(await table.getByRole('row').count()).toBeGreaterThan(2);
 await expect(table.locator('a[href*="shopCode=402835"]')).not.toHaveCount(0);
 const links=await table.locator('a[href*="magnit.ru/product/"]').evaluateAll(nodes=>nodes.map(n=>n.href));
 expect(links.length).toBeGreaterThan(1);
 expect(links.every(href=>new URL(href).searchParams.get('shopCode')==='402835'&&new URL(href).searchParams.get('shopType')==='9')).toBe(true);
 await expect(commerce).toContainText('Ещё нужно подобрать');
 await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
 await page.screenshot({path:test.info().outputPath('weekly-selection.png')});
 await output.getByRole('button',{name:'Добавить найденное',exact:true}).click();
 await expect(output).toContainText('Корзина собрана');
 await commerce.getByRole('button',{name:'Открыть корзину',exact:true}).click();
 const items=page.locator('#basket-view').getByRole('button',{name:/^Удалить(?: |$)/u});
 const count=await items.count();expect(count).toBeGreaterThan(1);
 await page.reload();await expect(items).toHaveCount(count);await expectNoOverflow(page);
 await page.screenshot({path:test.info().outputPath('weekly-basket.png')});
 expect(aiRequests).toBe(0);console.log(JSON.stringify({code:'402835',weeklyPeople:3,weeklyDays:7,basketPositions:count,partial:true,restored:true,aiRequests}));
});
