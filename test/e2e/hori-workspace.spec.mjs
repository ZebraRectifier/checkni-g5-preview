import { test, expect } from '@playwright/test';
import { openBasket, openHory, closeHory, selectStore, expectNoOverflow } from './helpers/pixel-surface.mjs';

const send = async (page, text) => {
  await openHory(page);
  await page.locator('#basket-proposal-input').fill(text);
  await page.locator('#basket-proposal-submit').click();
};
async function setup(page) {
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/retail_catalog_items**', route => route.fulfill({ json: [] }));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await expect(page.locator('#pixel-store-home')).toBeVisible();
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
}

test('fresh visitor chooses stores first; optional Hory retains drafts and basket across theme and navigation', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#pixel-storefront')).toBeHidden();
  await expect(page.locator('#shopping-dialogue-user')).toBeHidden();
  await openHory(page);
  await expect(page.locator('.shopping-welcome')).toContainText('Привет! Я Хоря. Что покупаем?');
  await expect(page.locator('.shopping-welcome')).not.toContainText(/3 человека|7 дней|600/);
  await page.locator('#basket-proposal-input').fill('Молоко, яйца');
  const basket = await page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'));
  await closeHory(page);
  await expect(page.locator('[data-pixel-action="hory"]')).toBeFocused();
  const before = await page.locator('body').getAttribute('data-hori-theme');
  await page.locator('#hori-theme').click();
  await expect(page.locator('body')).not.toHaveAttribute('data-hori-theme', before);
  await openHory(page);
  await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко, яйца');
  await openBasket(page);
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'))).toBe(basket);
  await openHory(page);
  await expect(page.locator('#basket-proposal-input')).toHaveValue('Молоко, яйца');
  await expectNoOverflow(page);
});

test('weekly request retains supplied household and duration and asks only the next missing condition', async ({ page }) => {
  let calls = 0;
  await page.route('**/functions/v1/ai-basket-proposal', route => { calls++; return route.abort(); });
  await setup(page);
  await selectStore(page);
  await send(page, 'Нужна недорогая еда на неделю для троих');
  const output = page.locator('#basket-proposal-status');
  await expect(output).toContainText('для 3 человек, на 7 дн.');
  await expect(output).not.toContainText('Где закупаемся');
  await expect(output).not.toContainText(/На сколько человек|На сколько дней/);
  await expect(output).toContainText('Какие продукты исключить');
  await output.getByRole('button', { name: 'Ограничений нет', exact: true }).click();
  await expect(page.locator('#hori-shopping-results').getByRole('table')).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('#hori-shopping-results').getByRole('columnheader').first()).toBeInViewport();
  await expect(output).toContainText('на 7 дн. для 3 человек');
  await page.locator('#basket-proposal-input').scrollIntoViewIfNeeded();
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  await expectNoOverflow(page);
  expect(calls).toBe(0);
});

test('cold reload restores a usable stores home and the optional composer at reduced height', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.reload();
  await expect(page.locator('#pixel-store-home')).toBeVisible();
  await expect(page.locator('#pixel-storefront')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.setViewportSize({ width: 390, height: 550 });
  await openHory(page);
  await expect(page.locator('#basket-proposal-input')).toBeInViewport();
  await expect(page.locator('#basket-proposal-submit')).toBeInViewport();
  await expectNoOverflow(page);
});


test('background basket state preserves an open Hory, while explicit app navigation dismisses it',async({page,context})=>{
 let ai=0;
 await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
 await page.addInitScript(()=>document.addEventListener('checkni:shop-state',e=>{window.__checkniTestShopState=e.detail;}));
 await setup(page);await openBasket(page);await openHory(page);
 const input=page.locator('#basket-proposal-input'),dialog=page.locator('#pixel-hory-dialog');
 const repeatCurrentState=()=>page.evaluate(()=>{
  if(window.__checkniTestShopState?.view!=='basket')throw Error('Expected actual basket state');
  document.dispatchEvent(new CustomEvent('checkni:shop-state',{detail:{...window.__checkniTestShopState}}));
 });
 await input.fill('Покупки на четырнадцать дней');await repeatCurrentState();
 await expect(dialog).toBeVisible();await expect(input).toHaveValue('Покупки на четырнадцать дней');
 // This is the existing app navigation entry, not another state notification.
 await page.evaluate(()=>document.getElementById('open-basket').click());
 await expect(dialog).toBeHidden();await expect(page.locator('#basket-view')).toBeVisible();
 await openHory(page);await expect(input).toHaveValue('Покупки на четырнадцать дней');
 await page.reload();await expect(page.locator('#basket-view')).toBeVisible();await openHory(page);
 await input.fill('Что ты помнишь?');await repeatCurrentState();
 await expect(dialog).toBeVisible();await expect(input).toBeEditable();await expect(input).toHaveValue('Что ты помнишь?');
 await closeHory(page);await expectNoOverflow(page);expect(ai).toBe(0);
});

test('preferences before a store stay as intake and recipe follow-ups send the actual previous advice',async({page})=>{
 const calls=[],reply='Можно сделать пасту с томатным соусом или макароны с овощным рагу.';
 await page.route('**/functions/v1/ai-basket-proposal',route=>{calls.push(route.request().postDataJSON());return route.fulfill({json:{kind:'advice',message:calls.length===1?reply:'Для второго варианта возьми макароны и овощную смесь: отвари и перемешай.'}});});
 await setup(page);await send(page,'Нас четверо, покупки на десять дней');await send(page,'Не хочу готовить');
 await expect(page.locator('#basket-proposal-status')).toContainText('Выбери магазин');
 await expect(page.locator('#basket-proposal-status')).not.toContainText(/Историческ|₽|Колбас|Туш[её]н/);
 expect(calls).toHaveLength(0);await send(page,'Без мяса');
 const question='Как выбрать макароны для быстрых ужинов без мяса? Предложи два простых блюда.';
 await send(page,question);await expect(page.locator('#basket-proposal-status')).toContainText(reply);
 await send(page,'Оставим второй вариант. Как приготовить его попроще?');
 await expect(page.locator('#basket-proposal-status')).toContainText('Для второго варианта');
 expect(calls).toHaveLength(2);expect(calls[1].history).toEqual([{role:'user',text:question},{role:'assistant',text:reply}]);
 expect(calls[1].context).toMatchObject({peopleCount:4,shoppingDays:10,cookingEffort:'minimal',excluded:['meat']});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('#basket-proposal-status')).toBeInViewport({ratio:0.9});
 await closeHory(page);await openBasket(page);await expect(page.locator('.basket-row')).toHaveCount(0);await expectNoOverflow(page);
});


test('why keeps the accepted meat-free advice and recovers without asking known preferences',async({page})=>{
 const calls=[],reply='Можно сделать пасту с томатным соусом или макароны с овощным рагу.';
 await page.route('**/functions/v1/ai-basket-proposal',route=>{
  calls.push(route.request().postDataJSON());
  return calls.length===2?route.fulfill({status:503,json:{kind:'unavailable',code:'provider_advice_excluded_target'}})
   :route.fulfill({json:{kind:'advice',message:calls.length===1?reply:'Макароны и овощи подходят для простого ужина, их удобно приготовить небольшой порцией.'}});
 });
 await setup(page);await send(page,'Нас четверо, покупки на десять дней');await send(page,'Не хочу готовить');await send(page,'Без мяса');
 const question='Как выбрать макароны для быстрых ужинов без мяса? Предложи два простых блюда.';
 await send(page,question);await expect(page.locator('#basket-proposal-status')).toContainText(reply);
 await send(page,'Почему?');await expect(page.locator('#basket-proposal-status')).toContainText('Предыдущий совет и твои условия сохранены');
 await expect(page.locator('#basket-proposal-status')).not.toContainText(/Скажи бюджет|хочется ли готовить/u);
 expect(calls).toHaveLength(2);expect(calls[1].text).toBe('Про макароны: Почему?');
 expect(calls[1].history).toEqual([{role:'user',text:question},{role:'assistant',text:reply}]);
 expect(calls[1].context).toMatchObject({peopleCount:4,shoppingDays:10,cookingEffort:'minimal',excluded:['meat']});
 await send(page,'Почему?');await expect(page.locator('#basket-proposal-status')).toContainText('Макароны и овощи подходят');
 expect(calls).toHaveLength(3);expect(calls[2].history).toEqual(calls[1].history);
 await closeHory(page);await openBasket(page);await expect(page.locator('.basket-row')).toHaveCount(0);await expectNoOverflow(page);
});

test('long advice opens at its beginning instead of skipping to the bottom', async ({ page }) => {
 const reply = 'Начало совета: сначала выбери простые блюда.\n' + Array.from({length:12},(_,i)=>`${i+1}. Овощи и крупы можно приготовить заранее небольшими порциями.`).join('\n');
 await page.route('**/functions/v1/ai-basket-proposal',route=>route.fulfill({json:{kind:'advice',message:reply}}));
 await setup(page);await send(page,'Как выбрать макароны для быстрых ужинов без мяса? Предложи два простых блюда.');
 const output=page.locator('#basket-proposal-status');await expect(output).toContainText('Начало совета');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const position=await output.evaluate(node=>{const r=node.getBoundingClientRect(),d=node.closest('dialog').getBoundingClientRect(),h=node.closest('dialog').querySelector('.pixel-hory-header').getBoundingClientRect();return {top:r.top,bottom:r.bottom,dialogBottom:d.bottom,headerBottom:h.bottom};});
 expect(position.top).toBeGreaterThanOrEqual(position.headerBottom-2);
 expect(position.top).toBeLessThan(position.dialogBottom-80);
 await expectNoOverflow(page);
});
