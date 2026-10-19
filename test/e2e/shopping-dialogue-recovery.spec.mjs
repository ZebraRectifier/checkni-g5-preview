import { test, expect } from '@playwright/test';

const submit = async (page, text) => {
  await page.locator('#basket-proposal-input').fill(text);
  await page.locator('#basket-proposal-submit').click();
};
const status = page => page.locator('#basket-proposal-status');
const savedBasket = page => page.evaluate(() => localStorage.getItem('checkni.surface.basket.v1'));

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
  await expect(status(page)).toContainText('Сейчас подумаю');
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
