import { test, expect } from '@playwright/test';
import { selectStore, openStores, openBasket, openHory, closeHory, addButton, expectNoOverflow } from './helpers/pixel-surface.mjs';

// Bounded synthetic fixtures exercise the shipping ports/controllers. They do
// not establish live retailer prices, stock, complete catalogues or Android FPS.
const dairyId=10118965,groceryId=10112696,brandsId=10110001,readyId=10110002;
const categoryUrl=id=>`https://www.globus.ru/catalog/fixture-category-${id}`;
const products=[
 ['000000000000026730_ST','Молоко Parmalat 3,5%, 1л','1 л',14199,'moloko-parmalat-35-1l-26730_ST',dairyId],
 ['000000000000754268_ST','Рис круглозерный Увелка, 800г','800 г',18399,'ris-kruglozernyj-uvelka-800g-754268_ST',groceryId]
].map(([id,name,weight,price,slug,category])=>({
 retailer_id:'globus',store_id:'globus-store-5011',store_name:'Глобус Красногорск',
 locality_id:'city-moscow',locality_name:'Москва',source_product_id:id,name,weight_text:weight,
 price_minor:price,currency:'RUB',price_condition:'regular',sales_channel:'store',minimum_quantity:1,
 availability:'unknown',main_category_id:category,product_url:`https://www.globus.ru/products/${slug}/`,
 source_url:'https://www.globus.ru/catalog/food',scope_evidence_url:'https://www.globus.ru/catalog/food',
 scope_binding:'same-source',binding_id:'store:5011',
 location_label:'г. Москва, вн.тер.г. муниципальный округ Кунцево, Новорижское шоссе 22-й км, д. 1 стр. 1',
 observed_at:'2026-10-20T08:30:00Z'
}));
const categories=[[groceryId,'Бакалея'],[dairyId,'Молочные продукты, сыр, яйца'],[readyId,'Вся готовая еда'],[brandsId,'Наши бренды']]
 .map(([id,name])=>({retailer_id:'globus',store_id:'globus-store-5011',category_id:id,name,parent_id:null,root_id:id,depth:0,
 source_url:categoryUrl(id),product_count:products.filter(p=>p.main_category_id===id).length}));
const extraRootCategories=[[10110003,'Овощи и фрукты'],[10110004,'Мясо и птица'],[10110005,'Хлеб и выпечка'],[10110006,'Напитки'],[10110007,'Товары для дома']]
 .map(([id,name])=>({retailer_id:'globus',store_id:'globus-store-5011',category_id:id,name,parent_id:null,root_id:id,depth:0,
 source_url:categoryUrl(id),product_count:0}));

async function setup(page,{collections=false,expandedRoots=false}={}){
 // The collection option reuses only these two admitted synthetic identities.
 // Assigning them to merchandising contexts is test data, not a claim that
 // this retailer actually stocks own-brand milk or a prepared rice dish.
 const fixtureProducts=products.map((row,index)=>{
  const category=collections?[brandsId,readyId][index]:row.main_category_id;
  return {...row,main_category_id:category,category_url:categoryUrl(category),
   ...(collections?{source_url:categoryUrl(category),scope_evidence_url:categoryUrl(category)}:{})};
 });
 const categoryProducts=id=>collections&&id===readyId
  // Cross-merchandising can put the same source SKU in both real categories.
  // Keep the source identity while binding this response to its own category.
  ?[{...fixtureProducts[0],main_category_id:readyId,category_url:categoryUrl(readyId),source_url:categoryUrl(readyId),scope_evidence_url:categoryUrl(readyId)},fixtureProducts[1]]
  :fixtureProducts.filter(row=>row.main_category_id===id);
 const fixtureCategories=[...categories,...(expandedRoots?extraRootCategories:[])].map(category=>({
  ...category,product_count:categoryProducts(category.category_id).length
 }));
 await page.clock.setFixedTime(new Date('2026-10-20T09:00:00Z'));
 const calls={categories:[],items:[],global:0,ai:0};
 await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('**/rest/v1/**',route=>route.fulfill({json:[]}));
 await page.route('**/functions/v1/catalog-search',route=>{calls.global++;return route.fulfill({json:{kind:'catalog',products:[{id:'unrelated-global-fixture',name:'Чужой глобальный товар'}],partial:false}});});
 await page.route('**/functions/v1/ai-basket-proposal',route=>{calls.ai++;return route.abort();});
 await page.route('**/src/ports/observedOffersPort.mjs',route=>route.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={async load(){return [];}};'}));
 await page.route('**/rest/v1/retail_catalog_categories**',route=>{
  const p=new URL(route.request().url()).searchParams;calls.categories.push(Object.fromEntries(p));
  return route.fulfill({json:p.get('retailer_id')==='eq.globus'&&p.get('store_id')==='eq.globus-store-5011'&&!p.has('parent_id')?fixtureCategories:[]});
 });
 await page.route('**/rest/v1/retail_catalog_items**',route=>{
  const p=new URL(route.request().url()).searchParams;calls.items.push(Object.fromEntries(p));
  const q=(p.get('name')??'').replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ').toLocaleLowerCase('ru-RU');
  const category=p.get('main_category_id')?.replace('eq.','');
  const categoryPrefix=p.get('category_url')?.replace(/^like\./u,'').replace(/\*$/u,'');
  const sourceCategory=fixtureCategories.find(row=>row.source_url===categoryPrefix);
  const rows=category?categoryProducts(Number(category)):categoryPrefix
   ?sourceCategory?categoryProducts(sourceCategory.category_id):[]:fixtureProducts;
  const offset=Number(p.get('offset')??0),limit=Number(p.get('limit')??40);
  return route.fulfill({json:p.get('retailer_id')==='eq.globus'&&p.get('store_id')==='eq.globus-store-5011'
   ?rows.filter(row=>row.name.toLocaleLowerCase('ru-RU').includes(q)).slice(offset,offset+limit):[]});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await expect(page.locator('#pixel-store-home')).toBeVisible();
 return calls;
}
const savedBasket=page=>page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'));

test('Lenta populated categories remain usable beyond forty products and after a failed next page', async ({page}) => {
 await setup(page);
 const roots = [[25,'Макароны, крупы, мука',59],[77,'Заморозка',1],[3,'Молочные продукты, яйцо',1],
  [4,'Напитки',1],[1028,'Сладости',1],[165,'Хлеб и выпечка',1]];
 const category = (id,name,count,parent=null) => ({retailer_id:'lenta',store_id:'lenta-public-web',
  category_id:id,name,product_count:count,parent_id:parent,root_id:parent??id,depth:parent?1:0,
  source_url:`https://lenta.com/catalog/fixture-${id}/`});
 const rootRows = [...roots.map(([id,name,count])=>category(id,name,count)),
  ...Array.from({length:16},(_,i)=>category(1000+i,`Пустой раздел ${i+1}`,0))];
 const childRows = [category(31,'Макароны',30,25),category(37,'Каши и хлопья',29,25),category(27,'Пустые крупы',0,25)];
 const rows = Array.from({length:64},(_,i)=>({retailer_id:'lenta',store_id:'lenta-public-web',
  store_name:'Лента · публичный каталог',locality_id:'country-ru-public-catalog',locality_name:'Россия',
  source_product_id:String(800000+i),name:`Продукт ЛЕНТА ${String(i+1).padStart(2,'0')}, 500 г`,weight_text:'500 г',
  main_category_id:i<30?31:i<59?37:roots[i-58][0],price_minor:4999+i,currency:'RUB',
  price_condition:'loyalty-card-1',availability:'unknown',product_url:`https://lenta.com/product/fixture-${800000+i}/`,
  source_url:'https://lenta.com/catalog/fixture-25/',image_url:null,observed_at:'2026-10-20T08:30:00Z'}));
 let failNextPage=true,failSearchNextPage=true,releaseHeldSearch,noteHeldSearch;
 const heldSearch=new Promise(resolve=>{releaseHeldSearch=resolve;});
 const heldSearchStarted=new Promise(resolve=>{noteHeldSearch=resolve;});
 let holdSearchNextPage=true;
 const reads=[];
 await page.route('**/rest/v1/retail_catalog_categories**',route=>{
  const p=new URL(route.request().url()).searchParams;reads.push(Object.fromEntries(p));
  // Deliberately return seed-only roots too, to test the defensive local filter.
  return route.fulfill({json:p.get('retailer_id')==='eq.lenta'
   ?p.get('parent_id')==='eq.25'?childRows:p.has('parent_id')?[]:rootRows:[]});
 });
 await page.route('**/rest/v1/retail_catalog_items**',async route=>{
  const p=new URL(route.request().url()).searchParams;reads.push(Object.fromEntries(p));
  const offset=Number(p.get('offset')??0),limit=Number(p.get('limit')??40);
  if(p.get('retailer_id')!=='eq.lenta')return route.fulfill({json:[]});
  let wasHeldSearch=false;
  if(p.has('name')&&offset===24&&holdSearchNextPage){wasHeldSearch=true;holdSearchNextPage=false;noteHeldSearch();await heldSearch;}
  if(p.has('name')&&offset===24&&!wasHeldSearch&&failSearchNextPage){failSearchNextPage=false;return route.fulfill({status:503,json:{error:'offline search fixture'}});}
  if(offset===24&&failNextPage){failNextPage=false;return route.fulfill({status:503,json:{error:'offline fixture'}});}
  const id=p.get('main_category_id')?.replace('eq.','');
  return route.fulfill({json:rows.filter(row=>!id||row.main_category_id===Number(id)).slice(offset,offset+limit)});
 });
 await page.locator('#retail-store-card-lenta').click();
 const buttons=page.locator('#retail-category-grid [data-category-id]');
 await expect(buttons).toHaveCount(6);
 await expect(page.locator('#retail-category-grid')).not.toContainText('Пустой раздел');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(24);
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#retail-load-more')).toHaveText('Повторить загрузку');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(24);
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(48);
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(64);
 await expect(page.locator('#retail-load-more')).toHaveCount(0);
 const ids=await page.locator('#product-grid .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId));
 expect(new Set(ids).size).toBe(64);
 await page.locator('#retail-category-grid [data-category-id="25"]').click();
 await expect(buttons).toHaveCount(2);
 await expect(page.locator('#retail-category-grid')).not.toContainText('Пустые крупы');
 await expect(page.locator('#search-status')).toHaveText('Выберите подкатегорию');
 await expect(page.locator('#empty-search')).toBeHidden();
 await expect(page.locator('#retail-category-note')).toHaveText('Выберите подкатегорию.');
 await page.locator('#retail-category-grid [data-category-id="31"]').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(30);
 await expect(page.locator('#product-grid .product-card').first()).toContainText('По Карте №1');
 await expect(page.locator('#retail-breadcrumbs .is-current')).toHaveText('Макароны');
 await page.reload();
 await expect(page.locator('#retail-breadcrumbs .is-current')).toHaveText('Макароны');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(30);
 const search=page.getByRole('searchbox',{name:'Найти продукты',exact:true});
 await search.fill('Продукт ЛЕНТА');
 await page.locator('#search-form').getByRole('button',{name:'Найти',exact:true}).click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(24);
 await page.locator('#retail-load-more').click();
 await heldSearchStarted;
 await search.fill('Совсем другой запрос');
 releaseHeldSearch();
 await expect(search).toHaveValue('Совсем другой запрос');
 await expect(page.locator('#catalog-search-prompt')).toBeVisible();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
 await search.fill('Продукт ЛЕНТА');
 await page.locator('#search-form').getByRole('button',{name:'Найти',exact:true}).click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(24);
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#retail-load-more')).toHaveText('Повторить загрузку');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(24);
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(48);
 await page.locator('#retail-load-more').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(64);
 await expect(page.locator('#retail-load-more')).toHaveCount(0);
 await expect(page.locator('#retail-page-end')).toHaveText('Все доступные товары показаны');
 const searchIds=await page.locator('#product-grid .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId));
 expect(new Set(searchIds).size).toBe(64);
 const searchReads=reads.filter(p=>p.name);
 expect(searchReads.map(p=>p.offset)).toEqual(['0','24','0','24','24','48']);
 expect(reads.filter(p=>p.depth||p.parent_id).every(p=>p.product_count==='gt.0')).toBe(true);
 expect(reads.every(p=>p.store_id==='eq.lenta-public-web')).toBe(true);
 await expectNoOverflow(page);
});

test('Lenta stale age is explicit and every public card remains display-only', async ({page}) => {
 await setup(page);
 const root={retailer_id:'lenta',store_id:'lenta-public-web',category_id:3,name:'Молочные продукты, яйцо',
  product_count:2,parent_id:null,root_id:3,depth:0,source_url:'https://lenta.com/catalog/molochnye-produkty/'};
 const row=(id,name,observedAt)=>({retailer_id:'lenta',store_id:'lenta-public-web',
  store_name:'Лента · публичный каталог',locality_id:'country-ru-public-catalog',locality_name:'Россия',
  source_product_id:id,name,weight_text:'1 л',main_category_id:3,price_minor:9999,currency:'RUB',
  price_condition:'loyalty-card-1',availability:'unknown',product_url:`https://lenta.com/product/${id}/`,
  source_url:root.source_url,image_url:`https://cdn.api.lenta.com/resample/${id}.png`,observed_at:observedAt});
 const rows=[row('stale-milk','Молоко со старой ценой','2026-10-01T08:30:00Z'),
  row('recent-milk','Молоко с недавней ценой','2026-10-20T08:30:00Z')];
 await page.route('https://cdn.api.lenta.com/resample/**',route=>route.fulfill({contentType:'image/png',
  body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wlq6AAAAABJRU5ErkJggg==','base64')}));
 await page.route('**/rest/v1/retail_catalog_categories**',route=>{
  const p=new URL(route.request().url()).searchParams;
  return route.fulfill({json:p.get('retailer_id')==='eq.lenta'?[root]:[]});
 });
 await page.route('**/rest/v1/retail_catalog_items**',route=>{
  const p=new URL(route.request().url()).searchParams;
  return route.fulfill({json:p.get('retailer_id')==='eq.lenta'?rows:[]});
 });
 await page.locator('#retail-store-card-lenta').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
 const stale=page.locator('.product-card',{hasText:'Молоко со старой ценой'});
 const recent=page.locator('.product-card',{hasText:'Молоко с недавней ценой'});
 await expect(stale).toContainText('Лента · данные устарели');
 await expect(stale).toContainText('Старая цена от');
 await expect(stale.locator('.add-button')).toBeDisabled();
 await expect(stale.locator('.add-button')).toHaveText('Старая цена · просмотр');
 await expect(stale.locator('.add-button')).toHaveAttribute('aria-label',/старая цена, только просмотр/u);
 await expect(recent).toContainText('Лента · цена наблюдалась');
 await expect(recent.locator('.add-button')).toBeDisabled();
 await expect(recent.locator('.add-button')).toHaveText('Пока только просмотр');
 await expect(stale.locator('.product-photo')).toHaveJSProperty('complete',true);
 await expectNoOverflow(page);
});

test('parent category guidance keeps product failures, empty leaves and empty search results distinct', async ({page}, testInfo) => {
 await setup(page);
 const category=(id,name,parent=null)=>({retailer_id:'lenta',store_id:'lenta-public-web',category_id:id,name,
  product_count:1,parent_id:parent,root_id:parent??id,depth:parent?1:0,source_url:`https://lenta.com/catalog/fixture-${id}/`});
 let failParent=true;
 await page.route('**/rest/v1/retail_catalog_categories**',route=>{
  const p=new URL(route.request().url()).searchParams;
  return route.fulfill({json:p.get('retailer_id')!=='eq.lenta'?[]:p.get('parent_id')==='eq.25'
   ?[category(31,'Макароны',25)]:p.has('parent_id')?[]:[category(25,'Макароны, крупы, мука')]});
 });
 await page.route('**/rest/v1/retail_catalog_items**',route=>{
  const p=new URL(route.request().url()).searchParams;
  if(p.get('main_category_id')==='eq.25'&&failParent){failParent=false;return route.fulfill({status:503,json:{error:'temporary fixture'}});}
  return route.fulfill({json:[]});
 });
 await page.locator('#retail-store-card-lenta').click();
 // A successful empty root is not hidden merely because it has categories.
 await expect(page.locator('#empty-search h3')).toHaveText('Ничего не нашли');
 await expect(page.locator('#empty-search')).toBeVisible();
 await page.locator('#retail-category-grid [data-category-id="25"]').click();
 await expect(page.locator('#retail-category-grid [data-category-id="31"]')).toBeVisible();
 // A failed products request remains explicit even when the children loaded.
 await expect(page.locator('#empty-search h3')).toHaveText('Не удалось загрузить товары');
 await expect(page.locator('#catalog-search-retry')).toBeVisible();
 await page.locator('#catalog-search-retry').click();
 await expect(page.locator('#search-status')).toHaveText('Выберите подкатегорию');
 await expect(page.locator('#empty-search')).toBeHidden();
 await expect(page.locator('.catalog-section .section-heading')).toBeHidden();
 await expect(page.locator('#retail-category-note')).toHaveText('Выберите подкатегорию.');
 await page.screenshot({path:testInfo.outputPath('parent-category.png')});
 // The existing category buttons remain keyboard operable.
 const leaf=page.locator('#retail-category-grid [data-category-id="31"]');
 await leaf.focus(); await page.keyboard.press('Enter');
 await expect(page.locator('#retail-breadcrumbs .is-current')).toHaveText('Макароны');
 await expect(page.locator('#empty-search')).toBeVisible();
 await expect(page.locator('#empty-search h3')).toHaveText('Ничего не нашли');
 await expect(page.locator('#empty-search')).toContainText('В этой категории пока нет данных о товарах');
 await expect(page.locator('.catalog-section .section-heading')).toBeVisible();
 await expect(page.locator('#catalog-search-retry')).toBeHidden();
 // Search is separate from category navigation, including with a saved path.
 await page.locator('#product-search').fill('Нет такого товара');
 await page.locator('.catalog-search-submit').click();
 await expect(page.locator('#empty-search')).toBeVisible();
 await expect(page.locator('#empty-search h3')).toHaveText('Ничего не нашли');
 await expect(page.locator('#search-status')).not.toHaveText('Выберите подкатегорию');
 await expectNoOverflow(page);
});

test('failed main listing keeps its collection and exposes an exact retry above it', async ({page}, testInfo) => {
 await setup(page,{collections:true});
 let rootAttempts=0,releaseRetry;
 const retryPending=new Promise(resolve=>{releaseRetry=resolve;});
 await page.route('**/rest/v1/retail_catalog_items**',async route=>{
  const p=new URL(route.request().url()).searchParams;
  if(p.get('retailer_id')==='eq.globus'&&!p.has('main_category_id')&&!p.has('category_url')
    &&!p.has('source_product_id')&&!p.has('name')&&p.get('limit')==='24'){
   rootAttempts++;
   if(rootAttempts===1)return route.fulfill({status:500,json:{error:'main listing fixture'}});
   await retryPending;
  }
  return route.fallback();
 });
 await selectStore(page);
 const notice=page.locator('#catalog-partial-notice');
 await expect(page.locator('#pixel-collections .product-card')).toHaveCount(2);
 await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
 await expect(notice).toBeVisible();
 await expect(notice).toContainText('Каталог загрузился не полностью. Подборка доступна.');
 await expect(page.locator('#empty-search')).toBeHidden();
 const first=page.locator('#pixel-collections .product-card').first();
 await first.locator('.add-button').click();
 const before=await savedBasket(page);
 expect(JSON.parse(before).length).toBe(1);
 const collectionIds=await page.locator('#pixel-collections .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId));
 await notice.scrollIntoViewIfNeeded();
 expect(await notice.evaluate(node=>Boolean(node.compareDocumentPosition(document.getElementById('pixel-collections'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await page.screenshot({path:testInfo.outputPath('main-listing-failed.png')});
 const attemptsBeforeRetry=rootAttempts;
 await notice.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
 await expect(notice).toContainText('Загружаем остальные товары');
 await expect(notice.getByRole('button')).toBeDisabled();
 expect(await savedBasket(page)).toBe(before);
 expect(await page.locator('#pixel-collections .product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.productId))).toEqual(collectionIds);
 releaseRetry();
 await expect(notice).toBeHidden();
 await expect(page.locator('#search-status')).toHaveText('Найдено товаров: 2');
 expect(rootAttempts).toBe(attemptsBeforeRetry+1);
 expect(await savedBasket(page)).toBe(before);
 await expect(page.locator('#pixel-collections .product-card')).toHaveCount(2);
 await expect(page.locator('#empty-search')).toBeHidden();
 await expectNoOverflow(page);
});

test('METRO selected address exposes its forty-eighth root and retains that address when opening products', async ({page}) => {
 await setup(page);
 const storeId='metro-address-da224d',source='https://online.metro-cc.ru/products/fixture-eggs-10';
 const address='141733,Московская обл., городской округ Лобня, Лобня г., промзона Горки Киовские ул., 15,1,Б,1,1-98,137-157';
 const rows=Array.from({length:48},(_,i)=>({retailer_id:'metro',store_id:storeId,category_id:900000+i,root_id:900000+i,
  name:i===47?'Яйца белые':`Категория ${String(i+1).padStart(2,'0')}`,parent_id:null,depth:0,product_count:1,
  source_url:`https://online.metro-cc.ru/dynamic/fixture-${i+1}`}));
 const reads=[];
 await page.route('**/rest/v1/retail_catalog_categories**',route=>{
  const p=new URL(route.request().url()).searchParams;reads.push(Object.fromEntries(p));
  return route.fulfill({json:p.get('store_id')===`eq.${storeId}`&&!p.has('parent_id')?rows.slice(0,Number(p.get('limit'))):[]});
 });
 await page.route('**/rest/v1/retail_catalog_items**',route=>{
  const p=new URL(route.request().url()).searchParams;reads.push(Object.fromEntries(p));
  return route.fulfill({json:p.get('store_id')===`eq.${storeId}`&&p.get('main_category_id')==='eq.900047'?[{
   retailer_id:'metro',store_id:storeId,binding_id:storeId,store_name:`METRO · ${address}`,
   locality_id:'region-moscow-oblast',locality_name:'Московская область',source_product_id:'test-eggs-10',
   name:'Яйца белые С1, 10 шт',weight_text:'10 шт',main_category_id:900047,price_minor:14990,currency:'RUB',
   price_condition:'regular',availability:'unknown',sales_channel:'online',minimum_quantity:1,
   scope_binding:'same-source',location_label:address,scope_evidence_url:source,product_url:source,source_url:source,
   image_url:null,observed_at:'2026-10-20T08:30:00Z'}]:[]});
 });
 await page.locator('#retail-store-card-metro').click();
 await page.getByRole('button',{name:'Выбрать магазин вручную',exact:true}).click();
 await page.locator('#metro-store-picker input[type=search]').fill('Лобня');
 await page.locator('#pixel-address-chooser [data-store-id="1318"]').click();
 await expect(page.locator('.pixel-store-address')).toContainText('Лобня');
 await page.getByRole('button',{name:'Все категории',exact:true}).click();
 await expect(page.locator('#retail-category-grid [data-category-id]')).toHaveCount(48);
 await page.locator('#retail-category-grid [data-category-id="900047"]').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
 await expect(page.locator('#product-grid')).toContainText('149,90 ₽');
 await expect(page.locator('#retail-breadcrumbs .is-current')).toHaveText('Яйца белые');
 expect(reads.find(p=>p.depth==='eq.0')?.limit).toBe('160');
 expect(reads.every(p=>p.store_id===`eq.${storeId}`)).toBe(true);
 await expectNoOverflow(page);
});

test('cold stores home and its local chain filter make no catalogue, global-search or AI requests',async({page})=>{
 const calls=await setup(page);
 await expect(page.locator('#pixel-storefront')).toBeHidden();
 await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
 await expect(page.locator('#retail-store-card')).toBeVisible();
 await expect(page.locator('#retail-store-card-magnit')).toBeVisible();
 await expect(page.locator('#nearby-address')).toBeVisible();
 await expect(page.locator('#pixel-store-search')).toBeHidden();
 await page.getByText('Поиск по сетям и адресам', {exact:true}).click();
 await page.locator('#pixel-store-search').fill('Магнит');
 await expect(page.locator('#retail-store-card-magnit')).toBeVisible();
 await expect(page.locator('#retail-store-card')).toBeHidden();
 await page.locator('#pixel-store-search').fill('такой сети нет');
 await expect(page.locator('#retail-store-grid .retail-store-card:visible')).toHaveCount(0);
 await page.getByText('Поиск по сетям и адресам', {exact:true}).click();
 await expect(page.locator('#retail-store-card')).toBeVisible();
 // Allow an accidental debounce to surface: this filter is entirely local.
 await page.waitForTimeout(350);
 expect(calls).toEqual({categories:[],items:[],global:0,ai:0});
 await expectNoOverflow(page);
});

test('city search exposes only selectable exact addresses and opens their own catalogues',async({page})=>{
 test.setTimeout(75_000);
 const calls=await setup(page);
 if (await page.locator(".pixel-directory-search:not([open])").count()) await page.getByText("Поиск по сетям и адресам", {exact:true}).click();
 const search=page.locator('#pixel-store-search');
 await search.fill('Пушкино');
 await expect(page.locator('#retail-store-grid .retail-store-card:visible')).toHaveCount(2);
 await expect(page.locator('#retail-store-card-magnit')).toBeVisible();
 await expect(page.locator('#retail-store-card')).toBeVisible();
 const magnitAddresses=page.locator('#pixel-store-address-results button[data-retailer-id="magnit"]');
 const globusAddress=page.locator('#pixel-store-address-results button[data-retailer-id="globus"][data-store-id="5014"]');
 const addressChoices=page.locator('#pixel-store-address-results button[data-store-id]');
 await expect(addressChoices).toHaveCount(5);
 expect(await magnitAddresses.count()).toBeGreaterThan(0);
 await expect(globusAddress).toBeVisible();
 await expect(globusAddress).toContainText('Глобус Пушкино');
 await expect(globusAddress).not.toContainText('дата цен после выбора');
 const showMore=page.locator('.pixel-store-address-toggle');
 await expect(showMore).toHaveText('Показать ещё 5');
 await showMore.click();
 await expect(addressChoices).toHaveCount(10);
 await page.locator('.pixel-store-address-toggle').click();
 await expect(addressChoices).toHaveCount(11);
 await expect(page.locator('.pixel-store-address-toggle')).toHaveCount(0);
 await expect(page.locator('#pixel-store-status')).toHaveText('Подходящие сети: 2');
 expect(calls).toEqual({categories:[],items:[],global:0,ai:0});

 const magnitCode=await magnitAddresses.first().getAttribute('data-store-id');
 await magnitAddresses.first().click();
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 await expect(page.locator('#magnit-store-address')).toHaveValue(magnitCode);
 await expect(page.locator('.pixel-store-address')).toContainText('Пушкино');
 const magnitReads=[...calls.categories,...calls.items].filter(row=>row.retailer_id==='eq.magnit');
 expect(magnitReads.length).toBeGreaterThan(0);
 expect(magnitReads.every(row=>row.store_id===`eq.magnit-${magnitCode}`)).toBe(true);

 await openStores(page);
 await expect(globusAddress).toBeVisible();
 const beforeGlobus=calls.categories.length;
 await globusAddress.click();
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 await expect(page.locator('#globus-store-address')).toHaveValue('5014');
 await expect(page.locator('.pixel-store-address')).toContainText('Пушкино');
 const globusReads=calls.categories.slice(beforeGlobus).filter(row=>row.retailer_id==='eq.globus');
 expect(globusReads.length).toBeGreaterThan(0);
 expect(globusReads.every(row=>row.store_id==='eq.globus-store-5014')).toBe(true);
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.locator('#globus-store-address')).toHaveValue('5014');
 await expect(page.locator('.pixel-store-address')).toContainText('Пушкино');
 await expectNoOverflow(page);
});

test('the internal default becomes explicitly selected on entry and retains real category identities and search scope',async({page})=>{
 const calls=await setup(page,{expandedRoots:true});
 await expect(page.locator('#retail-store-card')).toHaveAttribute('aria-pressed','false');
 await selectStore(page);
 await expect(page.locator('#retail-store-card')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
 const rootButtons=page.locator('#retail-category-grid button[data-category-id]');
 await expect(rootButtons).toHaveCount(7);
 expect(await rootButtons.evaluateAll(nodes=>nodes.map(node=>node.dataset.categoryId))).toEqual([
  brandsId,readyId,dairyId,10110003,10110004,10110005,10110006
 ].map(String));
 await expect(page.locator('#retail-category-grid .pixel-all-categories')).toHaveText('Все категории');
 expect(await page.locator('#retail-category-grid .pixel-all-categories').getAttribute('data-category-id')).toBeNull();
 await expect(page.locator(`#retail-category-grid button[data-category-id="${groceryId}"]`)).toHaveCount(0);
 await page.getByRole('button',{name:'Все категории',exact:true}).click();
 await expect(rootButtons).toHaveCount(9);
 expect((await rootButtons.evaluateAll(nodes=>nodes.map(node=>node.dataset.categoryId))).sort()).toEqual(
  [...categories,...extraRootCategories].map(c=>String(c.category_id)).sort()
 );
 await expect(page.locator('#retail-category-grid .pixel-all-categories')).toHaveCount(0);
 // The newly revealed source category, not a synthetic "all" ID, navigates.
 await page.locator(`#retail-category-grid button[data-category-id="${groceryId}"]`).click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
 await expect(page.locator('#product-grid')).toContainText('Рис круглозерный');
 await expect(page.locator('#retail-breadcrumbs .is-current')).toHaveText('Бакалея');
 expect(calls.items.some(call=>call.category_url===`like.${categoryUrl(groceryId)}*`&&call.limit==='40')).toBe(true);
 await page.locator('#retail-breadcrumbs').getByRole('button',{name:'Категории',exact:true}).click();
 await expect(rootButtons).toHaveCount(7);
 await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
 await expect(page.locator('#pixel-collections .pixel-collection')).toHaveCount(0);
 await page.locator(`#retail-category-grid button[data-category-id="${dairyId}"]`).click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
 await expect(page.locator('#product-grid')).toContainText('Молоко Parmalat');
 expect(calls.items.some(call=>call.category_url===`like.${categoryUrl(dairyId)}*`)).toBe(true);
 await page.getByRole('searchbox',{name:'Найти продукты',exact:true}).fill('рис');
 await page.locator('#search-form').getByRole('button',{name:'Найти',exact:true}).click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
 await expect(page.locator('#product-grid')).toContainText('Рис круглозерный');
 await expect(page.locator('#product-grid')).not.toContainText('Чужой глобальный товар');
 const searched=calls.items.filter(call=>call.name);
 expect(searched).toHaveLength(1);expect(searched[0].retailer_id).toBe('eq.globus');expect(searched[0].store_id).toBe('eq.globus-store-5011');
 expect(calls.global).toBe(0);expect(calls.ai).toBe(0);
});

test('nonempty source collections deduplicate shared SKUs and keep list controls and real category navigation',async({page})=>{
 const calls=await setup(page,{collections:true});
 await selectStore(page);
 const rails=page.locator('#pixel-collections');
 const brands=rails.locator('.pixel-collection').filter({has:page.getByRole('heading',{name:'Наши бренды',exact:true})});
 const ready=rails.locator('.pixel-collection').filter({has:page.getByRole('heading',{name:'Вся готовая еда',exact:true})});
 await expect(rails.locator('.pixel-collection > header h2')).toHaveText(['Наши бренды','Вся готовая еда']);
 await expect(brands.locator('.product-card')).toHaveCount(1);
 await expect(ready.locator('.product-card')).toHaveCount(1);
 await expect(brands.getByRole('heading',{level:3})).toHaveText(products[0].name);
 await expect(ready.getByRole('heading',{level:3})).toHaveText(products[1].name);
 const retailIds=products.map(row=>`retail:globus:globus-store-5011:${row.source_product_id}`);
 expect((await page.locator('#pixel-storefront .product-card').evaluateAll(nodes=>nodes.map(node=>node.dataset.productId))).sort()).toEqual([...retailIds].sort());
 await expect(page.locator('#product-grid .product-card')).toHaveCount(0);
 for(const id of [brandsId,readyId]){
  expect(calls.items.some(call=>call.category_url===`like.${categoryUrl(id)}*`&&call.limit==='6')).toBe(true);
 }

 const milk=brands.locator('.product-card');
 const rice=ready.locator('.product-card');
 // Real store roots can contain only collections, with an empty product grid.
 // The same product dialogue must work there and delegate to that exact card.
 await milk.locator('.shopping-detail-trigger').click();
 const productDialog=page.getByRole('dialog',{name:'Информация о товаре',exact:true});
 await expect(productDialog).toBeVisible();
 await expect(productDialog).toContainText(products[0].name);
 await productDialog.getByRole('button',{name:'Добавить в корзину',exact:true}).click();
 await expect(productDialog).toBeHidden();
 await expect(milk.locator('.pixel-quantity')).toHaveText('1');
 await addButton(milk).click();
 await expect(milk.locator('.pixel-quantity')).toHaveText('2');
 await milk.locator('.pixel-remove-one').click();
 await expect(milk.locator('.pixel-quantity')).toHaveText('1');
 await milk.locator('.pixel-remove-one').click();
 await expect(milk.locator('.pixel-quantity')).toHaveCount(0);
 await expect(milk.locator('.pixel-remove-one')).toHaveCount(0);
 await expect(page.locator('#pixel-list-count')).toHaveText('0');
 await addButton(milk).click();
 await addButton(rice).click();
 await expect(milk.locator('.pixel-quantity')).toHaveText('1');
 await expect(rice.locator('.pixel-quantity')).toHaveText('1');
 await expect(page.locator('#pixel-list-count')).toHaveText('2');
 await expect(page.locator('#basket-view')).toBeHidden();
 await openBasket(page);
 await expect(page.locator('.basket-row')).toHaveCount(2);
 await expect(page.locator('.basket-row').filter({hasText:'Молоко Parmalat'}).locator('.stepper-value')).toHaveText('1');
 await expect(page.locator('.basket-row').filter({hasText:'Рис круглозерный'}).locator('.stepper-value')).toHaveText('1');
 await page.goBack();
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 await expect(milk.locator('.pixel-quantity')).toHaveText('1');
 await expect(rice.locator('.pixel-quantity')).toHaveText('1');

 await brands.getByRole('button',{name:'Все товары: Наши бренды',exact:true}).click();
 await expect(rails).toBeHidden();
 await expect(page.locator('#catalog-title')).toHaveText('Наши бренды');
 await expect(page.locator('#retail-breadcrumbs .is-current')).toHaveText('Наши бренды');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(1);
 await expect(page.locator('#product-grid .product-card')).toHaveAttribute('data-product-id',retailIds[0]);
 await expect(page.locator('#product-grid .pixel-quantity')).toHaveText('1');
 expect(calls.items.some(call=>call.category_url===`like.${categoryUrl(brandsId)}*`&&call.limit==='40')).toBe(true);

 await page.locator('#retail-breadcrumbs').getByRole('button',{name:'Категории',exact:true}).click();
 await expect(rails.locator('.pixel-collection')).toHaveCount(2);
 await ready.getByRole('button',{name:'Все товары: Вся готовая еда',exact:true}).click();
 await expect(rails).toBeHidden();
 await expect(page.locator('#catalog-title')).toHaveText('Вся готовая еда');
 await expect(page.locator('#retail-breadcrumbs .is-current')).toHaveText('Вся готовая еда');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
 // Category navigation restores its complete matching set, including the
 // shared milk SKU that was intentionally shown only in the first root rail.
 expect((await page.locator('#product-grid .product-card').evaluateAll(nodes=>nodes.map(node=>node.dataset.productId))).sort()).toEqual([...retailIds].sort());
 await expect(page.locator('#product-grid .pixel-quantity')).toHaveText(['1','1']);
 expect(calls.items.some(call=>call.category_url===`like.${categoryUrl(readyId)}*`&&call.limit==='40')).toBe(true);
 expect(calls.categories.some(call=>call.parent_id===`eq.${brandsId}`)).toBe(true);
 expect(calls.categories.some(call=>call.parent_id===`eq.${readyId}`)).toBe(true);
 expect(calls.global).toBe(0);expect(calls.ai).toBe(0);
 await expectNoOverflow(page);
});

test('a category click supersedes a pending root load and late root responses preserve the chosen category and basket',async({page})=>{
 const calls=await setup(page,{collections:true,expandedRoots:true});await selectStore(page);
 const rails=page.locator('#pixel-collections');
 const brands=rails.locator('.pixel-collection').filter({has:page.getByRole('heading',{name:'Наши бренды',exact:true})});
 const ready=rails.locator('.pixel-collection').filter({has:page.getByRole('heading',{name:'Вся готовая еда',exact:true})});
 await expect(rails.locator('.pixel-collection')).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Все категории',exact:true})).toBeVisible();
 await addButton(brands.locator('.product-card')).click();await expect(page.locator('#pixel-list-count')).toHaveText('1');
 const saved=await savedBasket(page);
 await brands.getByRole('button',{name:'Все товары: Наши бренды',exact:true}).click();
 await expect(page.locator('#catalog-title')).toHaveText('Наши бренды');

 let releaseRoot;const pendingRoot=new Promise(resolve=>{releaseRoot=resolve;});
 let held=0;
 const isRoot=request=>{
  const u=new URL(request.url()),p=u.searchParams;
  return p.get('retailer_id')==='eq.globus'&&p.get('store_id')==='eq.globus-store-5011'
   &&(u.pathname.endsWith('/retail_catalog_categories')?!p.has('parent_id')
    :!p.has('category_url')&&!p.has('main_category_id')&&!p.has('name'));
 };
 const holdRoot=async route=>{if(isRoot(route.request())){held++;await pendingRoot;}return route.fallback();};
 await page.route('**/rest/v1/retail_catalog_categories**',holdRoot);
 await page.route('**/rest/v1/retail_catalog_items**',holdRoot);
 try{
  await page.locator('#retail-breadcrumbs').getByRole('button',{name:'Категории',exact:true}).click();
  await expect.poll(()=>held).toBe(2);
  // The category grid removes its old tiles and "all" button synchronously;
  // collection links are the visible root destinations during this refresh.
  await expect(page.locator('#retail-category-grid button[data-category-id]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Все категории',exact:true})).toHaveCount(0);
  await expect(page.locator('#retail-category-grid .is-loading')).toBeDisabled();
  await ready.getByRole('button',{name:'Все товары: Вся готовая еда',exact:true}).click();
  await expect(page.locator('#catalog-title')).toHaveText('Вся готовая еда');
  await expect(page.locator('#retail-breadcrumbs .is-current')).toHaveText('Вся готовая еда');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  expect(await savedBasket(page)).toBe(saved);

  const oldCategories=page.waitForResponse(response=>isRoot(response.request())&&response.url().includes('/retail_catalog_categories'));
  const oldProducts=page.waitForResponse(response=>isRoot(response.request())&&response.url().includes('/retail_catalog_items'));
  releaseRoot();
  const responses=await Promise.all([oldCategories,oldProducts]);expect(responses.map(response=>response.status())).toEqual([200,200]);
  await Promise.all(responses.map(response=>response.finished()));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(rails).toBeHidden();
  await expect(page.locator('#catalog-title')).toHaveText('Вся готовая еда');
  await expect(page.locator('#retail-breadcrumbs .is-current')).toHaveText('Вся готовая еда');
  await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
  expect(await page.evaluate(()=>history.state.checkniRetailPath.map(category=>category.categoryId))).toEqual([readyId]);
  expect(await savedBasket(page)).toBe(saved);await expect(page.locator('#pixel-list-count')).toHaveText('1');
  expect(calls.items.some(call=>call.category_url===`like.${categoryUrl(readyId)}*`&&call.limit==='40')).toBe(true);
  expect(calls.global).toBe(0);expect(calls.ai).toBe(0);
 }finally{releaseRoot();}
});

test('store → basket → Back/reload → stores and brand home preserve quantities and surface history',async({page})=>{
 await setup(page);await selectStore(page);
 const card=page.locator('#product-grid .product-card').filter({hasText:'Молоко Parmalat'});
 await addButton(card).click();
 await expect(card.locator('.pixel-quantity')).toHaveText('1');
 const saved=await savedBasket(page);
 await openBasket(page);await expect(page.locator('.basket-row')).toHaveCount(1);
 await page.goBack();await expect(page.locator('#pixel-storefront')).toBeVisible();
 await expect(page.locator('#pixel-store-home')).toBeHidden();
 await page.reload();await expect(page.locator('#pixel-storefront')).toBeVisible();
 expect(await savedBasket(page)).toBe(saved);
 await page.locator('.brand').click();
 await expect(page.locator('#pixel-store-home')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
 await page.goBack();await expect(page.locator('#pixel-storefront')).toBeVisible();
 await expect(card.locator('.pixel-quantity')).toHaveText('1');
 await openBasket(page);await page.locator('.brand').click();
 await expect(page.locator('#pixel-store-home')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
 await page.goBack();await expect(page.locator('#basket-view')).toBeVisible();
 await expect(page.locator('.basket-row')).toHaveCount(1);
 await page.goBack();await expect(page.locator('#pixel-storefront')).toBeVisible();
 await expect(card.locator('.pixel-quantity')).toHaveText('1');
 await openStores(page);await expect(page.locator('#pixel-storefront')).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
 await page.reload();await expect(page.locator('#pixel-store-home')).toBeVisible();
 await expect(page.locator('#pixel-storefront')).toBeHidden();expect(await savedBasket(page)).toBe(saved);
 await selectStore(page);await expect(card.locator('.pixel-quantity')).toHaveText('1');
 await expectNoOverflow(page);
});

test('optional Hory opens and closes over the same store without applying draft changes to the basket',async({page})=>{
 const calls=await setup(page);await selectStore(page);
 const entry=page.getByRole('button',{name:'Хоря — помогу с покупками',exact:true});
 await expect(entry).toBeVisible();
 const hit=await entry.boundingBox(); expect(hit.width).toBeGreaterThanOrEqual(44); expect(hit.height).toBeGreaterThanOrEqual(44);
 await addButton(page.locator('#product-grid .product-card').first()).click();const saved=await savedBasket(page);
 await openHory(page);await expect(page.locator('#pixel-hory-dialog')).toHaveJSProperty('open',true);
 await expect(page.locator('#pixel-hory-dialog')).toContainText('Помогу выбрать продукты и собрать список.');
 await page.locator('#basket-proposal-input').fill('Два молока и рис');
 await closeHory(page);await expect(page.locator('[data-pixel-action="hory"]')).toBeFocused();
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 expect(await savedBasket(page)).toBe(saved);
 await page.locator('#hori-theme').click();await openHory(page);
 await expect(page.locator('#basket-proposal-input')).toHaveValue('Два молока и рис');
 expect(await savedBasket(page)).toBe(saved);expect(calls.ai).toBe(0);
 await closeHory(page);await expectNoOverflow(page);
});
