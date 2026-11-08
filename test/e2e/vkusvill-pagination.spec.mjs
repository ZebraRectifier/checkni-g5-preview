import {test,expect} from '@playwright/test';
import {selectStore,expectNoOverflow} from './helpers/pixel-surface.mjs';

// Stable transport fixtures validate the public-network scope and paging UI.
// They do not claim current stock, regional price parity or complete assortment.
const category={retailer_id:'vkusvill',store_id:'vkusvill-public-web',category_id:920006,
 name:'Молочные продукты, яйцо',parent_id:null,root_id:920006,depth:0,
 source_url:'https://vkusvill.ru/goods/molochnye-produkty-yaytso/',product_count:50};
const rows=Array.from({length:50},(_,index)=>({retailer_id:'vkusvill',store_id:'vkusvill-public-web',
 store_name:'ВкусВилл · публичный каталог',locality_id:'country-ru-public-catalog',locality_name:'Россия',
 source_product_id:String(30000+index),name:`Молоко тестовое ${String(index+1).padStart(2,'0')}, 1 л`,
 price_minor:13600+index,currency:'RUB',price_condition:'public-online',availability:'unknown',weight_text:'1 л',
 main_category_id:920006,product_url:`https://vkusvill.ru/goods/moloko-test-${30000+index}/`,
 source_url:category.source_url,observed_at:'2026-11-08T09:00:00.000Z'}));

test('VkusVill public scope keeps fifty honest cards reachable in browse and search',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-08T10:00:00Z'));
 const reads=[];
 await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('**/functions/v1/ai-basket-proposal',route=>route.abort());
 await page.route('**/functions/v1/catalog-search',route=>route.fulfill({json:{kind:'catalog',products:[],partial:false}}));
 await page.route('**/src/ports/observedOffersPort.mjs',route=>route.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={async load(){return [];}};'}));
 await page.route('**/rest/v1/retail_catalog_categories**',route=>{
  const params=new URL(route.request().url()).searchParams;
  return route.fulfill({json:params.get('retailer_id')==='eq.vkusvill'?[category]:[]});
 });
 await page.route('**/rest/v1/retail_catalog_items**',route=>{
  const params=new URL(route.request().url()).searchParams;reads.push(Object.fromEntries(params));
  const query=(params.get('name')??'').replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ').toLocaleLowerCase('ru-RU');
  const offset=Number(params.get('offset')??0),limit=Number(params.get('limit')??24);
  const selected=rows.filter(row=>!query||row.name.toLocaleLowerCase('ru-RU').includes(query));
  return route.fulfill({json:params.get('retailer_id')==='eq.vkusvill'?selected.slice(offset,offset+limit):[]});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await expect(page.locator('#retail-store-card-vkusvill .retail-store-copy > span:last-child')).toHaveText('Онлайн-каталог');
 await selectStore(page,'vkusvill');
 await expect(page.locator('.pixel-store-scope')).toHaveText('Онлайн-каталог');
 await expect(page.locator('.hori-price-scope')).toContainText('цена может зависеть от региона');
 await expect(page.locator('.hori-price-scope')).toContainText('наличие неизвестно');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(24);
 const first=page.locator('#product-grid .product-card').first();
 await expect(first.locator('.product-price strong')).toHaveText('136,00 ₽');
 await expect(first.locator('.product-price-unit')).toHaveText('· Публичная цена сайта');
 await expect(first.locator('.product-price')).toHaveAttribute('title','Наблюдаемая цена Публичная цена сайта; наличие не подтверждено');
 await expect(first.locator('.add-button')).toBeDisabled();
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(48);
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(50);
 await expect(page.locator('#retail-page-end')).toHaveText('Все доступные товары показаны');
 const search=page.getByRole('searchbox',{name:'Найти продукты',exact:true});
 await search.fill('Молоко тестовое');
 await page.locator('#search-form').getByRole('button',{name:'Найти',exact:true}).click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(24);
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(48);
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(50);
 expect(reads.every(read=>read.store_id==='eq.vkusvill-public-web'
  &&read.locality_id==='eq.country-ru-public-catalog')).toBe(true);
 expect(reads.filter(read=>read.name).map(read=>read.offset)).toEqual(['0','24','48']);
 await expectNoOverflow(page);
});
