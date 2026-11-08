import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {selectStore,openBasket,expectNoOverflow} from './helpers/pixel-surface.mjs';

const evidence=JSON.parse(await readFile(new URL('../../tests/fixtures/pyaterochka-public/reviewed-packs-20261107.json',import.meta.url)));
const NOW=Date.parse(evidence.snapshot.observedAt)+1000;
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')||'[]'));
const card=(page,id)=>page.locator(`[data-product-id="retail:pyaterochka:pyaterochka-moscow-proshoper:${id}"]`);

async function setup(page){
 let source=structuredClone(evidence.snapshot),ai=0;const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.clock.install({time:new Date(NOW)});
 await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/|localhost(?::\d+)?\/)/u,r=>r.abort());
 await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
 await page.route('**/rest/v1/**',r=>r.fulfill({json:[]}));
 await page.route('**/src/ports/observedOffersPort.mjs',r=>r.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={async load(){return []}};'}));
 await page.route('**/src/data/pyaterochkaPublishedPromotions.json',r=>r.fulfill({json:source}));
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await selectStore(page,'pyaterochka');
 return {errors,ai:()=>ai,setSource:s=>{source=s;}};
}

test('reviewed campaign packs add, change quantity and reload without creating a comparative price',async({page},testInfo)=>{
 const check=await setup(page);
 await expect(page.locator('#pixel-storefront')).toContainText('цена конкретного магазина');
 for(const id of ['52536073','52535998']){
  const product=card(page,id);await expect(product.locator('.add-button')).toBeEnabled();
  await expect(product).toContainText('условия карты неизвестны');await product.locator('.add-button').click();
  await expect(product.locator('.pixel-quantity')).toHaveText('1');
 }
 await openBasket(page);
 await page.getByRole('button',{name:'Увеличить количество '+evidence.snapshot.products[0].name,exact:true}).click();
 const before=await saved(page);expect(before).toHaveLength(2);expect(before.map(p=>p.quantity)).toEqual([2,1]);
 for(const item of before)expect(Object.keys(item).sort()).toEqual(['id','name','quantity','unit']);
 expect(before[0].unit).toBe('900 г');expect(before[1].unit).toBe('800 г');
 await page.reload();await expect(page.locator('#basket-view .basket-row')).toHaveCount(2);expect(await saved(page)).toEqual(before);
 await page.locator('#compare-basket').click();
 const output=page.locator('#comparison-output');
 await expect(output).toContainText(/Недостаточно|не удалось|Не удалось|не найдены|Нет.*данных/u);
 await expect(output).not.toContainText(/Экономия|Дешевле на|Самый дешёвый/u);
 expect(await saved(page)).toEqual(before);expect(check.errors).toEqual([]);expect(check.ai()).toBe(0);
 await expectNoOverflow(page);await page.screenshot({path:testInfo.outputPath('promotion-list-unknown-comparison.png')});
});

test('unknown assortment stays view-only and an already opened reviewed pack expires at click time',async({page})=>{
 const check=await setup(page);
 const source=structuredClone(evidence.snapshot);
 for(const [id,name] of [['52599998','Другой продукт 800г'],['52599999','Ассорти круп 300-500г']])
  source.products.push({...source.products[0],sourceProductId:id,name,productUrl:'https://mos.proshoper.ru/actions/pyaterochka/moskva/#id_product_'+id});
 check.setSource(source);await page.reload();await selectStore(page,'pyaterochka');
 for(const id of ['52599998','52599999'])await expect(card(page,id).locator('.add-button')).toBeDisabled();
 const add=card(page,'52536073').locator('.add-button');await add.click();const before=await saved(page);
 await page.clock.setSystemTime(new Date(Date.parse(source.observedAt)+86400001));
 await add.click();await expect(add).toBeDisabled();expect(await saved(page)).toEqual(before);
 // A second current observation reaches campaign midnight before its 24h TTL.
 source.products=source.products.filter(p=>!p.sourceProductId.startsWith('525999'));
 source.observedAt='2026-11-09T20:59:00.000Z';for(const p of source.products)p.observedAt=source.observedAt;
 check.setSource(source);await page.clock.setSystemTime(new Date(source.observedAt));
 await page.reload();await selectStore(page,'pyaterochka');await expect(add).toBeEnabled();
 await page.clock.setSystemTime(new Date('2026-11-09T21:00:00.000Z'));
 await add.click();await expect(add).toBeDisabled();expect(await saved(page)).toEqual(before);
 expect(check.errors).toEqual([]);expect(check.ai()).toBe(0);await expectNoOverflow(page);
});
