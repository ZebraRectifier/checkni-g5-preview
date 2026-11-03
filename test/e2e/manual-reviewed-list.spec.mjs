import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {selectStore,openBasket,openHory,closeHory} from './helpers/pixel-surface.mjs';
test('saved comparison distinguishes equal observed subtotals from a cheaper option and expired quotes',async({page,context})=>{
 await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.goto('/?comparison=observed&catalog=retail#shop');
 const render=async(priceMinor,ageMs=0)=>page.evaluate(async({priceMinor,ageMs})=>{
  const {renderSavedGuidedComparison}=await import('/src/components/SavedGuidedComparison.mjs');
  const nowMs=Date.parse('2026-11-02T23:00:00Z');
  const row={group:{key:'rice',label:'Рис',dimension:'g',dailyAmount:50},quantity:1,
   product:{id:'test-rice',name:'Рис',unit:'1 кг'},card:{name:'Рис 1 кг',unit:'1 кг',priceMinor:10000,currency:'RUB',
   observedAt:new Date(nowMs-ageMs).toISOString(),sourceUrl:'https://example.org/quote',priceConditionLabel:'Условия карты не подтверждены'}};
  let root=document.querySelector('#comparison-contract-test');
  if(!root){root=document.createElement('section');root.id='comparison-contract-test';document.body.append(root);}
  renderSavedGuidedComparison(root,{kind:'catalog_comparison',drafts:[
   {scope:{retailerId:'magnit',storeId:'a',storeName:'Магнит'},rows:[row]},
   {scope:{retailerId:'perekrestok',storeId:'b',storeName:'Перекрёсток'},rows:[{...row,card:{...row.card,priceMinor}}]}
  ]},{nowMs});
 },{priceMinor,ageMs});
 const output=page.locator('#comparison-contract-test');
 await render(10000);await expect(output.getByRole('status')).toHaveText('По наблюдаемым ценам суммы товаров в этих вариантах совпали.');
 await expect(output).not.toContainText('ниже на');await expect(output).toContainText('Условия карт и акций проверяй по источнику.');
 await render(12000);await expect(output.getByRole('status')).toContainText('По наблюдаемым ценам подытог товаров в Магнит ниже на');
 await render(12000,3600001);await expect(output.getByRole('status')).toContainText('Есть старые или неизвестные цены.');
 await expect(output.getByRole('status')).not.toContainText('ниже на');
});
const {rows}=JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-retail/cross-retailer-20261101.json',import.meta.url),'utf8'));
test('manual reviewed products from both networks add and survive edits, Back and reload without AI',async({page,context})=>{
 let ai=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
 await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
 await page.route('**/rest/v1/retail_catalog_items**',r=>{
  const q=new URL(r.request().url()).searchParams,store=q.get('store_id')?.replace('eq.','');
  const name=q.get('name')?.replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ').toLowerCase();
   const ids=q.get('source_product_id')?.slice(4,-1).split(',');
  return r.fulfill({json:rows.filter(p=>p.store_id===store&&(!ids||ids.includes(p.source_product_id))&&(!name||p.name.toLowerCase().includes(name))).slice(0,Number(q.get('limit')??40))});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');const address=await page.locator('#magnit-store-address option[value="503695"]').textContent();
 await page.locator('#pixel-store-search').fill(address.replace(/^(?:Москва|МО) · /u,''));
 await page.locator('#pixel-store-address-results [data-store-id="503695"]').click();
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 const search=async text=>{await page.locator('#product-search').fill(text);await page.locator('#product-search').press('Enter');};
 await search('банан');
 const banana=page.locator('.product-card[data-product-id="retail:magnit:magnit-503695:9072651501"]');
 await expect(banana.locator('.add-button')).toBeEnabled();await expect(banana).toContainText('весов');
 await banana.locator('.add-button').click();await openBasket(page);
 await expect(page.locator('.basket-row')).toHaveCount(1);await expect(page.locator('.basket-row')).toContainText('≈1 кг');
 await page.locator('.basket-row').getByRole('button',{name:/Увеличить количество/}).click();
 await page.reload();await expect(page.locator('.basket-row output')).toHaveText('2');
 await selectStore(page,'perekrestok');await search('медальон');
 const chicken=page.locator('.product-card[data-product-id="retail:perekrestok:perekrestok-yandex-3186917:d91d7780-ffa9-43d3-8bf3-b9870a9bf791"]');
 await expect(chicken.locator('.add-button')).toBeEnabled();await chicken.locator('.add-button').click();await openBasket(page);
 await expect(page.locator('.basket-row')).toHaveCount(2);
 await expect(page.locator('.basket-summary')).toContainText('2 позиции');
 await expect(page.locator('.basket-summary')).not.toContainText('шт.');
 await expect(page.locator('#basket-dock-copy')).toHaveText('2 поз.');
 expect(await page.evaluate(()=>localStorage.getItem('checkni.guided-comparison-request.v1'))).toBeNull();
 await expect(page.locator('#compare-basket')).toHaveText('Сравнить Магнит и Перекрёсток');
 await page.locator('#compare-basket').click();await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 await expect(page.locator('#comparison-output')).toContainText('Доставка и сборы не включены');
 const selectedDelivery=page.locator('.saved-catalog-variant').filter({hasText:'Перекрёсток'});await selectedDelivery.locator('summary').click();
 await expect(selectedDelivery.locator('tbody')).toContainText('Медальон');
 await page.screenshot({path:test.info().outputPath('manual-pair-comparison.png')});
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.guided-comparison-request.v1')).version)).toBe(2);
 const before=await page.locator('.basket-list').innerText();await page.reload();await expect(page.locator('.basket-list')).toHaveText(before,{useInnerText:true});
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
 expect(JSON.stringify(saved)).not.toMatch(/priceMinor|observedAt|availability|sourceUrl/);
 expect(saved.every(p=>p.id.startsWith('retail:'))).toBe(true);
 await page.locator('#compare-basket').click();await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 await page.goBack();await openBasket(page);await expect(page.locator('.basket-row')).toHaveCount(2);
 await page.locator('.basket-row').last().getByRole('button',{name:/Удалить/}).click();await expect(page.locator('.basket-row')).toHaveCount(1);
 await page.locator('#compare-basket').click();await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 const edited=await page.locator('.basket-list').innerText();await openHory(page);
 const send=async text=>{await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
 const facts=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.shopping.preferences.v1'))?.facts??{});
 await send('Нас шестеро, покупки на две недели');await expect.poll(async()=>(await facts()).peopleCount?.value).toBe(6);
 expect((await facts()).shoppingDays?.value).toBe(14);await send('Не хочу готовить');
 await expect.poll(async()=>(await facts()).cookingEffort?.value).toBe('minimal');
 await page.reload();await openHory(page);await send('Что ты помнишь?');
 await expect(page.locator('#basket-proposal-status')).toContainText('6 чел.');await expect(page.locator('#basket-proposal-status')).toContainText('14 дней');
 await closeHory(page);await expect(page.locator('.basket-list')).toHaveText(edited,{useInnerText:true});
 expect(ai).toBe(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('manual twenty-egg pack is compared with two ten-egg delivery packs without AI',async({page,context})=>{
 const {rows:retained}=JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-retail/magnit-eggs-777885-20261102.json',import.meta.url),'utf8'));
 const source=retained.map(row=>({...row,retailer_id:'magnit',store_id:'magnit-777885',store_name:'Магнит · г Москва, ул Большая Татарская, д 36',
   locality_id:'city-moscow',locality_name:'Москва',currency:'RUB',availability:'unknown',price_condition:'public-online',source_url:row.product_url}));
 const dataset=[...rows,...source];let ai=0;
 await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
 await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
 await page.route('**/rest/v1/retail_catalog_items**',r=>{
   const q=new URL(r.request().url()).searchParams,store=q.get('store_id')?.replace('eq.','');
   const name=q.get('name')?.replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ').toLowerCase();
   const ids=q.get('source_product_id')?.slice(4,-1).split(',');
   return r.fulfill({json:dataset.filter(p=>p.store_id===store&&(!ids||ids.includes(p.source_product_id))&&(!name||p.name.toLowerCase().includes(name))).slice(0,Number(q.get('limit')??40))});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');const address=await page.locator('#magnit-store-address option[value="777885"]').textContent();
 await page.locator('#pixel-store-search').fill(address.replace(/^(?:Москва|МО) · /u,''));
 await page.locator('#pixel-store-address-results [data-store-id="777885"]').click();
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 await page.locator('#product-search').fill('яйц');await page.locator('#product-search').press('Enter');
 await page.locator('.product-card[data-product-id="retail:magnit:magnit-777885:1000219622"] .add-button').click();
 await openBasket(page);await expect(page.locator('.basket-row')).toContainText('20 шт');
 await page.locator('#compare-basket').click();await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 const delivery=page.locator('.saved-catalog-variant').filter({hasText:'Перекрёсток'});await delivery.locator('summary').click();
 await expect(delivery.locator('tbody tr')).toContainText('2 × 10 шт');
 const sourceQuote=page.locator('.saved-catalog-variant').filter({hasText:'Магнит'});await sourceQuote.locator('summary').click();
 await expect(sourceQuote.locator('tbody tr')).toContainText('1 × 20 шт');
 await page.screenshot({path:test.info().outputPath('manual-count-comparison.png')});
 await expect(page.locator('#comparison-output')).not.toContainText('ниже на');
 expect(ai).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('explicit Magnit storefront keeps reviewed canonical milk in the two-network comparison',async({page,context})=>{
 let ai=0;
 await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
 await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
 await page.route('**/rest/v1/retail_catalog_items**',r=>{
  const q=new URL(r.request().url()).searchParams,store=q.get('store_id')?.replace('eq.','');
  const name=q.get('name')?.replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ').toLowerCase();
  const ids=q.get('source_product_id')?.slice(4,-1).split(',');
  return r.fulfill({json:rows.filter(p=>p.store_id===store&&(!ids||ids.includes(p.source_product_id))&&(!name||p.name.toLowerCase().includes(name))).slice(0,Number(q.get('limit')??40))});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');
 const address=await page.locator('#magnit-store-address option[value="503695"]').textContent();
 await page.locator('#pixel-store-search').fill(address.replace(/^(?:Москва|МО) · /u,''));
 await page.locator('#pixel-store-address-results [data-store-id="503695"]').click();
 await page.locator('#product-search').fill('молоко');await page.locator('#product-search').press('Enter');
 const milkCard=page.locator('.product-card[data-product-id="retail:magnit:magnit-503695:1899800733"]');
 await milkCard.locator('.add-button').click();await expect(milkCard.locator('.pixel-quantity')).toHaveText('1');
 await milkCard.locator('.add-button').click();await expect(milkCard.locator('.pixel-quantity')).toHaveText('2');
 await milkCard.locator('.pixel-remove-one').click();await expect(milkCard.locator('.pixel-quantity')).toHaveText('1');
 await openBasket(page);await expect(page.locator('.basket-row')).toHaveCount(1);
 expect((await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1'))))[0].id).toBe('retail:magnit:magnit-503695:1899800733');
 await expect(page.locator('#compare-basket')).toHaveText('Сравнить Магнит и Перекрёсток');
 await page.locator('.basket-row').getByRole('button',{name:/Увеличить количество/}).click();
 await page.locator('#compare-basket').click();await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 const request=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.guided-comparison-request.v1')));
 expect(request.scopes[0].storeId).toBe('magnit-503695');expect(request.bindings[0].sourceProductId).toBe('1899800733');
 await expect(page.locator('#comparison-output')).toContainText('Есть старые или неизвестные цены');
 await expect(page.locator('#comparison-output')).not.toContainText('ниже на');
 await page.reload();await expect(page.locator('.basket-row output')).toHaveText('2');
 await page.locator('#compare-basket').click();await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 await page.goBack();await openBasket(page);await expect(page.locator('.basket-row output')).toHaveText('2');expect(ai).toBe(0);
});
