import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

// Fully synthetic transport, fixed photos/time and bundled fonts for visual
// regression. It proves presentation and the existing basket pipeline, not
// actual retailer prices, stock, coverage or a live provider response.
const products=[
 ['000000000000026730_ST','Молоко Parmalat 3,5%, 1л','1 л',14199,'moloko-parmalat-35-1l-26730_ST','milk'],
 ['000000000000022104_ST','Крупа гречневая Агро-Альянс Экстра Элитная, 900г','900 г',10599,'krupa-grechnevaya-agro-alyans-ekstra-elitnaya-900g-22104_ST','buckwheat'],
 ['000000000000754268_ST','Рис круглозерный Увелка, 800г','800 г',18399,'ris-kruglozernyj-uvelka-800g-754268_ST','rice']
].map(([id,name,weight,price,slug,photo])=>({retailer_id:'globus',store_id:'globus-store-5011',store_name:'Глобус Красногорск',locality_id:'city-moscow',locality_name:'Москва',source_product_id:id,name,weight_text:weight,price_minor:price,currency:'RUB',price_condition:'regular',sales_channel:'store',minimum_quantity:1,availability:'unknown',main_category_id:1,product_url:'https://www.globus.ru/products/'+slug+'/',image_url:'https://image.globus.ru/hori-v13-fixture/'+photo+'.jpg',source_url:'https://www.globus.ru/catalog/food',scope_evidence_url:'https://www.globus.ru/catalog/food',scope_binding:'same-source',binding_id:'store:5011',location_label:'г. Москва, вн.тер.г. муниципальный округ Кунцево, Новорижское шоссе 22-й км, д. 1 стр. 1',observed_at:'2026-10-19T08:30:00Z'}));
const categories=['Молочное','Бакалея','Овощи и фрукты','Мясо'].map((name,i)=>({retailer_id:'globus',store_id:'globus-store-5011',category_id:i+1,name,parent_id:null,root_id:i+1,depth:0,source_url:'https://www.globus.ru/catalog/food',product_count:3}));
async function setup(page){
 await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 await page.route('**/rest/v1/retail_catalog_categories**',route=>route.fulfill({json:categories}));
 await page.route('**/rest/v1/retail_catalog_items**',route=>{const p=new URL(route.request().url()).searchParams;return route.fulfill({json:p.get('retailer_id')==='eq.globus'?products:[]});});
 await page.route('https://image.globus.ru/hori-v13-fixture/**',route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({contentType:'image/jpeg',body:readFileSync(new URL('../fixtures/hori-v13/'+name,import.meta.url))});});
 await page.route('**/src/ports/observedOffersPort.mjs',route=>route.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={async load(){return [];}};'}));
 await page.route('**/functions/v1/ai-basket-proposal',route=>route.abort());
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(3);
 await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>page.locator('.hori-scene img').evaluate(img=>img.complete&&img.naturalWidth>1000)).toBe(true);
 await expect.poll(()=>page.locator('#product-grid .product-photo').evaluateAll(images=>images.length===3&&images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
}

test('approved v13 has equal working halves, complete cards and a stable visual baseline',async({page},info)=>{
 const mobile=info.project.name.includes('mobile');
 await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:720});
 await setup(page);
 const ai=await page.locator('.hori-stage').boundingBox(),commerce=await page.locator('#main').boundingBox();
 expect(Math.abs(ai.height-commerce.height)).toBeLessThanOrEqual(2);
 const composer=await page.locator('.hori-composer').boundingBox();
 expect(composer.y+composer.height).toBeLessThanOrEqual(ai.y+ai.height);
 expect(composer.width).toBeGreaterThan(ai.width*.85);
 const bottom=await page.locator('#hori-shop-pane').evaluate(el=>el.getBoundingClientRect().bottom);
 for(const card of await page.locator('#product-grid .product-card').all().then(cards=>cards.slice(0,mobile?2:3))){
  const box=await card.boundingBox();expect(box.y).toBeGreaterThanOrEqual(commerce.y);expect(box.y+box.height).toBeLessThanOrEqual(bottom+1);
  await expect(card.getByRole('button')).toBeInViewport();
  await expect(card.locator('a.product-unit')).toContainText('19.10');
  await expect(card.locator('.product-price')).toContainText('без карты');
 }
 await expect(page.locator('.shopping-welcome')).not.toContainText(/3 человека|7 дней|600/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Each OS has its own inspected baseline. Data, fonts, scene, viewport,
 // photos and CSS-pixel scale remain pinned; the mismatch bound stays 1%.
 await expect(page).toHaveScreenshot('v13-'+(mobile?'mobile':'desktop')+'.png',{
  scale:'css',animations:'disabled',maxDiffPixelRatio:.01,threshold:.2
 });
});

test('single header picker preserves the draft, basket quantities, compare, Back and reload',async({page},info)=>{
 await setup(page);
 await page.locator('#basket-proposal-input').fill('Молоко и рис');
 await page.locator('.hori-selected-store').click();
 await expect(page.locator('#hori-store-dialog')).toBeVisible();
 await expect(page.locator('#retail-store-grid')).toHaveCount(1);
 await page.keyboard.press('Escape');
 await expect(page.locator('.hori-selected-store')).toBeFocused();
 await page.locator('.hori-selected-store').click();
 await page.locator('#retail-store-card-metro').click();
 await expect(page.locator('#hori-store-dialog')).not.toBeVisible();
 await expect(page.locator('.hori-selected-store')).toContainText('METRO');
 await page.locator('.hori-selected-store').click();await page.locator('#retail-store-card').click();
 await expect(page.locator('#product-grid .product-card')).toHaveCount(3);
 await page.locator('#product-grid .product-card').first().getByRole('button').click();
 const saved=await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'));
 await page.locator('#hori-theme').click();
 await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко и рис');
 expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(saved);
 if(!info.project.name.includes('mobile')){
  await page.locator('#hori-basket-preview').getByRole('button',{name:/Быстрая корзина: увеличить/}).click();
  await expect(page.locator('#hori-basket-preview output')).toHaveText('2');
 }
 const retained=await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'));
 await page.locator('#open-basket').click();await page.locator('#compare-basket').click();
 await expect(page.locator('#comparison-output')).toContainText(/недостаточно|нет|не удалось/i);
 await expect(page.locator('#basket-proposal-input')).toBeInViewport();
 await page.goBack();await page.reload();
 expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(retained);
});

test('small and keyboard-height viewports keep input and store access usable',async({page})=>{
 await setup(page);
 for(const viewport of [{width:320,height:568},{width:390,height:550}]){
  await page.setViewportSize(viewport);
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  await expect(page.locator('#basket-proposal-submit')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.locator('.hori-selected-store').click();await expect(page.locator('#hori-store-dialog')).toBeVisible();
 await page.locator('#hori-store-dialog').getByRole('button',{name:'Готово',exact:true}).click();
 await page.locator('.hori-location').click();await expect(page.locator('#nearby-address')).toBeVisible();
 await expect(page.locator('#basket-proposal-input')).toBeInViewport();
});
