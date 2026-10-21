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

test('cold stores home and its local chain filter make no catalogue, global-search or AI requests',async({page})=>{
 const calls=await setup(page);
 await expect(page.locator('#pixel-storefront')).toBeHidden();
 await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
 await expect(page.locator('#retail-store-card')).toBeVisible();
 await expect(page.locator('#retail-store-card-magnit')).toBeVisible();
 await page.locator('#pixel-store-search').fill('Магнит');
 await expect(page.locator('#retail-store-card-magnit')).toBeVisible();
 await expect(page.locator('#retail-store-card')).toBeHidden();
 await page.locator('#pixel-store-search').fill('такой сети нет');
 await expect(page.locator('#retail-store-grid .retail-store-card:visible')).toHaveCount(0);
 await page.locator('#pixel-store-search').fill('');
 await expect(page.locator('#retail-store-card')).toBeVisible();
 // Allow an accidental debounce to surface: this filter is entirely local.
 await page.waitForTimeout(350);
 expect(calls).toEqual({categories:[],items:[],global:0,ai:0});
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
 await addButton(milk).click();
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

test('store → basket → Back/reload → stores preserves quantities and restores the chosen surface',async({page})=>{
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
 await openStores(page);await expect(page.locator('#pixel-storefront')).toBeHidden();
 await page.reload();await expect(page.locator('#pixel-store-home')).toBeVisible();
 await expect(page.locator('#pixel-storefront')).toBeHidden();expect(await savedBasket(page)).toBe(saved);
 await selectStore(page);await expect(card.locator('.pixel-quantity')).toHaveText('1');
 await expectNoOverflow(page);
});

test('optional Hory opens and closes over the same store without applying draft changes to the basket',async({page})=>{
 const calls=await setup(page);await selectStore(page);
 await addButton(page.locator('#product-grid .product-card').first()).click();const saved=await savedBasket(page);
 await openHory(page);await expect(page.locator('#pixel-hory-dialog')).toHaveJSProperty('open',true);
 await page.locator('#basket-proposal-input').fill('Два молока и рис');
 await closeHory(page);await expect(page.locator('[data-pixel-action="hory"]')).toBeFocused();
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 expect(await savedBasket(page)).toBe(saved);
 await page.locator('#hori-theme').click();await openHory(page);
 await expect(page.locator('#basket-proposal-input')).toHaveValue('Два молока и рис');
 expect(await savedBasket(page)).toBe(saved);expect(calls.ai).toBe(0);
 await closeHory(page);await expectNoOverflow(page);
});
