import { test, expect } from '@playwright/test';
import { openHory } from './helpers/pixel-surface.mjs';

const submit = async (page, text) => {
  await page.locator('#basket-proposal-input').fill(text);
  await page.locator('#basket-proposal-submit').click();
};
const status = page => page.locator('#basket-proposal-status');
const savedBasket = page => page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'));

test('bare why continues the accepted shopping advice without losing context', async ({page}, testInfo) => {
  const requests = [];
  await page.route('**/functions/v1/ai-basket-proposal', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({json:{kind:'advice',message:requests.length === 1
      ? 'Для быстрого ужина подойдёт филе рыбы. Его можно запечь с овощами.'
      : 'Я предложила филе, потому что его удобно порционировать и готовить вместе с овощами.'}});
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await openHory(page);
  const before = await savedBasket(page);
  const first = 'Посоветуй рыбу на ужин, чтобы быстро приготовить.';
  await submit(page, first);
  await expect(status(page)).toContainText('подойдёт филе рыбы');
  await expect(status(page).locator('.proposal-message')).toHaveCount(0);
  await expect(status(page).getByRole('button', {name:'Продолжить', exact:true})).toHaveCount(0);
  await expect(page.locator('#basket-proposal-fallback')).toBeHidden();
  await expect(page.locator('#basket-proposal-help')).toBeHidden();
  await expect(page.locator('#basket-proposal-input')).toBeEditable();
  await submit(page, 'почему');
  await expect(status(page)).toContainText('потому что его удобно порционировать');
  await expect(page.locator('#shopping-dialogue-history')).toContainText('Для быстрого ужина подойдёт филе рыбы.');
  await expect(page.locator('#shopping-dialogue-history')).not.toContainText('Давай разберёмся.');
  await expect(page.locator('#shopping-dialogue-history .shopping-dialogue-speaker')).toHaveText('Хоря · ранее');
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.mode === 'advice')).toBe(true);
  expect(requests[1].history).toHaveLength(2);
  expect(requests[1].history[0].text).toBe(first);
  expect(requests[1].history[1].text).toContain('филе рыбы');
  expect(await savedBasket(page)).toBe(before);
  await expect(status(page)).not.toContainText('Не получилось разобрать');
  await page.screenshot({path:testInfo.outputPath('advice-followup.png')});
  await page.locator('#shopping-dialogue-clear').click();
  await expect(page.locator('#basket-proposal-help')).toBeVisible();
});

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
});

async function shoppingGoal(page) {
  const requests = [];
  await page.route('**/functions/v1/ai-basket-proposal', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { kind: 'advice', message: requests.length === 1
      ? 'На сколько человек нужна еда? Есть ли морозилка для запаса?'
      : requests.length === 2 ? 'Учту троих и запас для заморозки. Какой общий бюджет на весь срок?'
        : 'Можно чередовать котлеты, тефтели и мясной соус, а фрукты покупать в два захода.' } });
  });
  await page.goto('/?comparison=demo#shop');
  await page.locator('[data-product-id="milk-25-900"]').getByRole('button').click();
  const before = await savedBasket(page);
  const goal = 'Слушай, я живу в Пушкино. Нужна еда на две недельки, побольше фарша и фруктов. Посмотри по магазинам и дай рекомендации.';
  await submit(page, goal);
  await expect(status(page)).toContainText('На сколько человек');
  await submit(page, 'на 3 да есть морозилка');
  await expect(status(page)).toContainText('Какой общий бюджет');
  await submit(page, '15000');
  await expect(status(page)).toContainText('Можно чередовать котлеты');
  expect(requests).toHaveLength(3);
  expect(requests.every(row => row.mode === 'advice')).toBe(true);
  expect(requests[1].context.peopleCount).toBe(3);
  expect(requests[1].context.shoppingDays).toBe(14);
  expect(requests[1].history[0].text).toBe(goal);
  expect(requests[2].context.budgetMinor).toBe(1500000);
  expect(requests[2].history).toHaveLength(4);
  expect(requests[2].text).toContain('морозилка: есть');
  expect(requests[2].text).toContain('пушкино');
  await expect(status(page).getByRole('button', { name: /Добавить|Применить/u })).toHaveCount(0);
  expect(await savedBasket(page)).toBe(before);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/Пушкино|пушкино|морозилка|На сколько человек/u);
  await submit(page, 'два молока');
  await expect(status(page)).toContainText('Молоко');
  await expect(status(page).getByRole('button', { name: 'Применить изменения' })).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(await savedBasket(page)).toBe(before);
}

async function quotaRecovery(page) {
  const requests = [];
  await page.route('**/functions/v1/ai-basket-proposal', route => {
    requests.push(route.request().postDataJSON());
    return requests.length === 1 ? route.fulfill({ status: 429, json: { kind: 'unavailable' } })
      : route.fulfill({ json: { kind: 'advice', message: 'На сколько дней подбираем продукты для троих?' } });
  });
  await page.goto('/?comparison=demo#shop');
  await submit(page, 'Пп');
  await expect(status(page)).toContainText('Лимит обращений');
  await expect(status(page)).toContainText('На сколько человек');
  expect(requests).toHaveLength(1);
  expect(requests[0].mode).toBe('advice');
  await expect(status(page)).not.toContainText('Не получилось разобрать');
  await submit(page, 'на 3');
  await expect(status(page)).toContainText('На сколько дней');
  expect(requests).toHaveLength(2);
  expect(requests[1].context.peopleCount).toBe(3);
  expect(requests[1].history).toHaveLength(2);
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
}

async function deadlineRecovery(page) {
  await page.clock.install();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/functions/v1/ai-basket-proposal', async route => {
    calls++;
    await gate;
    await route.abort().catch(() => {});
  });
  await page.goto('/?comparison=demo#shop');
  await submit(page, 'Нужна еда на две недели для троих');
  await expect.poll(() => calls).toBe(1);
  await expect(page.locator('#basket-proposal-submit')).toHaveText('Обновить запрос');
  await page.clock.fastForward(20_100);
  await expect(status(page)).toContainText('Какой общий бюджет');
  await expect(status(page)).not.toContainText('Сейчас подумаю');
  await expect(status(page)).not.toContainText('Не получилось разобрать');
  expect(calls).toBe(1);
  release();
}

// Keep every assertion, with one browser context per viewport. The dedicated
// runner is memory constrained; shared context setup avoids needless launches.
test('dialogue goal, quota recovery and finite deadline preserve the complete conversation contract', async ({ page }) => {
  await test.step('two-week goal and exact literal shopping exit', () => shoppingGoal(page));
  await page.unroute('**/functions/v1/ai-basket-proposal');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await test.step('quota response and scoped count', () => quotaRecovery(page));
  await page.unroute('**/functions/v1/ai-basket-proposal');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await test.step('finite deadline and no retry', () => deadlineRecovery(page));
});

test('fish follow-up failure and explicit retry retain the topic, accepted history and basket', async ({ page }) => {
  const requests = [];
  await page.route('**/functions/v1/ai-basket-proposal', route => {
    requests.push(route.request().postDataJSON());
    return requests.length === 2
      ? route.fulfill({ status:503, json:{kind:'unavailable',code:'provider_advice_assortment_claim'} })
      : route.fulfill({ json:{kind:'advice',message: requests.length === 1
        ? 'Для быстрого ужина подойдёт филе рыбы. Его можно приготовить на сковороде.'
        : 'Замороженная рыба подойдёт. Проверь целостность упаковки и инструкцию по размораживанию.'} });
  });
  await page.goto('/?comparison=demo#shop');
  await page.locator('[data-product-id="milk-25-900"]').getByRole('button').click();
  const before = await savedBasket(page);
  await submit(page,'Посоветуй рыбу на ужин, чтобы быстро приготовить.');
  await expect(status(page)).toContainText('подойдёт филе рыбы');
  await submit(page,'А замороженная подойдёт?');
  await expect(status(page)).toContainText('Ответ сервиса не прошёл проверку');
  await expect(status(page)).toContainText('Вопрос и контекст сохранены');
  await expect(status(page)).not.toContainText('На сколько человек');
  expect(requests).toHaveLength(2);
  await status(page).getByRole('button',{name:'Повторить вопрос',exact:true}).click();
  await expect(status(page)).toContainText('Замороженная рыба подойдёт');
  expect(requests).toHaveLength(3);
  expect(requests[2].text).toBe(requests[1].text);
  expect(requests[2].history).toEqual(requests[1].history);
  expect(requests[2].history[0].text).toContain('рыбу на ужин');
  expect(await savedBasket(page)).toBe(before);
  await expect(page.locator('.shopping-welcome')).toBeHidden();
});

test('questioning a previous recommendation stays conversational and does not block a new product topic', async ({ page }) => {
  const requests=[];
  const replies=['Для супа можно выбрать треску, судака или хек.','Те же варианты можно обсудить и для духовки.',
    'Треска по-прежнему подходит; уточнение способа приготовления не меняет прежний выбор.',
    'Для завтрака подбирай творог по вкусу, составу на этикетке и способу подачи.'];
  await page.route('**/functions/v1/ai-basket-proposal',route=>{
    requests.push(route.request().postDataJSON());return route.fulfill({json:{kind:'advice',message:replies[requests.length-1]}});
  });
  await page.goto('/?comparison=demo#shop');
  await page.locator('[data-product-id="milk-25-900"]').getByRole('button').click();
  const before=await savedBasket(page);
  const turns=['Посоветуй рыбу для супа.','Она подойдёт для духовки? Нас двое.',
    'Ты же сам предложил треску — теперь она не подходит?','Теперь посоветуй творог к завтраку.'];
  for(let i=0;i<turns.length;i++){
    await submit(page,turns[i]);await expect(status(page)).toContainText(replies[i]);
    await expect(status(page)).not.toContainText('Уточни пищевое ограничение');
  }
  expect(requests).toHaveLength(4);expect(requests[2].context.peopleCount).toBe(2);
  expect(requests[2].history[0].text).toBe(turns[0]);expect(requests[3].history).toHaveLength(6);
  expect(await savedBasket(page)).toBe(before);
  await page.reload();expect(await savedBasket(page)).toBe(before);
});

test('short suitability and same-product questions retain both previous answers',async({page})=>{
  const requests=[],replies=['Для пирога выбирай яблоки по рецепту; цвет сам по себе не определяет вкус.',
    'Зелёные могут подойти: важны сорт, вкус и текстура, а не только цвет.',
    'Те же яблоки можно обсудить и для свежей подачи; цвет не меняет прежний совет.'];
  await page.route('**/functions/v1/ai-basket-proposal',route=>{
    requests.push(route.request().postDataJSON());return route.fulfill({json:{kind:'advice',message:replies[requests.length-1]}});
  });
  await page.goto('/?comparison=demo#shop');
  await page.locator('[data-product-id="milk-25-900"]').getByRole('button').click();
  const before=await savedBasket(page);
  const turns=['Как выбрать яблоки для пирога?','А зелёные подойдут?','А те же яблоки можно есть свежими?'];
  for(let i=0;i<turns.length;i++){await submit(page,turns[i]);await expect(status(page)).toContainText(replies[i]);}
  expect(requests).toHaveLength(3);expect(requests.map(r=>r.history?.length??0)).toEqual([0,2,4]);
  expect(requests[2].history[1].text).toBe(replies[0]);expect(requests[2].history[3].text).toBe(replies[1]);
  expect(await savedBasket(page)).toBe(before);
});


test('retail needs delegate whole conversations to the existing advice route without fake shopping lines', async ({ page }) => {
  const requests = [];
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await page.route('**/functions/v1/ai-basket-proposal', route => {
    requests.push(route.request().postDataJSON());
    return requests.length === 3
      ? route.fulfill({ status: 503, json: { kind: 'unavailable', code: 'provider_timeout' } })
      : route.fulfill({ json: { kind: 'advice', message: 'Какие продукты хочется купить?' } });
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await openHory(page);
  const before = await savedBasket(page);
  const needsBefore = await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'));
  for (const [index, text] of ['Пп', 'Хочу разобраться, что мне вообще покупать'].entries()) {
    await submit(page, text);
    await expect(status(page)).toContainText('Какие продукты хочется купить?');
    await expect.poll(() => requests.length).toBe(index + 1);
    expect(requests[index].mode).toBe('advice');
    expect(await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needsBefore);
    expect(await savedBasket(page)).toBe(before);
  }
  await submit(page, 'Пп.');
  await expect(status(page)).toContainText('Не успел получить ответ сервиса');
  await expect(status(page).getByRole('button', { name: 'Повторить вопрос', exact: true })).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(requests.map(request => request.history?.length ?? 0)).toEqual([0, 2, 4]);
  await status(page).getByRole('button', { name: 'Повторить вопрос', exact: true }).click();
  await expect(status(page)).toContainText('Какие продукты хочется купить?');
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3].text).toBe(requests[2].text);
  expect(requests[3].history).toEqual(requests[2].history);
  expect(requests.every(request => request.mode === 'advice')).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needsBefore);
  expect(await savedBasket(page)).toBe(before);
});

test('retail unresolved food refusals clarify locally and preserve the saved need without any AI or address request', async ({ page }) => {
  let ai = 0, addresses = 0;
  await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
  await page.route('**/functions/v1/ai-basket-proposal', route => { ai++; return route.abort(); });
  await page.route('**/functions/v1/nearby-address', route => { addresses++; return route.abort(); });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await openHory(page);
  await submit(page, '2 бутылки кефира');
  await expect(status(page)).toContainText('2');
  await expect(status(page)).toContainText('кефира');
  const before = await savedBasket(page);
  const needsBefore = await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'));
  for (const text of ['Глютен исключи', 'Морковь не добавляй, глютен исключи', '2 молока, глютен исключи']) {
    await submit(page, text);
    await expect(status(page)).toContainText('Не распознала:');
    await expect(status(page)).toContainText('глютен');
    expect(await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needsBefore);
    expect(await savedBasket(page)).toBe(before);
    expect(ai).toBe(0); expect(addresses).toBe(0);
  }
  await submit(page, 'Пп');
  await expect(status(page)).toContainText('Уточни пищевое ограничение');
  expect(ai).toBe(0); expect(addresses).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needsBefore);
  expect(await savedBasket(page)).toBe(before);
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needsBefore);
  expect(await savedBasket(page)).toBe(before);
});


test('advice rejection lets a buyer defer budget without losing the goal', async ({page}) => {
  const requests = [];
  await page.route('**/functions/v1/ai-basket-proposal', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { kind: 'unavailable', code: 'provider_advice_commercial_claim' } });
  });
  await page.goto('/?comparison=demo#shop');
  await openHory(page);
  const before = await savedBasket(page);
  await submit(page, 'Нужна еда на две недели для троих');
  await expect(status(page)).toContainText('Какой общий бюджет');
  await submit(page, 'Бюджет пока не решил');
  await expect(status(page)).toContainText('Какие продукты особенно хочется включить');
  await expect(status(page)).not.toContainText('Какой общий бюджет');
  expect(requests).toHaveLength(2);
  expect(requests[1].context.peopleCount).toBe(3);
  expect(requests[1].context.shoppingDays).toBe(14);
  expect(requests[1].history[1].text).toContain('Какой общий бюджет');
  expect(await savedBasket(page)).toBe(before);
});

test('guided shopping respects deferred budget and preserves the household without a provider call',async({page})=>{
 let calls=0;await page.route('**/functions/v1/ai-basket-proposal',r=>{calls++;return r.fulfill({status:503,json:{kind:'unavailable',code:'provider_advice_commercial_claim'}})});
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 await submit(page,'Слушай, нужна еда на две недели, побольше фарша и фруктов. Что посоветуешь?');
 await expect(status(page)).toContainText('На сколько человек');
 await submit(page,'На троих, морозилка есть');await expect(status(page)).toContainText('общий бюджет');
 await submit(page,'Бюджет пока не решил');
 await expect(status(page)).toContainText('Какие продукты исключить');
 await expect(status(page)).toContainText('для 3 человек');await expect(status(page)).toContainText('на 14 дн.');
 await expect(status(page)).toContainText('морозилка есть');await expect(status(page)).not.toContainText('Какой общий бюджет');
 expect(calls).toBe(0);expect(await savedBasket(page)).toBeNull();
});

test('compound deferred budget keeps wanted foods and fish exclusion',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 await submit(page,'Собери продукты на неделю для четверых');await expect(status(page)).toContainText('общий бюджет');
 await submit(page,'не знаю, но хочу фарш и яблоки');await expect(status(page)).toContainText('Какие продукты исключить');
 await submit(page,'без рыбы');
 await status(page).getByRole('button',{name:'Изменить список',exact:true}).click();
 await expect(status(page)).toContainText('Фарш');await expect(status(page)).toContainText('Яблоки');
 await expect(status(page)).not.toContainText('Какой общий бюджет');
 expect(await savedBasket(page)).toBeNull();
});

test('compound deferred budget with fish exclusion proceeds without inventing a budget',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 await submit(page,'Собери продукты на неделю для четверых');await expect(status(page)).toContainText('общий бюджет');
 await submit(page,'не знаю, без рыбы');await expect(status(page)).not.toContainText('Какой общий бюджет');
 await expect(status(page)).not.toContainText('Не получилось разобрать');
 expect(await savedBasket(page)).toBeNull();
});

for(const [answer,included,excluded] of [
 ['не знаю, но хочу не яблоки, а молоко','Молоко','Яблоки'],
 ['не знаю, но хочу без молока','Яблоки','Молоко'],
 ['не знаю, хочу яблоки и не хочу молоко','Яблоки','Молоко'],
 ['не знаю, но без яблок, хочу молоко','Молоко','Яблоки'],
 ['не знаю, хочу яблоки, но не молоко','Яблоки','Молоко']
]) test(`budget deferral preserves explicit food exclusion: ${answer}`,async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 await submit(page,'Собери продукты на неделю для четверых');await expect(status(page)).toContainText('общий бюджет');
 await submit(page,answer);await expect(status(page)).toContainText('Какие продукты исключить');
 await submit(page,'без рыбы');
 if(await status(page).getByRole('button',{name:'Изменить список',exact:true}).count())
  await status(page).getByRole('button',{name:'Изменить список',exact:true}).click();
 await expect(status(page)).toContainText(included);await expect(status(page)).not.toContainText(excluded);
});

for(const answer of ['не знаю, хочу все кроме молока','не знаю, не только яблоки, но и молоко','не знаю, хочу яблоки, молоко и бананы',
 'не знаю, хочу яблоки но молоко нет','не знаю, хочу молоко и не хочу молоко'])
 test(`ambiguous budget reply preserves list and asks for clarification: ${answer}`,async({page})=>{
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await page.evaluate(()=>localStorage.setItem('checkni.surface.basket.v1',JSON.stringify([{id:'milk-25-900',name:'Молоко 2,5%',unit:'900 мл',quantity:1}])));
  await page.reload();await openHory(page);const before=await savedBasket(page);
  await submit(page,'Собери продукты на неделю для четверых');await expect(status(page)).toContainText('общий бюджет');
  await submit(page,answer);await expect(status(page)).toContainText('Уточни отдельно');
  expect(await savedBasket(page)).toBe(before);
  await submit(page,'не знаю, без рыбы');await expect(status(page)).not.toContainText('Какой общий бюджет');
  await expect(status(page)).toContainText('для 4 человек');
 });

test('503 commercial-claim fallback retains context, accepts budget deferral and protects the basket',async({page})=>{
 const calls=[];await page.route('**/functions/v1/ai-basket-proposal',r=>{calls.push(r.request().postDataJSON());return r.fulfill({status:503,json:{kind:'unavailable',code:'provider_advice_commercial_claim'}})});
 await page.goto('/?comparison=demo#shop');const before=await savedBasket(page);
 await submit(page,'Нужна еда на две недели для троих');
 await expect(status(page)).toContainText('Ответ сервиса не прошёл проверку');await expect(status(page)).toContainText('бюджет');
 await submit(page,'Бюджет пока не решил');await expect(status(page)).toContainText('Какие продукты особенно хочется');
 await expect(status(page)).not.toContainText('Какой общий бюджет');
 expect(calls).toHaveLength(2);expect(calls[1].context.peopleCount).toBe(3);expect(calls[1].context.shoppingDays).toBe(14);
 expect(calls[1].context.budgetMinor).toBeNull();expect(calls[1].history[0].text).toContain('две недели для троих');
 await submit(page,'не люблю рыбу');await expect(status(page)).toContainText('Рыбу как товарную группу исключила');
 expect(calls).toHaveLength(2);expect(await savedBasket(page)).toBe(before);
 await expect(page.locator('#shopping-dialogue-history')).toContainText('Бюджет пока не решил');
});

test('503 then guided draft retains explicit mass without changing saved basket',async({page})=>{
 let calls=0;
 await page.route('**/functions/v1/ai-basket-proposal',r=>{calls++;return r.fulfill({status:503,json:{kind:'unavailable',code:'provider_advice_commercial_claim'}})});
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 const before=await savedBasket(page);
 await submit(page,'Посоветуй рыбу на ужин, чтобы быстро приготовить.');
 await expect(status(page)).toContainText('Ответ сервиса не прошёл проверку');expect(calls).toBe(1);
 await submit(page,'Собери продукты на неделю для четверых');
 await expect(status(page)).toContainText('общий бюджет');
 await submit(page,'не знаю, но хочу фарш 2 кг');
 await expect(status(page)).toContainText('Фарш: 2 кг');
 await expect(status(page)).toContainText('до перезагрузки страницы');
 await submit(page,'без рыбы');
 await expect(status(page)).toContainText('Фарш: 2 кг');
 expect(await savedBasket(page)).toBe(before);expect(calls).toBe(1);
});

test('household duration is not mistaken for product quantity and unsupported chicken is clarified',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 await submit(page,'хочу продукты на 7 дней для 3 человек, побольше фарша');
 await expect(status(page)).not.toContainText('Уточни отдельно продукт и точное количество');
 await submit(page,'хочу 2 кг курицы');
 await expect(status(page)).toContainText('Пока не умею учитывать количество этого продукта');
 await submit(page,'хочу 2 литра сока');
 await expect(status(page)).toContainText('Пока не умею учитывать количество этого продукта');
 expect(await savedBasket(page)).toBeNull();
});

test('editing guided list changes the draft rather than creating separate shopping needs',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 const before=await savedBasket(page);const needsBefore=await page.evaluate(()=>localStorage.getItem('checkni.shopping-needs.v1'));
 await submit(page,'Собери продукты на неделю для четверых');await submit(page,'Без лимита');await submit(page,'Ограничений нет');
 await status(page).getByRole('button',{name:'Изменить список',exact:true}).click();
 await submit(page,'добавь бананы');await expect(status(page)).toContainText('Список обновлён');await expect(status(page)).toContainText('Бананы');
 await expect(status(page)).toContainText('Фарш');await expect(status(page)).not.toContainText('Записано в список');
 await status(page).getByRole('button',{name:'Изменить список',exact:true}).click();
 await submit(page,'добавь яблоки и бананы');await expect(status(page)).toContainText('Уточни изменение');
 await submit(page,'убери молоко');await expect(status(page)).toContainText('Список обновлён');await expect(status(page)).not.toContainText('Молоко');
 await expect(status(page)).toContainText('Бананы');expect(await savedBasket(page)).toBe(before);
 expect(await page.evaluate(()=>localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needsBefore);
 await page.reload();await openHory(page);await expect(status(page)).not.toContainText('Список обновлён');expect(await savedBasket(page)).toBe(before);
});

test('standalone add without a guided edit still writes the separate shopping need',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 await submit(page,'добавь бананы');await expect(status(page)).toContainText('Записано в список');await expect(status(page)).toContainText('бананы');
 expect(await savedBasket(page)).toBeNull();
});

test('leaving guided edit prevents later additions from changing the old draft',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 await submit(page,'Собери продукты на неделю для четверых');await submit(page,'Без лимита');await submit(page,'Ограничений нет');
 await status(page).getByRole('button',{name:'Изменить список',exact:true}).click();
 await submit(page,'замени бананы на молоко');await expect(status(page)).toContainText('Исходного продукта нет');
 await status(page).getByRole('button',{name:'Подобрать товары и цены',exact:true}).click();
 await expect(status(page)).toContainText('Открой каталог');
 await submit(page,'добавь бананы');await expect(status(page)).toContainText('Записано в список');
 await expect(status(page)).not.toContainText('Список обновлён');expect(await savedBasket(page)).toBeNull();
});


test('duplicate synchronous click or submit is coalesced without mutating basket or separate needs',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await page.evaluate(()=>localStorage.setItem('checkni.surface.basket.v1',JSON.stringify([{id:'milk-25-900',name:'Молоко 2,5%',unit:'900 мл',quantity:1}])));
 await page.reload();await openHory(page);const before=await savedBasket(page),needs=await page.evaluate(()=>localStorage.getItem('checkni.shopping-needs.v1'));
 await submit(page,'Собери продукты на неделю для четверых');await submit(page,'Без лимита');await submit(page,'Ограничений нет');
 await status(page).getByRole('button',{name:'Изменить список',exact:true}).click();
 await page.locator('#basket-proposal-input').fill('добавь бананы');
 await page.evaluate(()=>{document.querySelector('#basket-proposal-submit').click();document.querySelector('#basket-proposal-submit').click();});
 await expect(status(page)).toContainText('Список обновлён');await expect(status(page)).toContainText('Бананы');
 expect(await page.evaluate(()=>localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needs);expect(await savedBasket(page)).toBe(before);
 await status(page).getByRole('button',{name:'Изменить список',exact:true}).click();
 await page.locator('#basket-proposal-input').fill('убери молоко');
 await page.evaluate(()=>{const form=document.querySelector('#basket-proposal-form');form.requestSubmit();form.requestSubmit();});
 await expect(status(page)).toContainText('Список обновлён');await expect(status(page)).not.toContainText('Молоко');
 expect(await page.evaluate(()=>localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needs);expect(await savedBasket(page)).toBe(before);
});

test('duplicate submission outside guided mode records only one shopping need',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 const before=await savedBasket(page);await page.locator('#basket-proposal-input').fill('добавь бананы');
 await page.evaluate(()=>{const form=document.querySelector('#basket-proposal-form');form.requestSubmit();form.requestSubmit();});
 await expect(status(page)).toContainText('Записано в список');
 const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem('checkni.shopping-needs.v1')));
 expect(saved.lines).toHaveLength(1);expect(saved.receipts).toHaveLength(1);expect(await savedBasket(page)).toBe(before);
});


test('rapid Enter repeat does not leak guided edit to the separate list',async({page})=>{
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 await submit(page,'Собери продукты на неделю для четверых');await submit(page,'Без лимита');await submit(page,'Ограничений нет');
 await status(page).getByRole('button',{name:'Изменить список',exact:true}).click();
 const needs=await page.evaluate(()=>localStorage.getItem('checkni.shopping-needs.v1'));
 await page.locator('#basket-proposal-input').fill('добавь бананы');
 await Promise.all([page.keyboard.press('Enter'),page.keyboard.press('Enter')]);
 await expect(status(page)).toContainText('Список обновлён');
 expect(await page.evaluate(()=>localStorage.getItem('checkni.shopping-needs.v1'))).toBe(needs);
});


test('a new distinct message is not blocked while the previous provider request waits',async({page})=>{
 let releaseFirst;const firstGate=new Promise(resolve=>{releaseFirst=resolve});const requests=[];
 await page.route('**/functions/v1/ai-basket-proposal',async route=>{
  requests.push(route.request().postDataJSON());
  if(requests.length===1)await firstGate;
  await route.fulfill({json:{kind:'advice',message:'Поняла, давай обсудим покупку.'}}).catch(()=>{});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');await openHory(page);
 const before=await savedBasket(page);
 await submit(page,'Посоветуй рыбу на ужин, чтобы быстро приготовить.');
 await expect.poll(()=>requests.length).toBe(1);
 await submit(page,'Посоветуй овощи для лёгкого ужина.');
 await expect(page.locator('#shopping-dialogue-history').locator('..')).toContainText('Посоветуй овощи для лёгкого ужина.');
 releaseFirst();expect(await savedBasket(page)).toBe(before);
});


test('provider 503 offers local basket without another AI request', async ({page}) => {
 let requests=0;
 await page.route('**/functions/v1/ai-basket-proposal',route=>{requests++;return route.fulfill({status:503,json:{kind:'unavailable',code:'provider_upstream_unavailable'}})});
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await openHory(page);
 const before=await savedBasket(page);
 await submit(page,'Слушай, нужна еда на две недели, побольше фарша и фруктов. Что посоветуешь?');
 await expect(status(page)).toContainText('На сколько человек');
 await submit(page,'На троих, без свинины');
 await expect(status(page)).toContainText('бюджет');
 console.log('offline-status',JSON.stringify(await status(page).innerText()),'requests',requests);
 await expect(status(page).getByRole('button',{name:'Собрать корзину',exact:true})).toBeVisible({timeout:5000});
 await status(page).getByRole('button',{name:'Собрать корзину',exact:true}).click();
 await expect(status(page)).not.toContainText('Сервис советов сейчас не ответил');
 await expect(status(page)).toContainText(/бюджет|магазин|продукт/u);
 expect(requests).toBe(2);
 expect(await savedBasket(page)).toBe(before);
});
