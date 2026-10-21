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

async function setup(page){
 await page.clock.setFixedTime(new Date('2026-10-20T09:00:00Z'));
 const calls={categories:[],items:[],global:0,ai:0};
 await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('**/rest/v1/**',route=>route.fulfill({json:[]}));
 await page.route('**/functions/v1/catalog-search',route=>{calls.global++;return route.fulfill({json:{kind:'catalog',products:[{id:'unrelated-global-fixture',name:'Чужой глобальный товар'}],partial:false}});});
 await page.route('**/functions/v1/ai-basket-proposal',route=>{calls.ai++;return route.abort();});
 await page.route('**/src/ports/observedOffersPort.mjs',route=>route.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={async load(){return [];}};'}));
 await page.route('**/rest/v1/retail_catalog_categories**',route=>{
  const p=new URL(route.request().url()).searchParams;calls.categories.push(Object.fromEntries(p));
  return route.fulfill({json:p.get('retailer_id')==='eq.globus'&&!p.has('parent_id')?categories:[]});
 });
 await page.route('**/rest/v1/retail_catalog_items**',route=>{
  const p=new URL(route.request().url()).searchParams;calls.items.push(Object.fromEntries(p));
  const q=(p.get('name')??'').replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ').toLocaleLowerCase('ru-RU');
  const category=p.get('main_category_id')?.replace('eq.','');
  const categoryPrefix=p.get('category_url')?.replace(/^like\./u,'').replace(/\*$/u,'');
  return route.fulfill({json:p.get('retailer_id')==='eq.globus'&&p.get('store_id')==='eq.globus-store-5011'
   ?products.filter(row=>(!category||String(row.main_category_id)===category)&&(!categoryPrefix||categoryUrl(row.main_category_id)===categoryPrefix)&&row.name.toLocaleLowerCase('ru-RU').includes(q)):[]});
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
 const calls=await setup(page);
 await expect(page.locator('#retail-store-card')).toHaveAttribute('aria-pressed','false');
 await selectStore(page);
 await expect(page.locator('#retail-store-card')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(2);
 const rootButtons=page.locator('#retail-category-grid button[data-category-id]');
 expect((await rootButtons.evaluateAll(nodes=>nodes.map(node=>node.dataset.categoryId))).sort()).toEqual(categories.map(c=>String(c.category_id)).sort());
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
