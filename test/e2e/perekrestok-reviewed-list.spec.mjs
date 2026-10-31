import {test,expect} from '@playwright/test';
import {selectStore,openBasket} from './helpers/pixel-surface.mjs';

// Retained exact delivery packs. Fixture observations do not establish a live quote.
const source='https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w';
const packs=[
 ['22f84859-1ad2-481f-9250-c24580363f8c','Фарш Петелинка Премиум из филе грудки охлажденный','450 г',26000,'yandex-eda-promo'],
 ['5c6afaf4-d14f-4cf3-9770-73eaa24da3b8','Макароны Maltagliati Рифленые перья (Pennoni Rigati) 074','450 г',7300,'yandex-eda-regular'],
 ['fb3574cb-eba6-47a1-9932-30da895354fb','Хлопья овсяные Ясно Солнышко средний размер No 2','500 г',12000,'yandex-eda-regular'],
 ['22e71f23-4a19-438a-855b-2dcfc480e4ae','Молоко Простоквашино отборное 3.4 - 4.5%','930 мл',11500,'yandex-eda-promo']
];
const rows=packs.map(([sku,name,unit,price,condition])=>({retailer_id:'perekrestok',store_id:'perekrestok-yandex-3186917',store_name:'Перекрёсток · Москва, Большой Овчинниковский пер. 16 · Яндекс Еда',locality_id:'city-moscow',locality_name:'Москва',source_product_id:sku,name:name+' '+unit,weight_text:unit,price_minor:price,currency:'RUB',price_condition:condition,sales_channel:'yandex-eda-delivery',minimum_quantity:null,availability:'unknown',product_url:source,source_url:source,image_url:null,observed_at:'2026-10-31T18:17:04.801Z'}));
const unreviewed={...rows[0],source_product_id:'unreviewed-delivery-pack',name:'Фарш Петелинка Премиум 400 г',weight_text:'400 г'};

test('exact delivery packs add to a manual list, keep quantities through reload and cannot invent a price winner',async({page})=>{
 let aiRequests=0;const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/functions/v1/ai-basket-proposal',r=>{aiRequests++;return r.abort();});
 await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
 await page.route('**/rest/v1/retail_catalog_items**',r=>r.fulfill({json:new URL(r.request().url()).searchParams.get('retailer_id')==='eq.perekrestok'?[...rows,unreviewed]:[]}));
 await page.route('**/src/ports/observedOffersPort.mjs',r=>r.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={async load(){return []}};'}));
 await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page,'perekrestok');
 for(const [sku] of packs){const card=page.locator(`[data-product-id="retail:perekrestok:perekrestok-yandex-3186917:${sku}"]`);await expect(card.locator('.add-button')).toBeEnabled();await card.locator('.add-button').click();await expect(card.locator('.pixel-quantity')).toHaveText('1');}
 const other=page.locator('[data-product-id="retail:perekrestok:perekrestok-yandex-3186917:unreviewed-delivery-pack"]');await expect(other.locator('.add-button')).toBeDisabled();
 const mince=page.locator(`[data-product-id="retail:perekrestok:perekrestok-yandex-3186917:${packs[0][0]}"]`);await mince.locator('.add-button').click();await expect(mince.locator('.pixel-quantity')).toHaveText('2');
 await openBasket(page);
 const list=page.locator('#basket-content');for(const [,name,unit] of packs){await expect(list).toContainText(name);await expect(list).toContainText(unit);}
 const increase=page.getByRole('button',{name:'Увеличить количество '+packs[1][1],exact:true});await increase.click();
 await page.getByRole('button',{name:'Уменьшить количество '+packs[0][1],exact:true}).click();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));await page.reload();
 await expect(list).toContainText(packs[0][1]);const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));expect(after).toEqual(before);
 expect(after.map(x=>x.quantity)).toEqual([1,2,1,1]);expect(after.every(x=>Object.keys(x).sort().join(',')==='id,name,quantity,unit')).toBe(true);
 await page.locator('#compare-basket').click();const result=page.getByLabel('Результат по наблюдаемым ценам');await expect(result).toBeVisible();await expect(result).toContainText('Недостаточно данных для «дешевле»');await expect(result).not.toContainText('Экономия');
 expect(errors).toEqual([]);expect(aiRequests).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
