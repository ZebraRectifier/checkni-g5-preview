import { test, expect } from '@playwright/test';
const send=async(page,text)=>{await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
async function setup(page){
  await page.route('**/rest/v1/retail_catalog_categories**',route=>route.fulfill({json:[]}));
  await page.route('**/rest/v1/retail_catalog_items**',route=>route.fulfill({json:[]}));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await expect(page.locator('.hori-greeting')).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('display','grid');
}
async function equalPanes(page){
  const layout=await page.locator('body').evaluate(el=>({rows:getComputedStyle(el).gridTemplateRows,items:[...el.children].map(e=>({id:e.id,cls:e.className,display:getComputedStyle(e).display,position:getComputedStyle(e).position,margin:getComputedStyle(e).margin,height:e.getBoundingClientRect().height}))}));
  await expect.poll(async()=>{const ai=await page.locator('#basket-proposal-section').boundingBox();const shop=await page.locator('#main').boundingBox();return Math.abs(ai.height-shop.height);},{message:JSON.stringify(layout)}).toBeLessThanOrEqual(2);
  const ai=await page.locator('#basket-proposal-section').boundingBox();
  const shop=await page.locator('#main').boundingBox();
  expect(Math.abs(ai.height-shop.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(ai.y+ai.height-shop.y)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const input=await page.locator('#basket-proposal-input').boundingBox();
  expect(input.y+input.height).toBeLessThanOrEqual(ai.y+ai.height);
}
test('fresh visitor gets only a greeting; theme and basket navigation retain the upper-half assistant',async({page})=>{
  await setup(page);
  await expect(page.locator('#shopping-dialogue-user')).toBeHidden();
  await expect(page.locator('.shopping-welcome')).toContainText('Привет! Я Хори. Что покупаем?');
  await expect(page.locator('.shopping-welcome')).not.toContainText(/3 человека|7 дней|600/);
  await equalPanes(page);
  await page.locator('#basket-proposal-input').fill('Молоко, яйца');
  const basket=await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'));
  const before=await page.locator('body').getAttribute('data-hori-theme');
  await page.locator('#hori-theme').click();
  await expect(page.locator('body')).not.toHaveAttribute('data-hori-theme',before);
  await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко, яйца');
  await page.locator('#open-basket').click();
  await expect(page.locator('#basket-view')).toBeVisible();
  await expect(page.locator('#basket-proposal-input')).toBeVisible();
  await equalPanes(page);
  expect(await page.evaluate(()=>localStorage.getItem('checkni.surface.basket.v1'))).toBe(basket);
});
test('weekly request keeps supplied household and duration and asks only the next missing condition',async({page})=>{
  let calls=0;
  await page.route('**/functions/v1/ai-basket-proposal',route=>{calls++;return route.abort();});
  await setup(page);
  await send(page,'Нужна недорогая еда на неделю для троих');
  const output=page.locator('#basket-proposal-status');
  await expect(output).toContainText('Где закупаемся');
  await expect(output).not.toContainText(/На сколько человек|На сколько дней/);
  await output.getByRole('button',{name:'Текущий магазин',exact:true}).click();
  await expect(output).toContainText('Какие продукты исключить');
  await output.getByRole('button',{name:'Ограничений нет',exact:true}).click();
  await expect(page.locator('#hori-shopping-results').getByRole('table')).toBeVisible();
  await expect(output).toContainText('на 7 дн. для 3 человек');
  await equalPanes(page);
  expect(calls).toBe(0);
});
