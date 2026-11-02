import {test,expect} from '@playwright/test';
import {openHory} from './helpers/pixel-surface.mjs';

test('advice follow-up remembers exclusions without inventing new shopping needs',async({page,context})=>{
  const posts=[];
  await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.route('**/functions/v1/ai-basket-proposal',route=>{
    const input=route.request().postDataJSON();posts.push(input);
    return route.fulfill({json:{kind:'advice',message:posts.length===1
      ?'Для дороги можно рассмотреть яблоки и хлеб. Проверь состав и упаковку.'
      :'Учла исключения. Для дороги можно рассмотреть яблоки, проверив состав и упаковку.'}});
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await openHory(page);
  const send=async text=>{await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
  await send('тофу, рис');
  const needs=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.shopping-needs.v1'))?.lines??[]);
  await expect.poll(async()=>(await needs()).length).toBe(2);
  const before=await needs();expect(before.map(row=>row.requestedName)).toEqual(['тофу','рис']);
  await send('ПП');
  await expect(page.locator('#basket-proposal-status')).toContainText('Для дороги можно рассмотреть');
  expect(posts.length).toBe(1);
  const prior=await page.locator('#basket-proposal-status').innerText();
  await send('Не добавляй молоко, сыр и кефир. Готовить не хочу. Что из предложенного взять в дорогу?');
  await expect.poll(async()=>{const text=await page.locator('#basket-proposal-status').innerText();
    return text!==prior&&!/Сейчас подумаю|Подбираю товары|Обрабатываю/u.test(text)?text:null;}).not.toBeNull();
  await expect.poll(needs).toEqual(before);
  await expect(page.locator('#basket-proposal-status')).not.toContainText('Список сохранён');
  await expect(page.locator('#basket-proposal-status')).not.toContainText('Подобрать: Не добавляй');
  expect(posts.length).toBe(2);
  expect(posts[1].context.excluded.toSorted()).toEqual(['cheese','kefir','milk']);
  expect(posts[1].context.cookingEffort).toBe('minimal');
  expect(posts[1].history).toEqual([{role:'user',text:'ПП'},
    {role:'assistant',text:'Для дороги можно рассмотреть яблоки и хлеб. Проверь состав и упаковку.'}]);
  expect(posts.every(request=>request.mode==='advice')).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();await openHory(page);
  expect(await needs()).toEqual(before);
});
