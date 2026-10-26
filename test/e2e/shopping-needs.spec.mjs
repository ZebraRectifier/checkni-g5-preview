import { test, expect } from '@playwright/test';
import { openHory, openBasket } from './helpers/pixel-surface.mjs';
const key='checkni.shopping-needs.v1';
async function submit(page,text){await openHory(page);await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-input').press('Enter');}
const needs=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'{"lines":[]}').lines,key);
async function start(page){
  await page.route('**/functions/v1/ai-basket-proposal',route=>route.abort());
  await page.route('**/rest/v1/retail_catalog_**',route=>route.fulfill({json:[]}));
  await page.goto('/?comparison=observed&catalog=retail#shop');
}
test('arbitrary needs survive reload, correction and acknowledgement without invented products',async({page})=>{
  await start(page);await submit(page,'хочу 12 бутылок кефира');
  await expect(page.locator('#basket-proposal-status')).toContainText('Записано в список');
  await expect(page.locator('#basket-proposal-input')).toHaveValue('');
  expect((await needs(page))[0].resolution.productId).toBe(null);
  await submit(page,'да');expect((await needs(page))[0].quantity.value).toBe('12');
  await expect(page.locator('#shopping-dialogue-history')).toContainText('Записано в список');
  await expect(page.locator('#shopping-dialogue-history')).not.toContainText('Запрос отменён');
  await submit(page,'не 12, а 6');await expect.poll(async()=>(await needs(page))[0].quantity.value).toBe('6');
  await page.reload();await submit(page,'ещё две');await expect.poll(async()=>(await needs(page))[0].quantity.value).toBe('8');
  await submit(page,'2 пачки тофу, 1,5 кг картофеля');await expect.poll(async()=>(await needs(page)).map(x=>x.requestedName)).toEqual(['кефира','тофу','картофеля']);
  await openBasket(page);await expect(page.locator('#shopping-needs')).toContainText('тофу — 2 уп.');
  await expect(page.locator('#shopping-needs-coverage')).toContainText('3 из 3');
  await expect(page.locator('[data-pixel-action="basket"]')).toContainText('3 поз.');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')??'[]'))).toEqual([]);
});
test('a second tab retains both purchases and cannot silently repeat a request',async({page,context})=>{
  await start(page);const other=await context.newPage();await start(other);
  await submit(page,'тофу 2');await submit(other,'рис 3');
  await page.reload();expect((await needs(page)).map(x=>x.requestedName)).toEqual(['тофу','рис']);
  await submit(page,'рис 3');await expect(page.locator('#basket-proposal-status')).toContainText('уже есть');
  expect((await needs(page))[1].quantity.value).toBe('3');await other.close();
});

test('advice, questions and mixed input cannot lose a new purchase or invent an extra product',async({page})=>{
  await start(page);await submit(page,'как выбрать кефир?');
  await expect(page.locator('#basket-proposal-status')).not.toContainText('Разбираю запрос');
  await submit(page,'2 коробки конфет');await expect.poll(async()=>(await needs(page)).length).toBe(1);
  await submit(page,'спасибо');await submit(page,'да');
  await expect(page.locator('#basket-proposal-status')).toContainText('Список уже сохранён');
  await submit(page,'проверь, есть ли тофу');
  await expect(page.locator('#basket-proposal-input')).toBeEnabled();
  await submit(page,'закажи всё');await expect(page.locator('#basket-proposal-status')).toContainText('Покупка не оформлена');
  expect((await needs(page)).length).toBe(1);
  await submit(page,'конфет 2 коробки, 2л воды');
  await expect.poll(async()=>(await needs(page)).length).toBe(2);
  expect((await needs(page)).map(x=>[x.requestedName,x.quantity.value,x.quantity.unit])).toEqual([['конфет','2','box'],['воды','2','l']]);
  await page.reload();await openBasket(page);
  await expect(page.locator('#shopping-needs')).toContainText('конфет — 2 кор.');
  await expect(page.locator('#shopping-needs')).toContainText('воды — 2 л');
});

test('a weighed need can be explicitly matched to a saved real card and a later basket edit reopens coverage',async({page})=>{
  await start(page);await submit(page,'500 г яблок');
  await expect.poll(async()=>(await needs(page)).length).toBe(1);
  // A previously selected source card is the initial fixture; the association
  // and later quantity change are performed through the actual basket UI.
  await page.evaluate(()=>localStorage.setItem('checkni.surface.basket.v1',JSON.stringify([{id:'retail:magnit:magnit-777312:apple-fixture',name:'Яблоки проверенные',unit:'1 кг',quantity:1}])));
  await page.reload();await openBasket(page);
  await expect(page.locator('#shopping-needs-coverage')).toContainText('1 из 1');
  await expect(page.locator('#compare-basket')).toBeDisabled();
  await page.getByLabel('Товар для потребности яблок',{exact:true}).selectOption('retail:magnit:magnit-777312:apple-fixture');
  await expect(page.locator('.shopping-need-review')).toContainText('больше потребности на 500 г');
  await page.getByRole('button',{name:'Подтвердить соответствие',exact:true}).click();
  await expect(page.locator('#shopping-needs-coverage')).toHaveCount(0);
  await expect(page.locator('#compare-basket')).toBeEnabled();
  await page.reload();await openBasket(page);await expect(page.locator('#shopping-needs')).toContainText('товар выбран');
  await page.getByRole('button',{name:'Увеличить количество Яблоки проверенные',exact:true}).click();
  await expect(page.locator('#shopping-needs-coverage')).toContainText('1 из 1');
  await expect(page.locator('#compare-basket')).toBeDisabled();
  expect((await needs(page))[0].quantity.value).toBe('500');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
