import test from "node:test";
import assert from "node:assert/strict";
import { extractShoppingNeedContext } from "../src/intelligence/shoppingNeedContext.mjs";
import { createShoppingConversation, extractShoppingDelta, updateShoppingConversation, isShoppingProductRejected } from "../src/intelligence/shoppingConversation.mjs";
import { parseRetailShoppingIntent } from "../src/intelligence/retailShoppingIntent.mjs";
import { createShoppingAssistantOrchestrator } from "../src/intelligence/shoppingAssistantOrchestrator.mjs";
import { createShoppingConversationFlow } from "../src/runtime/shoppingConversationFlow.mjs";
import { createShoppingPreferenceStore, SHOPPING_PREFERENCE_STORAGE_KEY } from "../src/runtime/shoppingPreferenceStorage.mjs";
import { createBasketStore } from "../src/state/basketStore.mjs";
import { createShoppingNeedsStore } from "../src/state/shoppingNeedsStore.mjs";
import { SHOP_CATALOG } from "../src/data/shopCatalog.mjs";
import * as interpreter from "../src/runtime/hybridBasketInterpreter.mjs";

// Synthetic observations verify request/identity flow, never retailer prices.
const kefir = { id: "retail:magnit:magnit-777312:1899800689", retailerId: "magnit", sourceProductId: "1899800689",
  name: "Кефир Простоквашино 2.5% 930г", unit: "930 г", storeName: "Магнит · Берёзовая аллея, 17к2", catalogDisplayOnly: true,
  priceMinor: 7999, currency: "RUB", availability: "unknown", observedAt: "2026-10-10T06:30:00Z",
  productUrl: "https://magnit.ru/product/1899800689-kefir_prostokvashino_2_5_930g?shopCode=777312&shopType=1",
  sourceUrl: "https://magnit.ru/catalog/63963-molochnyy_prilavok?shopCode=777312&shopType=1" };
const milk = { ...kefir, id: "retail:magnit:magnit-777312:1899800733", sourceProductId: "1899800733",
  name: "Молоко Простоквашино пастеризованное 2.5% 930мл", unit: "930 мл",
  productUrl: "https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=777312&shopType=1" };
function session(options = {}) {
  const basket = createBasketStore({ storage: null });
  const calls = []; let modelCalls = 0, adviceCalls = 0;
  const assistant = createShoppingAssistantOrchestrator({
    getRetailerContext: () => ({ retailerId: "magnit", storeId: "magnit-777312", shopCode: "777312" }),
    searchRetailer: async (_, query) => { calls.push(query); return { kind: "catalog", products: [kefir, milk]
      .filter(row => row.name.toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU"))) }; }
  });
  const flow = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG, preferenceStorage: null,
    loader: { load: async () => interpreter }, resolveProductFactsCatalog: () => [kefir, milk],
    resolveCommercialRequest: (text, catalog, context = {}) => assistant.resolveCommercialRequest(text, catalog, { ...context, retailer: "Магнит" }),
    requestAiProposal: async () => { modelCalls++; return { kind: "unavailable", code: "source_unavailable" }; },
    requestShoppingAdvice: async () => { adviceCalls++; return { kind: "unavailable", code: "source_unavailable" }; }, ...options });
  return { flow, basket, calls, modelCalls: () => modelCalls, adviceCalls: () => adviceCalls,
    say: text => { flow.edit(); return flow.run(text); } };
}

test("shopping context leaves explicit product brands, fat, pack and package quantities intact", () => {
  const text = "Хочу два кефира Простоквашино 2,5% 930 г и три молока на неделю на двоих";
  const context = extractShoppingNeedContext(text);
  assert.equal(context.facts.peopleCount.value, 2);
  assert.equal(context.facts.shoppingDays.value, 7);
  const intent = parseRetailShoppingIntent(text, SHOP_CATALOG);
  assert.deepEqual(intent.items, [
    { query: "кефира Простоквашино 2.5% 930 г", quantity: 2 },
    { query: "молока", quantity: 3 }
  ]);
});

for (const [text, days, people] of [
  ["Кефир на 3 дня для 2 человек", 3, 2], ["На двоих кефир на неделю", 7, 2],
  ["Кефир на две недели", 14, undefined], ["Кефир на один день", 1, undefined],
  ["Кефир на 31 день для троих", 31, 3], ["Кефир на недельку", 7, undefined]
]) test(`explicit context: ${text}`, () => {
  const result = extractShoppingNeedContext(text);
  assert.equal(result.facts.shoppingDays?.value, days);
  assert.equal(result.facts.peopleCount?.value, people);
  assert.match(result.text, /кефир/iu);
});

for (const text of ["Кефир на 0 дней", "Кефир на 32 дня", "Кефир на 1,5 дня", "Кефир на -2 дня",
  "Кефир на 13 человек", "Кефир на 2-3 человека", "Кефир на 2 - 3 человека",
  "Кефир на двоих на троих", "Кефир на неделю на 3 дня", "Кефир не на неделю"
]) test(`ambiguous or invalid context asks instead of guessing: ${text}`, () => {
  const result = extractShoppingNeedContext(text);
  assert.ok(result.clarification);
  assert.deepEqual(result.facts, {});
});

test("quoted product labels and numeric specifications are never silently removed as household context", () => {
  for (const text of ['Кефир «На двоих» 2,5% 930 г', 'Каша "На неделю" 400 г', "Молоко на 2,5%", "Кефир на 2"]) {
    const result = extractShoppingNeedContext(text);
    assert.equal(result.text, text);
    assert.equal(result.recognized, false);
  }
});

for (const needsMode of [false, true]) test(`weekly source list keeps exact quantities through both confirmations and never creates a seed basket (needs: ${needsMode})`, async () => {
  const { say, flow, calls, basket, modelCalls } = session({ needsStore: needsMode ? createShoppingNeedsStore({ storage: null }) : undefined });
  let state = await say("Хочу два кефира и три молока на неделю на двоих");
  assert.match(state.presentation.message, /для 2 чел.*на 7 дней/u);
  assert.match(state.presentation.message, /Количество упаковок выберем отдельно/u);
  assert.equal(state.presentation.selectionQuantity, 2);
  assert.equal(state.presentation.selectionCards[0].id, kefir.id);
  assert.deepEqual(basket.getSnapshot(), []);
  await say("первый"); await say("го");
  assert.equal(basket.getSnapshot()[0].quantity, 2);
  state = await say("следующий товар");
  assert.equal(state.presentation.selectionCards[0].id, milk.id);
  assert.equal(state.presentation.selectionQuantity, 3);
  assert.match(state.presentation.message, /на 7 дней/u);
  await say("первый"); await say("го");
  assert.deepEqual(basket.getSnapshot().map(row => [row.id, row.unit, row.quantity]), [
    ["kefir-1l", "930 г", 2], ["milk-25-900", "930 мл", 3]
  ]);
  assert.deepEqual(calls, ["Кефир", "Молоко"]);
  assert.equal(flow.getConversation().facts.peopleCount.value, 2);
  assert.equal(flow.getConversation().facts.shoppingDays.value, 7);
  assert.equal(modelCalls(), 0);
});

test("short context answers preserve the current source choice and require its fresh visible confirmation", async () => {
  const { say, flow, basket, calls } = session();
  await say("Хочу кефир"); await say("две бутылки"); await say("первый");
  let state = await say("на двоих на неделю");
  assert.match(state.presentation.message, /для 2 чел.*на 7 дней/u);
  assert.match(state.presentation.message, /930 г ×2/u);
  assert.deepEqual(basket.getSnapshot(), []);
  await say("го");
  assert.equal(basket.getSnapshot()[0].quantity, 2);
  state = await say("на 0 дней");
  assert.match(state.presentation.message, /одно целое число/u);
  assert.equal(flow.getConversation().facts.shoppingDays.value, 7);
  await say("го"); assert.equal(basket.getSnapshot()[0].quantity, 2);
  assert.deepEqual(calls, ["Кефир"]);
});

test("context is remembered across product turns, while new goals and reset clear it", async () => {
  const { say, flow, basket } = session();
  await say("На двоих на неделю");
  const memory = await say("что ты помнишь?");
  assert.match(memory.presentation.message, /для 2 чел.*на 7 дней/u);
  await say("новая корзина");
  assert.equal(flow.getConversation().facts.peopleCount, undefined);
  assert.equal(flow.getConversation().facts.shoppingDays, undefined);
  await say("на троих на 2 дня"); await say("сбрось предпочтения");
  assert.equal(flow.getConversation().facts.shoppingDays, undefined);
  assert.deepEqual(basket.getSnapshot(), []);
});

test("unknown composition restrictions remain blocking with the period preserved", async () => {
  const { say, flow, basket, calls } = session();
  const state = await say("Хочу кефир на неделю без сахара");
  assert.match(state.presentation.message, /Не распознала.*без сахара/u);
  assert.equal(flow.getConversation().facts.shoppingDays.value, 7);
  await say("Хочу кефир"); await say("го");
  assert.deepEqual(calls, []);
  assert.deepEqual(basket.getSnapshot(), []);
});

test("non-retail context asks for a real store and retains unknown refusals without proposing placeholders", async () => {
  const { say, flow, basket, calls, modelCalls } = session({ resolveProductFactsCatalog: () => SHOP_CATALOG });
  let state = await say("Хочу кефир на неделю на двоих");
  assert.match(state.presentation.message, /Выбери магазин/u);
  assert.equal(state.result.draftProposal, undefined);
  state = await say("Хочу молоко на 3 дня без лактозы");
  assert.match(state.presentation.message, /Не распознала.*без лактозы/u);
  assert.equal(flow.getConversation().facts.shoppingDays.value, 3);
  assert.deepEqual(basket.getSnapshot(), []); assert.deepEqual(calls, []); assert.equal(modelCalls(), 0);
});

test("meat-free dinner keeps people, budget and cooking question, without inventing label composition", async () => {
  const { say, flow, basket, calls } = session();
  let state = await say("Ужин на двоих без мяса до 700 ₽");
  assert.match(state.presentation.message, /на 2 чел.*700 ₽ на всех.*готовки/u);
  assert.equal(flow.getConversation().rejected.meat.value, true);
  assert.equal(flow.getConversation().facts.unresolvedConstraints, undefined);
  state = await say("без готовки");
  assert.match(state.presentation.message, /Бутерброды с сыром и томатами/u);
  assert.doesNotMatch(state.presentation.message, /не распознала|безопасно|гарантир/iu);
  assert.deepEqual(basket.getSnapshot(), []); assert.deepEqual(calls, []);
});

test("a weekly meal retains household, entire-period budget and restriction before requesting specific products", async () => {
  const { say, flow, basket, modelCalls } = session();
  let state = await say("Ужин на двоих на неделю без мяса до 700 ₽");
  assert.match(state.presentation.message, /на 2 чел.*на 7 дней.*700 ₽ на весь период/u);
  assert.match(state.presentation.message, /Полное меню.*ещё не составлено/u);
  assert.equal(flow.getConversation().facts.shoppingDays.value, 7);
  assert.equal(flow.getConversation().rejected.meat.value, true);
  state = await say("го"); assert.match(state.presentation.message, /конкретного продукта/u);
  state = await say("кефир");
  assert.equal(state.presentation.selectionCards[0].id, kefir.id);
  assert.match(state.presentation.message, /для 2 чел.*на 7 дней/u);
  assert.deepEqual(basket.getSnapshot(), []); assert.equal(modelCalls(), 0);
});

test("meat refusal includes poultry and meat fillings, and a rice/cheese wish cannot bypass it", () => {
  const memory = updateShoppingConversation(createShoppingConversation(), extractShoppingDelta("без мяса; добавь рис и сыр")).state;
  for (const name of ["Куриный фарш", "Филе куриное", "Говядина", "Свинина", "Колбаса", "Сыр с ветчиной", "Рис с курицей", "Утка", "Кролик", "Баранина"]) {
    assert.equal(isShoppingProductRejected({ name }, memory), true, name);
  }
  assert.equal(isShoppingProductRejected({ name: "Яйца куриные", category: "Мясо, птица, яйца" }, memory), false);
  for (const name of ["Молоко", "Кефир", "Яйца куриные", "Яблоки", "Сыр", "Соус для мяса", "Котлеты без мяса"]) {
    assert.equal(isShoppingProductRejected({ name }, memory), false, name);
  }
  const exception = updateShoppingConversation(memory, extractShoppingDelta("курицу теперь можно")).state;
  assert.equal(isShoppingProductRejected({ name: "Филе куриное" }, exception), false);
  assert.equal(isShoppingProductRejected({ name: "Свинина" }, exception), true);
  assert.equal(isShoppingProductRejected({ name: "Куриный фарш со свининой" }, exception), true);
  assert.equal(isShoppingProductRejected({ name: "Куриный фарш с говяжьим фаршем" }, exception), true);
  for (const phrase of ["без красного мяса", "без жирного мяса", "не без мяса"]) {
    const delta = extractShoppingDelta(phrase);
    assert.equal(delta.reject.includes("meat"), false);
    assert.ok(delta.unresolved.length, phrase);
  }
});

test("a simple meat refusal with a product searches that product instead of building an unrelated basket", async () => {
  const { say, flow, basket, calls } = session();
  const state = await say("Хочу кефир на неделю без мяса");
  assert.equal(state.presentation.selectionCards[0].id, kefir.id);
  assert.equal(flow.getConversation().rejected.meat.value, true);
  assert.match(state.presentation.message, /на 7 дней/u);
  assert.deepEqual(calls, ["Кефир"]); assert.deepEqual(basket.getSnapshot(), []);
});

test("new household/period facts stay session-only; explicit meat refusal restores without an unseen draft", async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const { say } = session({ preferenceStorage: storage });
  await say("Ужин на двоих на неделю без мяса до 700 ₽");
  const raw = JSON.parse(values.get(SHOPPING_PREFERENCE_STORAGE_KEY));
  assert.equal(raw.facts.peopleCount, undefined); assert.equal(raw.facts.shoppingDays, undefined);
  assert.equal(raw.rejected.meat.value, true);
  const restored = createShoppingPreferenceStore({ storage }).read();
  assert.equal(restored.rejected.meat.value, true);
  assert.equal(restored.facts.unresolvedConstraints, undefined);
  const reloaded = session({ preferenceStorage: storage });
  await reloaded.say("го"); assert.deepEqual(reloaded.basket.getSnapshot(), []);
});

test("commercial and product-advice questions remain read-only instead of becoming contextual shopping drafts", async () => {
  for (const text of ["Сколько стоит кефир на неделю?", "Как выбрать сыр на двоих?"]) {
    const { say, flow, basket } = session();
    const state = await say(text);
    assert.equal(state.result.draftProposal, undefined, text);
    assert.equal(flow.getConversation().facts.peopleCount, undefined, text);
    assert.equal(flow.getConversation().facts.shoppingDays, undefined, text);
    assert.deepEqual(basket.getSnapshot(), []);
  }
});

test("the current advice contract supports broad meat exclusions without disabling the provider", async () => {
  const { say, adviceCalls, basket } = session();
  await say("Ужин на двоих без мяса до 700 ₽");
  await say("Как выбрать рыбу для запекания?");
  assert.equal(adviceCalls(), 1);
  assert.deepEqual(basket.getSnapshot(), []);
});
