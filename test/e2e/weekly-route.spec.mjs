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
 await page.route('**/rest/v1/retail_catalog_items**',r=>{
  const q=new URL(r.request().url()).searchParams,id=q.get('store_id')?.replace('eq.globus-store-','');
  if(state.mode==='outage')return r.fulfill({status:503,json:{}});
  const now=Date.now(),at=new Date(now-(state.mode==='stale'?7200000:1000)).toISOString();
  let rows=['5011','5020'].includes(id)?weeklyRows[id].map(x=>({...x,observed_at:at,snapshot_collected_at:at,price_minor:x.price_minor+(id==='5020'?500:0)})):[];
  if(state.mode==='missing'&&id==='5020')rows=rows.slice(1);
  const ids=q.get('source_product_id');if(ids)rows=rows.filter(x=>ids.includes(x.source_product_id));
  return r.fulfill({json:rows.slice(0,Number(q.get('limit')??40))});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await selectStore(page,'globus');await openStoreDetails(page);
 await page.locator('#globus-store-address').selectOption('5011');
 await page.locator('#globus-compare-address').selectOption('');
 await page.locator('#weekly-route').getByRole('button',{name:'🥘 Корзина на неделю для троих',exact:true}).click();
 await expect(page.locator('#weekly-route-status')).toContainText('Выбери второй магазин');
 await page.locator('#weekly-route').getByRole('button',{name:'Сравнить с Глобус Медведково',exact:true}).click();
}
test('explicit address and peer lead to twelve editable lines, saved basket and actual Core comparison across reload',async({page,baseURL})=>{
 const state={mode:'fresh'};await setup(page,baseURL,state);
 const section=page.locator('#weekly-route'),apply=section.getByRole('button',{name:'Добавить и сравнить',exact:true});
 await expect(apply).toBeEnabled();await expect(section.locator('#weekly-route-addresses')).toContainText('Широкая, 2а');
 const details=section.locator('#weekly-route-products');if(!await details.evaluate(n=>n.open))await details.locator('summary').click();
 await expect(section.locator('[data-weekly-product]')).toHaveCount(12);
 const quantity=section.getByRole('spinbutton').first();await quantity.fill('2');await quantity.dispatchEvent('change');
 await expect(quantity).toHaveValue('2');await expectNoOverflow(page);
 await apply.click();await expect(page.locator('#basket-view')).toBeVisible();
 const result=page.getByLabel('Результат по наблюдаемым ценам');
 await expect(result).toContainText('12 из 12 позиций');await expect(result).toContainText('Экономия');
 await expect(result).toContainText('Наличие не подтверждено');
 await page.reload();await expect(page.locator('#basket-view')).toContainText('Фарш');
 await page.locator('#compare-basket').click();await expect(result).toContainText('12 из 12 позиций');
 await page.locator('#back-to-shop').click();await expect(section).toBeVisible();await expectNoOverflow(page);
});
for(const mode of ['missing','stale','outage'])test(`${mode} prices prevent a complete basket and recover with fresh qualified rows`,async({page,baseURL})=>{
 const state={mode};await setup(page,baseURL,state);
 const section=page.locator('#weekly-route'),apply=section.getByRole('button',{name:'Добавить и сравнить',exact:true});
 await expect(section.locator('#weekly-route-status')).toContainText('не хватает свежих цен');
 await expect(apply).toBeDisabled();await expect(section.locator('#weekly-route-total')).toBeEmpty();
 state.mode='fresh';await section.getByRole('button',{name:'Проверить цены ещё раз',exact:true}).click();
 await expect(apply).toBeEnabled();await expectNoOverflow(page);
});
