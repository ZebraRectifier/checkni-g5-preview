import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {expectNoOverflow,openBasket} from './helpers/pixel-surface.mjs';
// Controlled retained identity evidence. This is not a fresh retailer quote.
const {sourceProduct:egg}=JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-retail/magnit-eggs-508831-20261103.json',import.meta.url),'utf8'));
const globus={retailer_id:'globus',store_id:'globus-store-5011',store_name:'Глобус Красногорск',
 locality_id:'city-moscow',locality_name:'Москва',source_product_id:'000000000000026730_ST',
 name:'Молоко Parmalat 3,5%, 1л',weight_text:'1 л',price_minor:14199,currency:'RUB',price_condition:'regular',
 sales_channel:'store',minimum_quantity:1,availability:'unknown',main_category_id:10118965,
 product_url:'https://www.globus.ru/products/moloko-parmalat-35-1l-26730_ST/',source_url:'https://www.globus.ru/catalog/food',
 scope_evidence_url:'https://www.globus.ru/catalog/food',scope_binding:'same-source',binding_id:'store:5011',
 location_label:'г. Москва, вн.тер.г. муниципальный округ Кунцево, Новорижское шоссе 22-й км, д. 1 стр. 1',observed_at:'2026-11-01T20:43:40.061Z'};
const magnit={retailer_id:egg.retailerId,store_id:egg.storeId,store_name:egg.storeName,
 locality_id:egg.localityId,locality_name:egg.localityName,source_product_id:egg.sourceProductId,name:egg.name,weight_text:egg.weightText,
 price_minor:egg.priceMinor,currency:egg.currency,price_condition:egg.priceCondition,sales_channel:egg.salesChannel,
 availability:egg.availability,product_url:egg.productUrl,source_url:egg.sourceUrl,observed_at:egg.observedAt,
 scope_binding:egg.scopeBinding,binding_id:egg.bindingId,scope_evidence_url:egg.scopeEvidenceUrl,
 location_label:egg.locationLabel,minimum_quantity:1,quantity_semantics:{},main_category_id:63963};
const key='checkni.surface.basket.v1';
for(const [retailer,raw,addressId,query] of [['globus',globus,'5011','Новорижское'],['magnit',magnit,'508831','Щемилово Орлова 26']]){
 test(`${retailer}: dated reviewed identity is explicitly a list selection without a current price`,async({page},info)=>{
  await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
  let ai=0;
  await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.route('**/rest/v1/**',route=>route.fulfill({json:[]}));
  await page.route('**/functions/v1/ai-basket-proposal',route=>{ai++;return route.abort();});
  await page.route('**/src/ports/observedOffersPort.mjs',route=>route.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={async load(){return [];}};'}));
  const unknown={...raw,source_product_id:'900000001',name:'Неизвестный товар 500 г',weight_text:'500 г',
   product_url:retailer==='globus'?'https://www.globus.ru/products/neizvestnyj-900000001_ST/':raw.product_url.replace(egg.sourceProductId,'900000001')};
  await page.route('**/rest/v1/retail_catalog_items**',route=>{
   const q=new URL(route.request().url()).searchParams;
   return route.fulfill({json:q.get('store_id')==='eq.'+raw.store_id?[raw,unknown]:[]});
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await page.locator(retailer==='globus'?'#retail-store-card':'#retail-store-card-magnit').click();
  await expect(page.locator('#pixel-address-chooser')).toBeVisible();
  await page.locator(`#${retailer}-store-picker input[type=search]`).fill(query);
  await page.locator(`#pixel-address-chooser [data-store-id="${addressId}"]`).click();
  const card=page.locator(`[data-product-id="retail:${retailer}:${raw.store_id}:${raw.source_product_id}"]`);
  const add=card.locator('.add-button');
  await expect(add).toBeEnabled();await expect(add).toHaveText('В список без цены');
  await expect(add).toHaveAccessibleName(/^Добавить .* в список без цены$/u);
  await expect(card.locator('.product-observed-at')).toContainText('Старая цена от');
  await expect(card.locator('.product-observed-at')).toHaveAttribute('datetime',new Date(raw.observed_at).toISOString());
  const readonly=page.locator(`[data-product-id="retail:${retailer}:${raw.store_id}:900000001"] .add-button`);
  await expect(readonly).toBeDisabled();await expect(readonly).toHaveText('Пока только просмотр');
  if (retailer === 'magnit') {
   await expect(page.locator(`[data-product-id="retail:${retailer}:${raw.store_id}:900000001"] .product-observed-at`))
     .toHaveText(/^Старая цена от/u);
  }
  await add.evaluate(n=>n.scrollIntoView({block:'center'}));
  expect(await add.evaluate(n=>{const b=n.getBoundingClientRect();const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return b.height>=44&&getComputedStyle(n).fontSize!=='0px'&&getComputedStyle(n,'::before').display==='none'&&n.contains(hit);})).toBe(true);
  await page.screenshot({path:info.outputPath(`${retailer}-dated-card.png`)});
  await card.locator('.shopping-detail-trigger').click();
  const dialog=page.getByRole('dialog',{name:'Информация о товаре',exact:true});
  const dialogAdd=dialog.getByRole('button',{name:/^Добавить .* в список без цены$/u});
  await expect(dialogAdd).toHaveText('В список без цены');await expect(dialog).toContainText('Старая цена от');
  await dialogAdd.click();await expect(dialog).toBeHidden();await expect(card.locator('.pixel-quantity')).toHaveText('1');
  await add.focus();await page.keyboard.press('Enter');await expect(card.locator('.pixel-quantity')).toHaveText('2');
  await expectNoOverflow(page);
  const persisted=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
  expect(persisted).toHaveLength(1);expect(persisted[0].quantity).toBe(2);
  expect(JSON.stringify(persisted)).not.toMatch(/priceMinor|observedAt|availability|sourceUrl/u);
  await openBasket(page);await expect(page.locator('#basket-content')).toContainText('требует проверки');
  await page.reload();await expect(page.locator('#basket-view')).toBeVisible();
  expect(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key)).toEqual(persisted);
  await page.locator('#compare-basket').click();
  await expect(page.locator('#comparison-output')).toContainText(/Недостаточно|не удалось|Не удалось|не найдены|Нет.*данных|проверить|подтвержд/u);
  await expect(page.locator('#comparison-output')).not.toContainText(/Экономия|Дешевле на|Самый дешёвый/u);
  expect(ai).toBe(0);await expectNoOverflow(page);
 });
}
