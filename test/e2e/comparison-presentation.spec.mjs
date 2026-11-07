import {test,expect} from '@playwright/test';
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
