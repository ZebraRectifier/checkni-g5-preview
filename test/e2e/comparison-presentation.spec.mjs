import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {openBasket,expectNoOverflow} from './helpers/pixel-surface.mjs';
test('comparison presentation separates complete and partial quotes without inventing freshness',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await expect(page.locator('html')).toHaveAttribute('data-checkni-boot','ready');
 await page.evaluate(async()=>{
 const appUrl=document.querySelector('script[type="module"][src$="/app.mjs"]').src;
 const {renderSavedGuidedComparison}=await import(new URL('components/SavedGuidedComparison.mjs',appUrl).href);
 const at='2026-11-07T10:00:00Z';
 const row=(key,name,price,date)=>({group:{key,label:name,dimension:'ml',dailyAmount:100},quantity:1,product:{id:key,name,unit:'1 л'},card:price?{name,unit:'1 л',priceMinor:price,currency:'RUB',observedAt:date,sourceUrl:'https://example.com',priceConditionLabel:'Без карты'}:null});
 const result={kind:'catalog_comparison',drafts:[{scope:{retailerId:'magnit',storeId:'m',storeAddress:'Тестовый адрес'},rows:[row('milk','Молоко',8999,'2026-11-06T10:00:00Z'),row('oil','Масло',9999,'2026-11-06T10:00:00Z')]},{scope:{retailerId:'perekrestok',storeId:'p'},rows:[row('milk','Молоко',7999,at),row('oil','Масло',null,null)]}]};
 document.querySelector('#shop-view').hidden=true;const basket=document.querySelector('#basket-view');basket.hidden=false;
 const output=document.createElement('div');output.id='comparison-output';basket.replaceChildren(output);renderSavedGuidedComparison(output,result,{nowMs:Date.parse(at)});output.scrollIntoView();
 });
 const groups=page.locator('.saved-comparison-group');await expect(groups).toHaveCount(2);
 await expect(groups.first()).toContainText('Полные по составу');await expect(groups.first().locator('summary')).toContainText('Старые / неизвестные цены');
 await expect(groups.last().locator('summary')).toContainText('1/2');await expect(groups.last().locator('summary')).toContainText('Найденная часть');
 await expect(page.locator('#comparison-output')).not.toContainText('ниже на');
 await groups.last().locator('summary').click();await expect(groups.last().locator('tbody')).toContainText('Не удалось подтвердить товар');
 await groups.last().locator('summary').click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('comparison-polish.png')});
});

test('compact basket keeps price conditions, editable addresses and keyboard controls on narrow screens',async({page},info)=>{
 test.setTimeout(90000);
 const mobile=info.project.name.includes('mobile');
 const milk=await readFile(new URL('../fixtures/hori-v13/milk.jpg',import.meta.url));
 const rice=await readFile(new URL('../fixtures/hori-v13/rice.jpg',import.meta.url));
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('https://image.globus.ru/basket-fixture-*.jpg',route=>route.fulfill({contentType:'image/jpeg',body:route.request().url().includes('milk')?milk:rice}));
 await page.route('**/rest/v1/**',route=>route.fulfill({json:[]}));
 await page.route('**/src/ports/observedOffersPort.mjs',route=>route.fulfill({contentType:'text/javascript',body:'export const observedOffersPort={async load(){return []}};'}));
 await page.addInitScript(()=>{
  const key='checkni.surface.basket.v1';
  if(localStorage.getItem(key))return;
  const items=[{id:'fixture-milk',name:'Молоко 2,5%',unit:'1 л',quantity:1},{id:'fixture-rice',name:'Рис длиннозёрный пропаренный в варочных пакетиках',unit:'900 г',quantity:1}];
  localStorage.setItem(key,JSON.stringify(items));
  localStorage.setItem('checkni.basket.presentation.v1',JSON.stringify(items.map((item,index)=>({...item,retailerId:'globus',storeId:'globus-store-5011',storeName:'Глобус',imageUrl:`https://image.globus.ru/basket-fixture-${index?'rice':'milk'}.jpg`,sourceUrl:'https://www.globus.ru/catalog/fixture/',catalogUnit:item.unit,priceMinor:index?10999:8999,observedAt:'2026-11-01T08:00:00Z',condition:index?'Без карты':'По карте магазина',savedAt:'2026-11-07T08:00:00Z'}))));
 });
 await page.goto('/?comparison=observed&catalog=retail#basket');
 await openBasket(page);
 const basket=page.locator('#basket-view'),first=page.locator('.basket-row').first();
 await expect(first.locator('.basket-price-condition')).toHaveText('По карте магазина');
 await expect(first.locator('.basket-price-condition')).toBeVisible();
 await expect(first.locator('.basket-price-status')).toContainText('требует проверки');
 await expect(first.locator('.basket-price-details')).not.toHaveAttribute('open');
 await expect(basket).not.toContainText(/OBSERVED|MOCK|Core|Выбранные адреса/u);
 await expect(page.locator('.basket-addresses')).toContainText('Проверь адреса');
 await expect(page.locator('.basket-address-card')).toHaveCount(3);
 const plus=first.getByRole('button',{name:/Увеличить количество/u});
 await plus.focus();await page.keyboard.press('Enter');
 await expect(first.locator('output')).toHaveText('2');
 await expect(first.getByRole('button',{name:/Увеличить количество/u})).toBeFocused();
 const before=await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'));
 await page.locator('#compare-basket').click();
 await expect(page.locator('#comparison-output')).toContainText(/Недостаточно|не удалось|Не удалось/u);
 await expect(page.locator('#comparison-output')).not.toContainText(/Экономия|Самый дешёвый|MOCK|Core|OBSERVED/u);
 expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(before);
 await page.reload();await openBasket(page);
 await expect(first.locator('output')).toHaveText('2');
 for(const width of mobile?[390,320]:[1280]){
  await page.setViewportSize({width,height:mobile?844:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  await expectNoOverflow(page);
  for(const theme of ['light','dark']){
   await page.evaluate(value=>document.body.dataset.horiTheme=value,theme);
   const edit=page.getByRole('button',{name:/Изменить адрес Магнит/u});
   await edit.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
   await expect(edit).toBeFocused();
   const metrics=await edit.evaluate(node=>{const style=getComputedStyle(node),box=node.getBoundingClientRect();return{outline:parseFloat(style.outlineWidth),focus:node.matches(':focus-visible'),height:box.height,left:box.left,right:box.right,viewport:innerWidth,animation:style.animationName};});
   expect(metrics.focus).toBe(true);expect(metrics.outline).toBeGreaterThanOrEqual(2);
   expect(metrics.height).toBeGreaterThanOrEqual(44);expect(metrics.left).toBeGreaterThanOrEqual(0);expect(metrics.right).toBeLessThanOrEqual(metrics.viewport);expect(metrics.animation).toBe('none');
   const controls=await first.locator('.basket-item-actions').evaluate(node=>{
    const stepper=node.querySelector('.stepper').getBoundingClientRect(),remove=node.querySelector('.remove-button').getBoundingClientRect();
    return {sameRow:Math.abs(stepper.top-remove.top)<4,height:stepper.height,left:stepper.left,right:remove.right,viewport:innerWidth};
   });
   expect(controls.sameRow).toBe(true);expect(controls.height).toBeGreaterThanOrEqual(44);expect(controls.left).toBeGreaterThanOrEqual(0);expect(controls.right).toBeLessThanOrEqual(controls.viewport);
   await expect(first.locator('.basket-price-condition')).toBeVisible();
   await page.locator('#basket-title').scrollIntoViewIfNeeded();
   await page.screenshot({path:info.outputPath(`basket-${width}-${theme}.png`),fullPage:true});
  }
 }
 await first.locator('.basket-price-details > summary').click();
 await expect(first.getByRole('link',{name:'Источник цены',exact:true})).toHaveAttribute('href','https://www.globus.ru/catalog/fixture/');
 await expect(first.locator('.basket-price-details')).toContainText('Текущая цена и наличие не подтверждены');
 for(const [retailer,name] of [['magnit','Магнит'],['metro','METRO'],['globus','Глобус']]){
  await openBasket(page);
  const selector=page.locator(`#${retailer}-store-address`),previous=await selector.inputValue();
  await page.getByRole('button',{name:new RegExp('Изменить адрес '+name,'u')}).click();
  await expect(page.locator('#pixel-address-chooser')).toBeVisible();
  await expect(selector).toHaveValue('');
  await expect(page.locator(`#${retailer}-store-picker input[type=search]`)).toBeFocused();
  expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(before);
  await page.getByRole('button',{name:'К сетям',exact:true}).click();
  await expect(page.locator('#pixel-address-chooser')).toBeHidden();
  await expect(selector).toHaveValue(previous);
 }
 await openBasket(page);
 expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(before);
 await page.evaluate(async()=>{
  const {renderBasketView}=await import('/src/components/BasketView.mjs');
  const fixture=document.createElement('section');fixture.id='demo-label-fixture';document.querySelector('#basket-view').append(fixture);
  renderBasketView(fixture,[{id:'demo-fixture',name:'Тестовый товар',unit:'1 шт',quantity:1}],{comparisonMode:'demo'});
 });
 await expect(page.locator('#demo-label-fixture .basket-summary')).toContainText('Тестовые цены');
 await expect(page.locator('#demo-label-fixture #compare-help')).toContainText('Все цены и наличие здесь тестовые');
 expect(errors).toEqual([]);
});
