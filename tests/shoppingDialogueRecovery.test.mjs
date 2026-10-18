import assert from 'node:assert/strict';
import test from 'node:test';
import { SHOP_CATALOG } from '../src/data/shopCatalog.mjs';
import { createBasketStore } from '../src/state/basketStore.mjs';
import { createShoppingConversationFlow } from '../src/runtime/shoppingConversationFlow.mjs';
import { normalizeShoppingAdviceRequest } from '../src/intelligence/shoppingAdviceContract.mjs';
import { extractShoppingNeedContext } from '../src/intelligence/shoppingNeedContext.mjs';
import { shoppingDialogueNeed } from '../src/intelligence/shoppingDialogueRecovery.mjs';
import * as interpreter from '../src/runtime/hybridBasketInterpreter.mjs';

function session(provider = async () => ({ kind: 'advice', message: 'На сколько человек нужна еда?' }), extra = {}) {
  const basket = createBasketStore({ storage: null });
  const advice = []; const proposals = []; const live = [];
  const flow = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG,
    preferenceStorage: null, priceHints: new Map(), loader: { load: async () => interpreter },
    requestShoppingAdvice: async input => { advice.push(structuredClone(input)); return provider(input); },
    requestAiProposal: async text => { proposals.push(text); return { kind: 'unavailable' }; },
    resolveLiveCatalog: async text => { live.push(text); return []; }, ...extra });
  const send = async text => { flow.edit(); return flow.run(text); };
  return { basket, flow, send, advice, proposals, live };
}

test('an open shopping goal and the actual people/freezer answer use one advice request per turn', async () => {
  const s = session(async input => ({ kind: 'advice', message: input.context.peopleCount === 3
    ? 'Учту троих и запас для заморозки. Какой общий бюджет на весь срок?'
    : 'На сколько человек нужна еда? Есть ли морозилка для запаса?' }));
  const first = 'Слушай, я живу в Пушкино. Нужна еда на две недельки, побольше фарша и фруктов. Посмотри по магазинам и дай рекомендации.';
  await s.send(first);
  assert.equal(s.advice.length, 1);
  assert.equal(s.advice[0].context.shoppingDays, 14);
  assert.match(s.advice[0].text, /Пушкино|пушкино/u);
  const answer = await s.send('на 3 да есть морозилка');
  assert.equal(s.advice.length, 2);
  assert.equal(s.advice[1].context.peopleCount, 3);
  assert.equal(s.advice[1].context.shoppingDays, 14);
  assert.match(s.advice[1].text, /морозилка: есть/u);
  assert.equal(s.advice[1].history[0].text, first);
  assert.match(s.advice[1].history[1].text, /На сколько человек/u);
  assert.match(answer.presentation.message, /бюджет/u);
  assert.deepEqual(s.proposals, []);
  assert.deepEqual(s.live, []);
  assert.deepEqual(s.basket.getSnapshot(), []);
  for (const input of s.advice) assert.ok(normalizeShoppingAdviceRequest(input));
});

for (const text of ['Пп', 'что-нибудь к пиву', 'Посоветуй продукты для заморозки.', 'Хочу разобраться, что мне вообще покупать']) {
  test(`an unresolved phrase goes to advice without a strict proposal or catalog wait: ${text}`, async () => {
    const s = session(undefined, { resolveLiveCatalog: () => new Promise(() => {}) });
    const answer = await s.send(text);
    assert.equal(s.advice.length, 1);
    assert.deepEqual(s.proposals, []);
    assert.match(answer.presentation.message, /На сколько человек/u);
    assert.doesNotMatch(answer.presentation.headline, /Не получилось разобрать/u);
    assert.deepEqual(answer.presentation.items, []);
    s.flow.confirm('confirm_all');
    assert.deepEqual(s.basket.getSnapshot(), []);
  });
}

test('an active store with no returned cards cannot swallow an unclear conversational turn', async () => {
  const s = session(undefined, { resolveRetailSelectionScope: () => ({ retailerId: 'magnit', storeId: 'test-store' }),
    resolveCommercialRequest: async () => ({ kind: 'commercial-assistant-result', retailerId: 'magnit',
      retailerContext: { storeId: 'test-store' }, retailProducts: [] }) });
  const answer = await s.send('Пп');
  assert.equal(s.advice.length, 1);
  assert.match(answer.presentation.message, /На сколько человек/u);
  assert.deepEqual(s.basket.getSnapshot(), []);
});

test('a concrete product keeps strict identity selection and a failed attempt asks locally before the next dialogue turn', async () => {
  const s = session();
  const failed = await s.send('хлеб бородинский');
  assert.deepEqual(s.proposals, ['хлеб бородинский']);
  assert.deepEqual(s.live, ['хлеб бородинский']);
  assert.equal(s.advice.length, 0);
  assert.match(failed.presentation.message, /Уточни вид, марку или упаковку/u);
  assert.doesNotMatch(failed.presentation.headline, /Не получилось разобрать/u);
  await s.send('Марка не важна, что-нибудь для бутербродов');
  assert.equal(s.proposals.length, 1);
  assert.equal(s.advice.length, 1);
  assert.equal(s.advice[0].history[0].text, 'хлеб бородинский');
  assert.match(s.advice[0].history[1].text, /Уточни вид/u);
  assert.deepEqual(s.basket.getSnapshot(), []);
});

test('short clarification replies retain bounded accepted history and explicit freezer context', async () => {
  const s = session();
  await s.send('Нужны продукты на две недели для троих. Есть морозилка.');
  for (const text of ['Бюджет пока не решил', 'Готовить могу', 'Хочется больше разнообразия', 'А что предложишь дальше']) await s.send(text);
  assert.equal(s.advice.length, 5);
  assert.equal(s.advice.at(-1).context.peopleCount, 3);
  assert.equal(s.advice.at(-1).context.shoppingDays, 14);
  assert.equal(s.advice.at(-1).history.length, 6);
  assert.match(s.advice.at(-1).text, /морозилка: есть/u);
  assert.ok(normalizeShoppingAdviceRequest(s.advice.at(-1)));
  await s.send('Нет морозилки');
  assert.match(s.advice.at(-1).text, /морозилка: нет/u);
});

test('a bare number becomes people only after the accepted people question', () => {
  assert.deepEqual(shoppingDialogueNeed('на 3 да есть морозилка').facts, {});
  const history = [{ role: 'user', text: 'Нужна еда на неделю' },
    { role: 'assistant', text: 'На сколько человек нужна еда?' }];
  assert.equal(shoppingDialogueNeed('на 3 да есть морозилка', history).facts.peopleCount.value, 3);
  assert.equal(shoppingDialogueNeed('на 3 дня', history).facts.peopleCount, undefined);
  assert.equal(shoppingDialogueNeed('3 кг фарша', history).facts.peopleCount, undefined);
  assert.equal(shoppingDialogueNeed('3000 рублей', history).facts.peopleCount, undefined);
});

test('a bare budget answer belongs to the actual budget question and remains a goal, not a price', async () => {
  const s = session(async () => ({ kind: 'advice', message: 'Какой общий бюджет на весь срок?' }));
  await s.send('Нужна еда на две недели для троих');
  await s.send('15000');
  assert.equal(s.advice.at(-1).context.budgetMinor, 1500000);
  assert.equal(s.advice.at(-1).context.peopleCount, 3);
  assert.deepEqual(shoppingDialogueNeed('15000').facts, {});
  assert.deepEqual(s.basket.getSnapshot(), []);
});

test('a question about a freezer is not a statement of owned equipment', async () => {
  const s = session();
  await s.send('Нужна еда на две недели для троих');
  await s.send('А если есть морозилка?');
  assert.doesNotMatch(s.advice.at(-1).text, /морозилка: есть/u);
  await s.send('Есть морозилка');
  assert.match(s.advice.at(-1).text, /морозилка: есть/u);
  await s.send('Морозилка сломалась');
  assert.match(s.advice.at(-1).text, /морозилка: нет/u);
});

test('a new goal or preference reset cannot carry equipment notes from the previous dialogue', async () => {
  for (const reset of ['новая корзина', 'сбрось предпочтения']) {
    const s = session();
    await s.send('Нужна еда на две недели для троих. Есть морозилка');
    await s.send(reset);
    await s.send('Пп');
    assert.doesNotMatch(s.advice.at(-1).text, /морозилка/u, reset);
  }
});

test('repeated pending submits coalesce into one advice request', async () => {
  let release;
  const s = session(() => new Promise(resolve => { release = resolve; }));
  const pending = Array.from({ length: 10 }, () => s.flow.run('Нужна еда на две недели'));
  while (!release) await Promise.resolve();
  assert.equal(s.advice.length, 1);
  release({ kind: 'advice', message: 'На сколько человек нужна еда?' });
  await Promise.all(pending);
  assert.equal(s.advice.length, 1);
  assert.deepEqual(s.proposals, []);
});

test('ordinary recognized products keep the existing shopping path and make no advice call', async () => {
  const s = session();
  await s.send('два молока');
  assert.equal(s.advice.length, 0);
  assert.equal(s.basket.getSnapshot().find(row => row.id === 'milk-25-900').quantity, 2);
});

test('a literal product list after a conversation returns to reviewed shopping without another advice request', async () => {
  const s = session();
  await s.send('Нужна еда на две недели для троих');
  const count = s.advice.length;
  await s.send('два молока');
  assert.equal(s.advice.length, count);
  assert.deepEqual(s.flow.getState().result.draftProposal.items, [{ productId: 'milk-25-900', quantity: 2 }]);
  assert.deepEqual(s.basket.getSnapshot(), []);
});

test('an explicit basket command exits the dialogue path instead of being interpreted as an answer', async () => {
  const s = session();
  await s.send('Нужна еда на две недели для троих');
  const count = s.advice.length;
  await s.send('Добавь молоко');
  assert.equal(s.advice.length, count);
});

test('commercial questions retain Core/tool routing and never ask the advice provider for prices', async () => {
  let commercialCalls = 0;
  const s = session(undefined, { resolveCommercialRequest: async () => {
    commercialCalls++;
    return { kind: 'commercial-assistant-result', basket: [], comparison: null,
      retailerObservation: null, retailProducts: [], catalogProducts: [], toolTrace: [] };
  } });
  await s.send('Нужна еда на две недели для троих');
  const count = s.advice.length;
  await s.send('Сколько стоит молоко?');
  assert.equal(s.advice.length, count);
  await s.send('Какая цена молока?');
  assert.equal(s.advice.length, count);
  assert.equal(commercialCalls, 1);
});

test('a rejected commercial reply becomes a useful local question without a second paid attempt', async () => {
  const s = session(async () => ({ kind: 'advice', message: 'В Магните фарш стоит 100 рублей.' }));
  const answer = await s.send('Нужна еда на две недели для троих');
  assert.equal(s.advice.length, 1);
  assert.deepEqual(s.proposals, []);
  assert.match(answer.presentation.message, /Ответ сервиса не прошёл проверку.*бюджет/u);
  assert.doesNotMatch(answer.presentation.message, /Магнит|100/u);
});

test('a provider timeout or quota response preserves context and leaves a concrete next question', async () => {
  for (const provider of [() => new Promise(() => {}), async () => ({ kind: 'unavailable', code: 'rate_limited' }), async () => { throw Error('offline'); }]) {
    const s = session(provider, { dialogueTimeoutMs: 15 });
    const result = await s.send('Нужна еда на две недели для троих');
    assert.equal(s.advice.length, 1);
    assert.notEqual(result.status, 'loading');
    assert.match(result.presentation.message, /бюджет/u);
    assert.doesNotMatch(result.presentation.headline, /Не получилось разобрать/u);
    assert.equal(s.flow.getConversation().facts.peopleCount.value, 3);
    assert.deepEqual(s.proposals, []);
  }
});

test('clearing the dialogue discards pending answers and equipment notes', async () => {
  let release;
  let calls = 0;
  const s = session(() => ++calls === 1 ? new Promise(resolve => { release = resolve; })
    : Promise.resolve({ kind: 'advice', message: 'Какие продукты хочешь подобрать?' }));
  const pending = s.send('Нужна еда на две недели. Есть морозилка');
  while (!release) await Promise.resolve();
  s.flow.invalidate();
  release({ kind: 'advice', message: 'На сколько человек нужна еда?' });
  await pending;
  assert.equal(s.flow.getState().status, 'idle');
  await s.send('Пп');
  assert.doesNotMatch(s.advice.at(-1).text, /морозилка/u);
  assert.deepEqual(s.advice.at(-1).history ?? [], []);
});

test('dialogue text and equipment are never written to preference storage', async () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const s = session(undefined, { preferenceStorage: storage });
  await s.send('Живу в Пушкино. Нужна еда на две недели для троих. Есть морозилка.');
  await s.send('Бюджет пока не решил');
  const serialized = JSON.stringify([...saved]);
  assert.doesNotMatch(serialized, /Пушкино|пушкино|морозилка|На сколько человек|Нужна еда/u);
});

test('a changed confirmed basket discards a delayed dialogue answer without an automatic mutation', async () => {
  let release;
  const s = session(() => new Promise(resolve => { release = resolve; }));
  const pending = s.send('Нужна еда на две недели для троих');
  while (!release) await Promise.resolve();
  s.basket.mergeValidatedBasket([{ product: SHOP_CATALOG.find(row => row.id === 'milk-25-900'), quantity: 1 }]);
  const before = structuredClone(s.basket.getSnapshot());
  release({ kind: 'advice', message: 'На сколько человек нужна еда?' });
  const answer = await pending;
  assert.match(answer.presentation.message, /текущие покупки/u);
  assert.doesNotMatch(answer.presentation.message, /На сколько человек/u);
  assert.deepEqual(s.basket.getSnapshot(), before);
});

test('a new supported product-advice topic does not inherit unrelated dialogue history', async () => {
  const s = session();
  await s.send('Нужна еда на две недели для троих');
  await s.send('Я вот думаю взять яблоки на пирог, что скажешь?');
  assert.deepEqual(s.advice.at(-1).history ?? [], []);
});

test('diminutive week phrases retain an explicit bounded period', () => {
  assert.equal(extractShoppingNeedContext('на две недельки').facts.shoppingDays.value, 14);
  assert.equal(extractShoppingNeedContext('на одну недельку').facts.shoppingDays.value, 7);
  assert.ok(extractShoppingNeedContext('на шесть неделек').clarification);
});
