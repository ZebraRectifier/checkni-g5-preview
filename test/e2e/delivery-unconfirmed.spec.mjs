import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test('unverified delivery is not offered as local comparison',async({page})=>{
 const html=(await readFile('index.html','utf8')).replaceAll(/\.\/releases\/[a-f0-9]{64}\//g,'./');
 await page.route('**/?comparison=observed&catalog=retail',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
 await page.addInitScript(()=>localStorage.setItem('checkni.surface.basket.v1',JSON.stringify([{id:'retail:magnit:magnit-503695:1000526136',name:'Макароны Gusto Di Roma Fusilli Спирали 400г',unit:'400 г',quantity:1}])));
 await page.goto('/?comparison=observed&catalog=retail#basket');
 await page.getByRole('button',{name:/Открыть список покупок/}).click();
 await expect(page.locator('#compare-basket')).toBeDisabled();
 await expect(page.locator('#basket-content')).toContainText('Доставка Перекрёстка по выбранному адресу пока не подтверждена');
 await page.reload();
 await expect(page.locator('#basket-content')).toContainText('Макароны Gusto Di Roma Fusilli');
 await expect(page.locator('#compare-basket')).toBeDisabled();
});

for (const version of [2, 3]) {
 test(`retained v${version} basket stays editable without starting an unverified delivery comparison`,async({page})=>{
  const html=(await readFile('index.html','utf8')).replaceAll(/\.\/releases\/[a-f0-9]{64}\//g,'./');
  await page.route('**/?comparison=observed&catalog=retail',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
  const productId='retail:magnit:magnit-503695:1000526136';
  const request={version,scopes:[{retailerId:'magnit',storeId:'magnit-503695'},
   ...(version===2?[{retailerId:'perekrestok',storeId:'perekrestok-yandex-3186917'}]:[])],
   bindings:[{productId,sourceProductId:'1000526136',groupKey:'pasta',retailerId:'magnit',allowPoultryCuts:false}],unresolvedGroupKeys:[]};
  await page.addInitScript(({productId,request})=>{
   if (!localStorage.getItem('checkni.surface.basket.v1')) localStorage.setItem('checkni.surface.basket.v1',JSON.stringify([{id:productId,name:'Макароны Gusto Di Roma Fusilli Спирали 400г',unit:'400 г',quantity:1}]));
   if (!localStorage.getItem('checkni.guided-comparison-request.v1')) localStorage.setItem('checkni.guided-comparison-request.v1',JSON.stringify(request));
  },{productId,request});
  await page.goto('/?comparison=observed&catalog=retail#basket');
  await page.getByRole('button',{name:/Открыть список покупок/}).click();
  await expect(page.locator('#compare-basket')).toBeDisabled();
  await expect(page.locator('#basket-content')).toContainText('Доставка Перекрёстка по выбранному адресу пока не подтверждена');
  await expect(page.locator('.saved-catalog-variant')).toHaveCount(0);
  await page.locator('.basket-row').getByRole('button',{name:/Увеличить количество/}).click();
  await expect(page.locator('.basket-row output')).toHaveText('2');
  await page.reload();
  await expect(page.locator('.basket-row output')).toHaveText('2');
  await expect(page.locator('#compare-basket')).toBeDisabled();
  await expect(page.locator('.saved-catalog-variant')).toHaveCount(0);
 });
}

