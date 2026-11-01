import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import { selectStore, openHory, closeHory, openStoreDetails, openBasket, addButton, expectNoOverflow } from './helpers/pixel-surface.mjs';

// Fully synthetic transport, fixed photos/time and bundled fonts for visual
// regression. It proves presentation and the existing basket pipeline, not
// actual retailer prices, stock, coverage or a live provider response.
const products=[
 ['000000000000026730_ST','Молоко Parmalat 3,5%, 1л','1 л',14199,'moloko-parmalat-35-1l-26730_ST','milk'],
 ['000000000000022104_ST','Крупа гречневая Агро-Альянс Экстра Элитная, 900г','900 г',10599,'krupa-grechnevaya-agro-alyans-ekstra-elitnaya-900g-22104_ST','buckwheat'],
 ['000000000000754268_ST','Рис круглозерный Увелка, 800г','800 г',18399,'ris-kruglozernyj-uvelka-800g-754268_ST','rice']
].map(([id,name,weight,price,slug,photo])=>({retailer_id:'globus',store_id:'globus-store-5011',store_name:'Глобус Красногорск',locality_id:'city-moscow',locality_name:'Москва',source_product_id:id,name,weight_text:weight,price_minor:price,currency:'RUB',price_condition:'regular',sales_channel:'store',minimum_quantity:1,availability:'unknown',main_category_id:1,product_url:'https://www.globus.ru/products/'+slug+'/',image_url:'https://image.globus.ru/hori-v13-fixture/'+photo+'.jpg',source_url:'https://www.globus.ru/catalog/food',scope_evidence_url:'https://www.globus.ru/catalog/food',scope_binding:'same-source',binding_id:'store:5011',location_label:'г. Москва, вн.тер.г. муниципальный округ Кунцево, Новорижское шоссе 22-й км, д. 1 стр. 1',observed_at:'2026-10-19T08:30:00Z'}));
const categories=['Молочное','Бакалея','Овощи и фрукты','Мясо'].map((name,i)=>({retailer_id:'globus',store_id:'globus-store-5011',category_id:i+1,name,parent_id:null,root_id:i+1,depth:0,source_url:'https://www.globus.ru/catalog/food',product_count:3}));
async function setup(page,{open=true}={}){
 await page.clock.setFixedTime(new Date('2026-10-19T09:00:00Z'));
 await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 await page.route('**/rest/v1/retail_catalog_categories**',route=>route.fulfill({json:categories}));
 await page.route('**/rest/v1/retail_catalog_items**',route=>{const p=new URL(route.request().url()).searchParams;return route.fulfill({json:p.get('retailer_id')==='eq.globus'?products:[]});});
 await page.route('https://image.globus.ru/hori-v13-fixture/**',route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({contentType:'image/jpeg',body:readFileSync(new URL('../fixtures/hori-v13/'+name,import.meta.url))});});
 await page.route('**/src/ports/observedOffersPort.mjs',route=>route.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={async load(){return [];}};'}));
 await page.route('**/functions/v1/ai-basket-proposal',route=>route.abort());
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await expect(page.locator('#pixel-store-home')).toBeVisible();
 if(!open)return;
 await selectStore(page);
 await expect(page.locator('#product-grid .product-card')).toHaveCount(3);
 await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>page.locator('#product-grid .product-photo').evaluateAll(images=>images.length===3&&images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
}

// The previous equal-half v13 screenshots describe a retired interaction model.
// New names deliberately require fresh CI captures and human inspection; do not
// copy, stretch or relax the old PNGs or their unchanged 1% mismatch bound.
test('approved PixelCharacter has stable stores-first and storefront visual baselines with complete cards',async({page},info)=>{
 const mobile=info.project.name.includes('mobile');
 await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:720});
 await setup(page,{open:false});
 await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
 await expectNoOverflow(page);
 // A missing first baseline still fails this test, while allowing CI to
 // capture the independent storefront image for the same human review.
 await expect.soft(page).toHaveScreenshot('pixel-address-first-home-'+(mobile?'mobile':'desktop')+'.png',{
  scale:'css',animations:'disabled',maxDiffPixelRatio:.01,threshold:.2
 });
 await selectStore(page);
 await expect(page.locator('#product-grid .product-card')).toHaveCount(3);
 await expect.poll(()=>page.locator('#product-grid .product-photo').evaluateAll(images=>images.length===3&&images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
 const first=page.locator('#product-grid .product-card').first();
 // The storefront now scrolls as a document, with categories before products.
 // Check that the real add control is reachable instead of assuming it starts
 // above the fold as it did in the retired split-pane layout.
 await addButton(first).scrollIntoViewIfNeeded();
 await expect(addButton(first)).toBeInViewport();
 for(const card of await page.locator('#product-grid .product-card').all()){
  const condition=card.locator('.product-price-unit');
  await expect(condition).toBeVisible();
  await expect(condition).toContainText('без карты');
  // Provenance is an intentional disclosure. Exercise its actual summary so
  // the date and source are available to a user, not merely present in the DOM.
  const details=card.locator('details.pixel-product-details');
  await expect(details).toHaveJSProperty('open',false);
  await details.locator(':scope > summary').click();
  await expect(details).toHaveJSProperty('open',true);
  const source=details.locator('a.product-unit');
  await expect(source).toBeVisible();
  await expect(source).toContainText('19.10');
  await expect(source).toHaveAttribute('href',products[0].source_url);
  await details.locator(':scope > summary').click();
  await expect(details).toHaveJSProperty('open',false);
  const button=await addButton(card).boundingBox();
  expect(button).not.toBeNull();
  expect(button.width).toBeGreaterThanOrEqual(44);expect(button.height).toBeGreaterThanOrEqual(44);
 }
 await expectNoOverflow(page);
 await page.locator('#pixel-storefront-title').scrollIntoViewIfNeeded();
 // Weekly-entry baselines are separate; retain the previous storefront PNGs
 // and the unchanged approved home images and mismatch tolerances.
 await expect(page).toHaveScreenshot('pixel-character-weekly-storefront-'+(mobile?'mobile':'desktop')+'.png',{
  fullPage:true,scale:'css',animations:'disabled',maxDiffPixelRatio:.01,threshold:.2
 });
});

test('store navigation preserves the optional assistant draft, actual basket quantities, compare, Back and reload',async({page})=>{
 await setup(page);
 await openHory(page);
 await page.locator('#basket-proposal-input').fill('Молоко и рис');
 await closeHory(page);
 await selectStore(page,'metro');
 await expect(page.locator('#retail-store-grid')).toHaveCount(1);
 await selectStore(page,'globus');
 await expect(page.locator('#product-grid .product-card')).toHaveCount(3);
 await addButton(page.locator('#product-grid .product-card').first()).click();
 const saved=await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'));
 await page.locator('#hori-theme').click();
 await openHory(page);
 await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко и рис');
 expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(saved);
 await openBasket(page);
 await page.locator('.basket-row').getByRole('button',{name:/Увеличить количество/}).click();
 await expect(page.locator('.basket-row .stepper-value')).toHaveText('2');
 const retained=await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'));
 await page.locator('#compare-basket').click();
 await expect(page.locator('#comparison-output')).toContainText(/недостаточно|нет|не удалось/i);
 await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
 await page.goBack();await page.reload();
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(retained);
});

test('small and keyboard-height viewports keep optional input and store/address access usable',async({page})=>{
 await setup(page);
 for(const viewport of [{width:320,height:568},{width:390,height:550}]){
  await page.setViewportSize(viewport);
  await openHory(page);
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  await expect(page.locator('#basket-proposal-submit')).toBeInViewport();
  await expectNoOverflow(page);
  await closeHory(page);
  await expect(page.locator('[data-pixel-action="hory"]')).toBeInViewport();
 }
 await openStoreDetails(page);
 await expect(page.locator('#globus-store-address')).toBeVisible();
 await page.locator('.pixel-location').click();
  await expect(page.locator('#nearby-address')).toBeVisible();
 await expectNoOverflow(page);
});
