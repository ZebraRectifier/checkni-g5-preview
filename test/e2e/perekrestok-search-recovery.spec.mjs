import {test,expect} from '@playwright/test';
import {selectStore,openBasket,expectNoOverflow} from './helpers/pixel-surface.mjs';

// Transport fixtures only: no claim about a live price, phone or provider.
const source='https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w';
const product={retailer_id:'perekrestok',store_id:'perekrestok-yandex-3186917',
 store_name:'Перекрёсток · Москва, Большой Овчинниковский пер. 16 · Яндекс Еда',locality_id:'city-moscow',locality_name:'Москва',
 source_product_id:'22f84859-1ad2-481f-9250-c24580363f8c',
 name:'Фарш Петелинка Премиум из филе грудки охлажденный 450 г',weight_text:'450 г',
 sales_channel:'yandex-eda-delivery',minimum_quantity:null,price_minor:26000,currency:'RUB',price_condition:'yandex-eda-promo',availability:'unknown',
 main_category_id:2910,product_url:source,source_url:source,observed_at:'2026-11-04T09:30:00Z'};

test('Perekrestok keyword RPC preserves basket across explicit failure recovery and reload',async({page})=>{
 let searches=0,ai=0;
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
 await page.route('**/rest/v1/retail_catalog_items?**',r=>r.fulfill({json:[product]}));
 await page.route('**/rest/v1/rpc/retail_catalog_items_search?**',r=>{
  const p=new URL(r.request().url()).searchParams;
  expect(r.request().method()).toBe('GET');
  expect(p.get('p_retailer_id')).toBe('perekrestok');
  expect(p.get('p_store_id')).toBe('perekrestok-yandex-3186917');
  expect(p.get('p_locality_id')).toBe('city-moscow');
  expect(p.get('p_query')).toBe('фарш');
  expect(p.has('name')).toBe(false);
  searches++;
  return searches===1?r.fulfill({status:503,json:{code:'controlled_unavailable'}}):r.fulfill({json:[product]});
 });
 await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await selectStore(page,'perekrestok');
 const card=page.locator(`[data-product-id$=":${product.source_product_id}"]`);
 await card.locator('.add-button').click();
 const saved=await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'));
 await page.locator('#product-search').fill('фарш');
 await page.locator('#search-form').getByRole('button',{name:'Найти',exact:true}).click();
 await expect(page.locator('#empty-search h3')).toHaveText('Не удалось загрузить товары');
 expect(searches).toBe(1);
 await page.getByRole('button',{name:'Повторить поиск',exact:true}).click();
 await expect(card).toBeVisible();expect(searches).toBe(2);
 await expect(page.locator('#product-search')).toHaveValue('фарш');
 expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(saved);
 await openBasket(page);await expect(page.locator('#basket-content')).toContainText('Фарш Петелинка Премиум из филе грудки охлажденный');
 await page.reload();await expect(page.locator('#basket-content')).toContainText('Фарш Петелинка Премиум из филе грудки охлажденный');
 expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(saved);
 expect(ai).toBe(0);await expectNoOverflow(page);
});
