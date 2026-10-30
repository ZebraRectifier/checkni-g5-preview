import {test,expect} from '@playwright/test';
import {selectStore,openStoreDetails,expectNoOverflow} from './helpers/pixel-surface.mjs';
import {readFile} from 'node:fs/promises';
const weeklyRows=JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-route.json',import.meta.url),'utf8'));

// Synthetic HTTP fixtures exercise the actual normalizers, basket and Core.
// They are never production evidence of current retailer prices.
async function setup(page,baseURL,state){
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(baseURL).origin?r.continue():r.abort());
 await page.route('**/src/ports/observedOffersPort.mjs',r=>r.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={load:async()=>[]};'}));
 await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
 await page.route('**/functions/v1/catalog-search',r=>r.fulfill({json:{kind:'catalog',products:[]}}));
 await page.route('**/rest/v1/retail_catalog_items**',async r=>{
  const q=new URL(r.request().url()).searchParams,id=q.get('store_id')?.replace('eq.globus-store-','');
  if(q.has('source_product_id'))state.priceReads=(state.priceReads??0)+1;
  if(state.mode==='outage')return r.fulfill({status:503,json:{}});
  const slow=state.mode==='slow'&&q.has('source_product_id');
  if(slow)await new Promise(resolve=>setTimeout(resolve,3100));
  const now=Date.now(),at=new Date(now-(state.mode==='stale'?7200000:1000)).toISOString();
  let rows=['5011','5020'].includes(id)?weeklyRows[id].map(x=>({...x,observed_at:at,snapshot_collected_at:at,price_minor:x.price_minor+(id==='5020'?500:0)})):[];
  // The observed source subset can omit packs outside the visible recipe.
  rows=rows.filter(x=>!['000000000000495119_ST','000000000000322766_ST'].includes(x.source_product_id));
  if(state.mode==='old-bread-missing')rows=rows.filter(x=>x.source_product_id!=='000000000000257140_ST');
  if(state.mode==='replacement-bread-missing'&&id==='5020')rows=rows.filter(x=>x.source_product_id!=='000000000093100502_ST');
  if(state.mode==='missing'&&id==='5020')rows=rows.slice(1);
  if((state.mode==='oats-missing'&&id==='5011')||state.mode==='oats-missing-both')rows=rows.filter(x=>x.source_product_id!=='000000000000031053_ST');
  if(state.mode==='oats-rice-missing')rows=rows.filter(x=>!['000000000000031053_ST',...(id==='5020'?['000000000000754268_ST']:[])].includes(x.source_product_id));
  const ids=q.get('source_product_id');if(ids)rows=rows.filter(x=>ids.includes(x.source_product_id));
  const response=r.fulfill({json:rows.slice(0,Number(q.get('limit')??40))});
  return slow?response.catch(()=>{}):response;
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await selectStore(page,'globus');await openStoreDetails(page);
 await page.locator('#globus-store-address').selectOption('5011');
 await page.locator('#globus-compare-address').selectOption('');
 await page.locator('#weekly-route').getByRole('button',{name:'🥘 Корзина на неделю для троих',exact:true}).click();
 await expect(page.locator('#weekly-route-status')).toContainText('Выбери второй магазин');
 await page.locator('#weekly-route').getByRole('button',{name:'Сравнить с Глобус Медведково',exact:true}).click();
}
test('explicit rice breakfast alternative reaches Core comparison and survives reload',async({page,baseURL})=>{
 const state={mode:'oats-missing'};await setup(page,baseURL,state);
 const section=page.locator('#weekly-route'),action=section.locator('#weekly-route-breakfast-action');
 await expect(action).toBeEnabled();
 await expect(section.locator('#weekly-route-breakfast')).toContainText('всего риса будет 5 уп.');
 const oats=section.locator('#weekly-route-include-globus-weekly-oats-31053');
 await expect(oats).toBeChecked();
 await action.click();await expect(oats).not.toBeChecked();
 await expect(section.locator('[data-weekly-product="globus-rice-uvelka-round-800g"] input[type="number"]')).toHaveValue('5');
 await expect(section.locator('#weekly-route-status')).toContainText('9 из 9 выбранных');
 await expectNoOverflow(page);
 await section.getByRole('button',{name:'Добавить и сравнить',exact:true}).click();
 await expect(page.getByLabel('Результат по наблюдаемым ценам')).toContainText('9 из 9 позиций');
 const basket=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
 expect(basket.find(p=>p.id==='globus-rice-uvelka-round-800g').quantity).toBe(5);
 expect(basket.some(p=>p.id==='globus-weekly-oats-31053')).toBe(false);
 await page.reload();await page.locator('#back-to-shop').click();
 await section.getByRole('button',{name:'🥘 Корзина на неделю для троих',exact:true}).click();
 await expect(oats).not.toBeChecked();
 await expect(section.locator('[data-weekly-product="globus-rice-uvelka-round-800g"] input[type="number"]')).toHaveValue('5');
 await expectNoOverflow(page);
});

test('rice alternative stays unavailable when the second exact address lacks its price',async({page,baseURL})=>{
 await setup(page,baseURL,{mode:'oats-rice-missing'});
 const section=page.locator('#weekly-route');
 await expect(section.locator('#weekly-route-breakfast')).toBeVisible();
 await expect(section.locator('#weekly-route-breakfast-action')).toBeDisabled();
 await expect(section.getByRole('button',{name:'Добавить и сравнить',exact:true})).toBeDisabled();
 await expect(section.locator('#weekly-route-include-globus-weekly-oats-31053')).toBeChecked();
});
test('explicit address and peer lead to ten editable lines, saved basket and actual Core comparison across reload',async({page,baseURL})=>{
 test.setTimeout(60_000);
 const state={mode:'fresh'};await setup(page,baseURL,state);
 const section=page.locator('#weekly-route'),apply=section.getByRole('button',{name:'Добавить и сравнить',exact:true});
 await expect(apply).toBeEnabled();await expect(section.locator('#weekly-route-addresses')).toContainText('Широкая, 2а');
 const details=section.locator('#weekly-route-products');if(!await details.evaluate(n=>n.open))await details.locator('summary').click();
 await expect(section.locator('[data-weekly-product]')).toHaveCount(10);
 const quantity=section.getByRole('spinbutton').first();await quantity.fill('2');await quantity.dispatchEvent('change');
 await expect(quantity).toHaveValue('2');await expectNoOverflow(page);
 await apply.click();await expect(page.locator('#basket-view')).toBeVisible();
 const result=page.getByLabel('Результат по наблюдаемым ценам');
 await expect(result).toContainText('10 из 10 позиций');await expect(result).toContainText('Экономия');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')).length)).toBe(10);
 await expect(result).toContainText('Наличие не подтверждено');
 await page.reload();await expect(page.locator('#basket-view')).toContainText('Фарш');
 await page.locator('#compare-basket').click();await expect(result).toContainText('10 из 10 позиций');
 await page.locator('#back-to-shop').click();await expect(section).toBeVisible();await expectNoOverflow(page);
});
test('a delayed current-price response still completes the recipe within the bounded network window',async({page,baseURL})=>{
 await setup(page,baseURL,{mode:'slow'});
 const section=page.locator('#weekly-route');
 await expect(section.getByRole('button',{name:'Добавить и сравнить',exact:true})).toBeEnabled();
 await expect(section.locator('#weekly-route-status')).toContainText('10 из 10 цен свежее часа');
 await expectNoOverflow(page);
});
test('current replacement bread completes both exact-store baskets when the old bread disappears',async({page,baseURL})=>{
 await setup(page,baseURL,{mode:'old-bread-missing'});
 const section=page.locator('#weekly-route'),apply=section.getByRole('button',{name:'Добавить и сравнить',exact:true});
 await expect(section.locator('#weekly-route-status')).toContainText('10 из 10 цен свежее часа');
 await expect(apply).toBeEnabled();
 await apply.click();
 await expect(page.getByLabel('Результат по наблюдаемым ценам')).toContainText('10 из 10 позиций');
 await expectNoOverflow(page);
});
test('old bread cannot fill a missing current replacement price at the second address',async({page,baseURL})=>{
 await setup(page,baseURL,{mode:'replacement-bread-missing'});
 const section=page.locator('#weekly-route'),apply=section.getByRole('button',{name:'Добавить и сравнить',exact:true});
 await expect(section.locator('#weekly-route-status')).toContainText('не хватает свежих цен');
 await expect(apply).toBeDisabled();
 await expect(section.locator('#weekly-route-total')).toBeEmpty();
 await expectNoOverflow(page);
});
for(const mode of ['missing','stale','outage'])test(`${mode} prices prevent a complete basket and recover with fresh qualified rows`,async({page,baseURL})=>{
 const state={mode};await setup(page,baseURL,state);
 const section=page.locator('#weekly-route'),apply=section.getByRole('button',{name:'Добавить и сравнить',exact:true});
 await expect(section.locator('#weekly-route-status')).toContainText('не хватает свежих цен');
 await expect(apply).toBeDisabled();await expect(section.locator('#weekly-route-total')).toBeEmpty();
 state.mode='fresh';await section.getByRole('button',{name:'Проверить цены ещё раз',exact:true}).click();
 await expect(apply).toBeEnabled();await expectNoOverflow(page);
});

test('only an explicit product selection makes a nine-line basket, keeping quantity and selection across reload',async({page,baseURL})=>{
 test.setTimeout(75_000);
 const state={mode:'oats-missing'};await setup(page,baseURL,state);
 const section=page.locator('#weekly-route'),details=section.locator('#weekly-route-products');
 const apply=section.getByRole('button',{name:'Добавить и сравнить',exact:true});
 if(!await details.evaluate(n=>n.open))await details.locator('summary').click();
 const checkboxes=details.getByRole('checkbox');
 const oats=details.getByRole('checkbox',{name:'Включить в список: Хлопья овсяные Ясно Солнышко №2',exact:true});
 await expect(details.locator('input[type=checkbox]:checked')).toHaveCount(10);
 await expect(apply).toBeDisabled();await expect(section.locator('#weekly-route-status')).toContainText('не хватает свежих цен');
 const quantity=details.getByRole('spinbutton',{name:'Количество: Молоко Parmalat 3,5%',exact:true});
 await quantity.fill('2');await quantity.dispatchEvent('change');
 const reads=state.priceReads;
 await oats.uncheck();
 await expect(section.locator('#weekly-route-status')).toContainText('Выбрано 9 из 10');
 await expect(section.locator('#weekly-route-status')).toContainText('9 из 9 выбранных позиций шаблона');
 await expect(apply).toBeEnabled();expect(state.priceReads).toBe(reads);
 await oats.check();await expect(apply).toBeDisabled();await oats.uncheck();
 for(const checkbox of await checkboxes.all())await checkbox.uncheck();
 await expect(apply).toBeDisabled();await expect(section.locator('#weekly-route-status')).toContainText('хотя бы один продукт');
 await expect(section.locator('#weekly-route-total')).toBeEmpty();
 for(const checkbox of await checkboxes.all())if(await checkbox.getAttribute('aria-label')!=='Включить в список: Хлопья овсяные Ясно Солнышко №2')await checkbox.check();
 await expect(quantity).toHaveValue('2');await expect(apply).toBeEnabled();expect(state.priceReads).toBe(reads);
 await apply.click();
 const result=page.getByLabel('Результат по наблюдаемым ценам');
 await expect(result).toContainText('9 из 9 позиций');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
 expect(saved).toHaveLength(9);expect(saved.some(p=>p.id==='globus-weekly-oats-31053')).toBe(false);
 expect(saved.find(p=>p.id==='globus-milk-parmalat-35-1l').quantity).toBe(2);
 await page.reload();await page.locator('#compare-basket').click();await expect(result).toContainText('9 из 9 позиций');
 await page.locator('#back-to-shop').click();
 const open=section.getByRole('button',{name:'🥘 Корзина на неделю для троих',exact:true});
 if(await open.getAttribute('aria-expanded')==='false')await open.click();
 if(!await details.evaluate(n=>n.open))await details.locator('summary').click();
 await expect(oats).not.toBeChecked();await expect(quantity).toHaveValue('2');
 await oats.check();await expect(apply).toBeDisabled();
 await expect(section.locator('#weekly-route-status')).toContainText('не хватает свежих цен');
 await expectNoOverflow(page);
});

test('adding selected lines preserves an existing unpriced product until the user explicitly replaces the basket',async({page,baseURL})=>{
 test.setTimeout(75_000);
 const state={mode:'fresh'};await setup(page,baseURL,state);
 const section=page.locator('#weekly-route'),details=section.locator('#weekly-route-products');
 await section.getByRole('button',{name:'Добавить и сравнить',exact:true}).click();
 const result=page.getByLabel('Результат по наблюдаемым ценам');
 await expect(result).toContainText('10 из 10 позиций');
 await page.locator('#back-to-shop').click();state.mode='oats-missing-both';
 const open=section.getByRole('button',{name:'🥘 Корзина на неделю для троих',exact:true});
 await open.click();await open.click();
 await section.getByRole('button',{name:'Проверить цены ещё раз',exact:true}).click();
 await expect(section.locator('#weekly-route-status')).toContainText('не хватает свежих цен');
 if(!await details.evaluate(n=>n.open))await details.locator('summary').click();
 await details.getByRole('checkbox',{name:'Включить в список: Хлопья овсяные Ясно Солнышко №2',exact:true}).uncheck();
 await section.getByRole('button',{name:'Добавить и сравнить',exact:true}).click();
 await expect(result).toContainText('Недостаточно данных для «дешевле»');
 const added=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
 expect(added).toHaveLength(10);expect(added.some(p=>p.id==='globus-weekly-oats-31053')).toBe(true);
 await page.locator('#back-to-shop').click();
 await open.click();await open.click();
 await section.getByRole('button',{name:'Проверить цены ещё раз',exact:true}).click();
 await expect(section.locator('#weekly-route-status')).toContainText('9 из 9 выбранных позиций шаблона');
 await section.getByRole('checkbox',{name:'Заменить текущий список этой корзиной',exact:true}).check();
 await section.getByRole('button',{name:'Заменить и сравнить',exact:true}).click();
 await expect(result).toContainText('9 из 9 позиций');
 const replaced=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
 expect(replaced).toHaveLength(9);expect(replaced.some(p=>p.id==='globus-weekly-oats-31053')).toBe(false);
 await expectNoOverflow(page);
});
