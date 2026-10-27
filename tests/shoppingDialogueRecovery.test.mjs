import assert from 'node:assert/strict';
import test from 'node:test';
import { SHOP_CATALOG } from '../src/data/shopCatalog.mjs';
import { createBasketStore } from '../src/state/basketStore.mjs';
import { createShoppingNeedsStore } from '../src/state/shoppingNeedsStore.mjs';
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


function needsSession(provider, extra = {}) {
  const { needsStorage = null, ...options } = extra;
  const needsStore = createShoppingNeedsStore({ storage: needsStorage, allowUnlockedForTests: true });
  return { ...session(provider, { needsStore, ...options }), needsStore };
}

for (const text of ['Пп', 'ПП.', 'Хочу разобраться, что мне вообще покупать', 'Составь меню на неделю']) {
  test(`the app needs wrapper delegates a whole conversational turn once: ${text}`, async () => {
    const s = needsSession(async () => ({ kind: 'advice', message: 'Какие продукты хочется купить?' }));
    const result = await s.send(text);
    assert.equal(s.advice.length, 1);
    assert.deepEqual(s.proposals, []);
    assert.deepEqual(s.live, []);
    assert.deepEqual(s.needsStore.getSnapshot().lines, []);
    assert.deepEqual(s.basket.getSnapshot(), []);
    assert.match(result.presentation.message, /Какие продукты/u);
    s.flow.confirm('confirm_all');
    assert.deepEqual(s.basket.getSnapshot(), []);
  });
}

test('the actual needs wrapper retains accepted dialogue history and retries only the failed question on explicit request', async () => {
  let attempts = 0;
  const s = needsSession(async () => ++attempts === 3
    ? { kind: 'unavailable', code: 'provider_timeout' }
    : { kind: 'advice', message: 'Какие продукты хочется купить?' });
  await s.send('2 бутылки кефира');
  const before = s.needsStore.getSnapshot().lines;
  await s.send('Пп');
  await s.send('Хочу разобраться, что мне вообще покупать');
  const failed = await s.send('Пп.');
  assert.deepEqual(s.advice.map(input => input.history?.length ?? 0), [0, 2, 4]);
  assert.equal(attempts, 3);
  assert.match(failed.presentation.message, /Не успел получить ответ сервиса/u);
  assert.deepEqual(failed.presentation.conversationChoices, [{ label: 'Повторить вопрос', text: 'Пп.' }]);
  const retry = await s.send(failed.presentation.conversationChoices[0].text);
  assert.equal(attempts, 4);
  assert.equal(s.advice[3].text, s.advice[2].text);
  assert.deepEqual(s.advice[3].history, s.advice[2].history);
  assert.match(retry.presentation.message, /Какие продукты хочется купить/u);
  assert.deepEqual(s.needsStore.getSnapshot().lines, before);
  assert.deepEqual(s.basket.getSnapshot(), []);
  assert.deepEqual(s.proposals, []);
  assert.deepEqual(s.live, []);
});

test('a reference question without a product clarifies locally before advice, including after dialogue reset', async () => {
  for (const cleared of [false, true]) {
    const s = needsSession();
    await s.send('2 бутылки кефира');
    if (cleared) {
      await s.send('Пп');
      s.flow.invalidate();
    }
    const attempts = s.advice.length;
    const before = s.needsStore.getSnapshot().lines;
    for (const text of ['а как хранить?', 'а сколько хранить?', 'после открытия?']) {
      const reply = await s.send(text);
      assert.match(reply.presentation.message, /О каком продукте или блюде речь/u);
      assert.equal(s.advice.length, attempts);
      assert.deepEqual(s.needsStore.getSnapshot().lines, before);
      assert.deepEqual(s.proposals, []);
      assert.deepEqual(s.live, []);
      assert.deepEqual(s.basket.getSnapshot(), []);
    }
  }
});

for (const text of ['рис', 'чай', 'суп', '2 бутылки кефира', 'Три корочки', 'пп 2']) {
  test(`the conversation guard keeps a concrete need local: ${text}`, async () => {
    const s = needsSession();
    await s.send(text);
    assert.equal(s.advice.length, 0);
    assert.deepEqual(s.proposals, []);
    assert.deepEqual(s.live, []);
    assert.equal(s.needsStore.getSnapshot().lines.length, 1);
    assert.equal(s.needsStore.getSnapshot().lines[0].rawText, text);
    assert.equal(s.needsStore.getSnapshot().lines[0].resolution.status, 'unresolved');
    assert.deepEqual(s.basket.getSnapshot(), []);
  });
}

test('advice through the needs wrapper preserves saved refusal, quantity focus and repeated acknowledgement', async () => {
  const s = needsSession(async () => ({ kind: 'advice', message: 'Какие продукты хочется купить?' }));
  await s.send('2 бутылки кефира');
  await s.send('Морковь не добавляй');
  const before = s.needsStore.getSnapshot().lines;
  const reply = await s.send('Пп');
  assert.equal(s.advice.length, 1);
  assert.ok(s.advice[0].context.excluded.includes('carrots'));
  assert.deepEqual(s.needsStore.getSnapshot().lines, before);
  assert.match(reply.presentation.message, /Какие продукты/u);
  await s.send('ещё 2');
  await s.send('да');
  assert.equal(s.needsStore.getSnapshot().lines.length, 1);
  assert.equal(s.needsStore.getSnapshot().lines[0].quantity.value, '4');
  assert.equal(s.advice.length, 1);
  assert.deepEqual(s.basket.getSnapshot(), []);
});

test('rejected and unavailable advice through the needs wrapper never becomes a product or a second attempt', async () => {
  for (const provider of [async () => ({ kind: 'advice', message: 'В Магните фарш стоит 100 рублей.' }),
    async () => ({ kind: 'unavailable', code: 'rate_limited' }),
    async () => ({ kind: 'unavailable', code: 'provider_timeout' })]) {
    const s = needsSession(provider, { dialogueTimeoutMs: 15 });
    const result = await s.send('Хочу разобраться, что мне вообще покупать');
    assert.equal(s.advice.length, 1);
    assert.deepEqual(s.proposals, []);
    assert.deepEqual(s.needsStore.getSnapshot().lines, []);
    assert.deepEqual(s.basket.getSnapshot(), []);
    assert.notEqual(result.status, 'loading');
    assert.doesNotMatch(result.presentation.message, /Магнит|100/u);
  }
});

test('a late advice reply cannot replace a newer needs-list operation', async () => {
  let release;
  const s = needsSession(() => new Promise(resolve => { release = resolve; }));
  const pending = s.send('Пп');
  for (let i = 0; i < 50 && !release; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  const duplicate = s.flow.run('Пп');
  const current = await s.send('2 бутылки кефира');
  release({ kind: 'advice', message: 'Какие продукты хочется купить?' });
  await Promise.all([pending, duplicate]);
  assert.deepEqual(s.flow.getState(), current);
  assert.equal(s.needsStore.getSnapshot().lines.length, 1);
  assert.equal(s.needsStore.getSnapshot().lines[0].quantity.value, '2');
  assert.equal(s.advice.length, 1);
  assert.deepEqual(s.basket.getSnapshot(), []);
});


for (const text of ['Глютен исключи', 'Морковь не добавляй, глютен исключи', '2 молока, глютен исключи']) {
  test(`an unresolved food constraint reaches clarification before any needs mutation: ${text}`, async () => {
    const data = new Map();
    const storage = { getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
    const s = needsSession(undefined, { needsStorage: storage, preferenceStorage: storage });
    await s.send('2 бутылки кефира');
    const before = s.needsStore.getSnapshot().lines;
    const result = await s.send(text);
    assert.deepEqual(s.needsStore.getSnapshot().lines, before);
    assert.equal(s.advice.length, 0);
    assert.deepEqual(s.proposals, []);
    assert.deepEqual(s.live, []);
    assert.deepEqual(s.basket.getSnapshot(), []);
    assert.ok(s.flow.getConversation().facts.unresolvedConstraints.value.includes('глютен исключи'));
    if (text.startsWith('Морковь')) assert.ok(s.flow.getConversation().rejected.carrots);
    assert.match(result.presentation.message, /Не распознала:.*глютен/u);
    await s.send('Пп');
    assert.equal(s.advice.length, 0);
    assert.deepEqual(s.needsStore.getSnapshot().lines, before);
    const restored = needsSession(undefined, { needsStorage: storage, preferenceStorage: storage });
    await restored.send('Пп');
    assert.equal(restored.advice.length, 0);
    assert.deepEqual(restored.needsStore.getSnapshot().lines, before);
    assert.ok(restored.flow.getConversation().facts.unresolvedConstraints.value.includes('глютен исключи'));
  });
}

test('a specific food question keeps the delegates reviewed identity path without inventing a need', async () => {
  const s = needsSession();
  await s.send('Хочу понять, какое молоко взять');
  assert.equal(s.advice.length + s.proposals.length, 1);
  assert.deepEqual(s.needsStore.getSnapshot().lines, []);
  assert.deepEqual(s.basket.getSnapshot(), []);
});

test('the conversation route leaves the twelve, acknowledgement, six and plus-two sequence local', async () => {
  const s = needsSession();
  await s.send('12 бутылок кефира');
  await s.send('да');
  assert.equal(s.needsStore.getSnapshot().lines[0].quantity.value, '12');
  await s.send('кефира оставь 6');
  await s.send('ещё 2');
  await s.send('да');
  assert.equal(s.needsStore.getSnapshot().lines.length, 1);
  assert.equal(s.needsStore.getSnapshot().lines[0].quantity.value, '8');
  assert.equal(s.advice.length, 0);
  assert.deepEqual(s.proposals, []);
  assert.deepEqual(s.basket.getSnapshot(), []);
});

test('a conversational turn preserves the persistent needs record across reload', async () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const s = needsSession(async () => ({ kind: 'advice', message: 'Какие продукты хочется купить?' }), { needsStorage: storage });
  await s.send('2 бутылки кефира');
  const before = s.needsStore.getSnapshot().lines;
  await s.send('Хочу разобраться, что мне вообще покупать');
  const restored = needsSession(undefined, { needsStorage: storage });
  assert.deepEqual(restored.needsStore.getSnapshot().lines, before);
  assert.equal(s.advice.length, 1);
  assert.deepEqual(s.basket.getSnapshot(), []);
  assert.deepEqual(restored.basket.getSnapshot(), []);
});
