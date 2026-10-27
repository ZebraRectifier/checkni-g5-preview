import assert from "node:assert/strict";
import test from "node:test";
import { createShoppingConversationFlow } from "../src/runtime/shoppingConversationFlow.mjs";
import { createShoppingAssistantOrchestrator } from "../src/intelligence/shoppingAssistantOrchestrator.mjs";
import { createBasketStore } from "../src/state/basketStore.mjs";
import { createShoppingNeedsStore } from "../src/state/shoppingNeedsStore.mjs";
import { SHOP_CATALOG } from "../src/data/shopCatalog.mjs";
import { admittedRetailSelectionCards } from "../src/intelligence/retailProductSelection.mjs";
import * as interpreter from "../src/runtime/hybridBasketInterpreter.mjs";

const card = {
  id: "retail:magnit:magnit-777312:1899800689", retailerId: "magnit", retailerDisplayName: "Магнит", storeName: "Магнит · Берёзовая аллея, 17к2",
  sourceProductId: "1899800689", name: "Кефир Простоквашино 2.5% 930г", unit: "930 г", priceMinor: 7999, currency: "RUB", availability: "unknown",
  priceConditionLabel: "Публичная онлайн-цена", observedAt: "2026-10-10T06:30:00Z",
  productUrl: "https://magnit.ru/product/1899800689-kefir_prostokvashino_2_5_930g?shopCode=777312&shopType=1",
  sourceUrl: "https://magnit.ru/catalog/63963-moloko?shopCode=777312&shopType=1", imageUrl: "https://images-foodtech.magnit.ru/photo.jpg"
};
const other = { ...card, id: "retail:magnit:magnit-777312:other", sourceProductId: "other", name: "Кефир Другая марка 2.5% 900г", unit: "900 г", priceMinor: 5999,
  productUrl: "https://magnit.ru/product/other?shopCode=777312&shopType=1" };
const context = { storeId: "magnit-777312", storeName: card.storeName, shopCode: "777312" };
const receipt = cards => ({ kind: "commercial-assistant-result", retailerId: "magnit", retailerContext: context, retailProducts: cards });

function session(options = {}) {
  const basket = createBasketStore({ storage: null });
  let visible = [{ ...card, catalogDisplayOnly: true }];
  const calls = [];
  const assistant = createShoppingAssistantOrchestrator({
    getRetailerContext: retailerId => ({ ...context, retailerId }),
    searchRetailer: async (id, query) => { calls.push({ id, query }); return { kind: "catalog", products: options.cards ?? [card, other] }; },
    searchCatalog: async () => { calls.push("global"); return { kind: "catalog", products: [] }; },
    getObservedPrices: async () => { calls.push("prices"); return { kind: "unavailable" }; },
    compareBasket: async () => { calls.push("compare"); return { kind: "unavailable" }; }
  });
  const flow = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG, loader: { load: async () => interpreter },
    resolveProductFactsCatalog: () => visible,
    resolveCommercialRequest: (text, catalog, supplied = {}) => assistant.resolveCommercialRequest(text, catalog, { retailer: supplied.retailer ?? "Магнит" }),
    requestAiProposal: async () => { calls.push("model"); return { kind: "unavailable" }; }, ...options });
  const say = text => { flow.edit(); return flow.run(text); };
  return { basket, flow, say, calls, setVisible: value => { visible = value; } };
}

test("ordinary kefir request uses selected catalog cards, never a generic seed, Core fetch or model", async () => {
  const { say, basket, calls } = session();
  const state = await say("Я хочу кефир");
  assert.equal(state.presentation.selectionCards.length, 2);
  assert.equal(state.presentation.selectionCards[0].name, card.name);
  assert.equal(state.presentation.selectionCards[0].unit, "930 г");
  assert.equal(state.presentation.selectionCards[0].sourceUrl, card.sourceUrl);
  assert.deepEqual(calls, [{ id: "magnit", query: "Кефир" }]);
  assert.deepEqual(basket.getSnapshot(), []);
});

test("complete greetings and attention calls precede selected-store product search and preserve the confirmed basket", async () => {
  for (const text of ["Хай", "hi", "Мойра, привет!", "Мартен?", "Слушай", "Смотри!", "Эй", "Мойра, слушай"]) {
    const { say, basket, calls, flow } = session({ preferenceStorage: null,
      resolveRetailSelectionScope: () => ({ ...context, retailerId: "magnit" }) });
    for (const id of ["milk-25-900", "eggs-c1-10", "bread-wheat-400", "apples-1kg", "rice-900", "cheese-semi-hard-200", "milk-25-900"]) {
      basket.add(SHOP_CATALOG.find(product => product.id === id));
    }
    const before = basket.getSnapshot();
    const preferences = structuredClone(flow.getConversation());
    assert.equal(before.length, 6);
    assert.equal(before.reduce((sum, row) => sum + row.quantity, 0), 7);
    const result = await say(text);
    assert.equal(result.result.triggerReason, "smalltalk", text);
    assert.ok(["greeting", "attention"].includes(result.result.assistantReply?.dialogueKind), text);
    assert.equal(result.presentation.selectionCards, undefined, text);
    assert.equal(result.result.draftProposal, undefined, text);
    assert.deepEqual(calls, [], text);
    assert.deepEqual(flow.getConversation(), { ...preferences, revision: preferences.revision + 1 }, text);
    flow.confirm("confirm_all");
    assert.deepEqual(basket.getSnapshot(), before, text);
  }
});

test("selected-store greetings expire one-turn needs and hypotheses while preserving explicit preferences", async () => {
  const { say, basket, calls, flow } = session({ preferenceStorage: null,
    resolveRetailSelectionScope: () => ({ ...context, retailerId: "magnit" }) });
  basket.add(SHOP_CATALOG.find(product => product.id === "apples-1kg"));
  const before = basket.getSnapshot();
  await say("1300 ₽; не люблю готовить; хочу конкретные марки в этом ответе; вообще не ем яйца; случайный набор");
  const preferences = structuredClone(flow.getConversation());
  assert.equal(preferences.facts.brandStyle.scope, "turn");
  assert.equal(preferences.hypotheses.length, 1);
  for (const [index, text] of ["Хай", "Слушай", "hi", "Эй"].entries()) {
    const result = await say(text);
    const memory = flow.getConversation();
    assert.ok(["greeting", "attention"].includes(result.result.assistantReply?.dialogueKind), text);
    assert.equal(memory.revision, preferences.revision + index + 1, text);
    assert.equal(memory.facts.brandStyle, undefined, text);
    assert.deepEqual(memory.facts.budgetMinor, preferences.facts.budgetMinor, text);
    assert.deepEqual(memory.facts.cookingEffort, preferences.facts.cookingEffort, text);
    assert.deepEqual(memory.rejected, preferences.rejected, text);
    assert.equal(memory.hypotheses.length, index === 3 ? 0 : 1, text);
    assert.deepEqual(basket.getSnapshot(), before, text);
  }
  assert.deepEqual(calls, []);
  flow.confirm("confirm_all");
  assert.deepEqual(basket.getSnapshot(), before);
});

test("tea requests with or without a greeting still search the selected store", async () => {
  for (const text of ["Чай", "Хай чай", "Хай, хочу чай", "Мойра, привет, хочу чай", "Слушай, хочу чай", "Смотри, хочу чай"]) {
    const { say, basket, calls } = session({ preferenceStorage: null,
      resolveRetailSelectionScope: () => ({ ...context, retailerId: "magnit" }) });
    const result = await say(text);
    assert.equal(result.result.assistantReply, undefined, text);
    assert.deepEqual(result.presentation.selectionCards, [], text);
    assert.equal(calls.length, 1, text);
    assert.equal(calls[0].id, "magnit", text);
    assert.match(calls[0].query.toLocaleLowerCase("ru-RU"), /^чай(?:\s|$)/u, text);
    assert.deepEqual(basket.getSnapshot(), [], text);
  }
});

test("greetings and attention calls retire hidden source choices before numbers or confirmation", async () => {
  for (const text of ["Хай", "Слушай"]) {
    const { say, basket } = session({ preferenceStorage: null });
    basket.add(SHOP_CATALOG.find(product => product.id === "apples-1kg"));
    const before = basket.getSnapshot();
    await say("хочу кефир");
    assert.match((await say("2")).presentation.message, /количество упаковок или номер/u);
    assert.match((await say("выбираю вариант 1")).presentation.message, /Добавить/u);
    await say(text);
    await say("1");
    await say("го");
    assert.deepEqual(basket.getSnapshot(), before, text);
    const fresh = await say("хочу кефир");
    assert.equal(fresh.presentation.selectionCards.length, 2, text);
    assert.deepEqual(basket.getSnapshot(), before, text);
  }
});

test("a non-selection turn exposes hybrid loading synchronously in both seed and retail modes", async () => {
  for (const seed of [true, false]) {
    let release;
    const loaded = new Promise(resolve => { release = resolve; });
    const { say, flow, calls } = session({ loader: { load: () => loaded },
      ...(seed ? { resolveProductFactsCatalog: () => SHOP_CATALOG } : {}) });
    const request = say("Привет");
    try { assert.equal(flow.getState().status, "loading"); }
    finally { release(interpreter); }
    const result = await request;
    assert.match(result.presentation.headline, /Привет/u);
    assert.deepEqual(calls, []);
  }
});

test("a local advice followup is ready before the caller snapshots its presentation", async () => {
  const { say, flow } = session({ resolveProductFactsCatalog: () => SHOP_CATALOG });
  await say("Как выбрать сыр?");
  const request = say("другой");
  assert.equal(flow.getState().status, "clarification");
  assert.ok(flow.getState().presentation.referenceKey);
  assert.match(flow.getState().presentation.message, /другой формат/u);
  await request;
});

test("an old retailer wish cannot override the current catalog callback during selection", async () => {
  const contexts = [];
  const { say, flow } = session({ resolveCommercialRequest: async (text, _catalog, context) => {
    if (text.startsWith("хочу")) contexts.push(context);
    return receipt([card]);
  } });
  await say("магазин METRO");
  assert.equal(flow.getConversation().facts.retailer.value, "metro");
  const selected = await say("Я хочу кефир");
  assert.equal(selected.presentation.selectionCards[0].retailerId, "magnit");
  assert.deepEqual(contexts, [{ retailer: null, selectionDiscovery: true }]);
  assert.equal(flow.getConversation().facts.retailer.value, "metro");
});

test("quantity and nominal-price followups keep the source cards and do not mutate a basket", async () => {
  const { say, basket, calls } = session();
  await say("Я хочу кефир");
  const quantity = await say("две бутылки");
  assert.equal(quantity.presentation.selectionQuantity, 2);
  const sorted = await say("тот подешевле");
  assert.equal(sorted.presentation.selectionCards[0].id, other.id);
  assert.match(sorted.presentation.message, /объём и условия/u);
  assert.deepEqual(basket.getSnapshot(), []);
  assert.equal(calls.length, 1);
});

for (const needsMode of [false, true]) test(`reviewed choice confirms the exact branded pack once and quantity corrections do not duplicate it (needs: ${needsMode})`, async () => {
  const { say, basket } = session({ needsStore: needsMode ? createShoppingNeedsStore({ storage: null }) : undefined });
  await say("Я хочу два кефира");
  const choice = await say("выбираю вариант 1");
  assert.equal(choice.result.triggerReason, "conversation_draft");
  assert.equal(choice.presentation.items[0].unit, "930 г");
  assert.match(choice.presentation.items[0].name, /Простоквашино/u);
  assert.deepEqual(basket.getSnapshot(), []);
  await say("го"); await say("го");
  assert.equal(basket.getSnapshot()[0].quantity, 2);
  assert.equal(basket.getSnapshot()[0].unit, "930 г");
  await say("нет, лучше три");
  assert.equal(basket.getSnapshot()[0].quantity, 2);
  await say("го");
  assert.equal(basket.getSnapshot()[0].quantity, 3);
  assert.equal(basket.getSnapshot().length, 1);
});

test("an unrelated refusal preserves the confirmed source choice and its exact pack", async () => {
  const { say, basket } = session();
  await say("Я хочу два кефира"); await say("выбираю вариант 1"); await say("го");
  const confirmed = basket.getSnapshot();
  await say("хлеб не надо"); await say("го");
  assert.deepEqual(basket.getSnapshot(), confirmed);
});

test("separate source requests accumulate ownership while a correction replaces only its latest contribution", async () => {
  const { say, basket } = session();
  await say("Я хочу два кефира"); await say("выбираю вариант 1"); await say("го");
  await say("Я хочу кефир"); await say("выбираю вариант 1"); await say("го");
  await say("нет, лучше две"); await say("го");
  assert.equal(basket.getSnapshot()[0].quantity, 4);
  await say("хлеб не надо"); await say("го");
  assert.equal(basket.getSnapshot()[0]?.quantity, 4);
  assert.equal(basket.getSnapshot()[0]?.unit, "930 г");
});

test("successive reviewed products remain together after a conversation refinement", async () => {
  const milk = { ...card, id: "retail:magnit:magnit-777312:1899800733", sourceProductId: "1899800733",
    name: "Молоко Простоквашино пастеризованное 2.5% 930мл", unit: "930 мл",
    productUrl: "https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=777312&shopType=1" };
  const { say, basket } = session({ cards: [card, milk] });
  await say("Я хочу два кефира"); await say("выбираю вариант 1"); await say("го");
  await say("хочу молоко"); await say("выбираю вариант 1"); await say("го");
  const confirmed = basket.getSnapshot();
  assert.equal(confirmed.length, 2);
  await say("хлеб не надо"); await say("го");
  assert.deepEqual(basket.getSnapshot(), confirmed);
});

test("an unreviewed SKU cannot become the canonical kefir and its visible choice keeps the same identity", async () => {
  const { say, basket } = session();
  await say("хочу кефир");
  const selected = await say("второй");
  assert.equal(selected.presentation.selectionCards[0].id, other.id);
  await say("выбираю вариант 1"); await say("го");
  assert.deepEqual(basket.getSnapshot(), []);
});

test("existing generic pack cannot be silently relabelled or merged with a reviewed source pack", async () => {
  const { say, basket } = session();
  basket.add(SHOP_CATALOG.find(product => product.id === "kefir-1l"));
  const before = basket.getSnapshot();
  await say("хочу кефир");
  const selected = await say("выбираю вариант 1");
  assert.match(selected.presentation.message, /другая упаковка/u);
  await say("го"); assert.deepEqual(basket.getSnapshot(), before);
});

test("missing catalog and invalid dates cannot add a placeholder during provider outage", async () => {
  for (const cards of [[], [{ ...card, observedAt: "unknown" }]]) {
    const { say, basket, calls } = session({ cards });
    const state = await say("Я хочу кефир");
    assert.equal(state.presentation.selectionCards.length, 0);
    assert.match(state.presentation.message, /не означает, что товара нет/u);
    await say("го"); assert.deepEqual(basket.getSnapshot(), []);
    assert.ok(!calls.includes("model"));
  }
});

test("brand, fat and lactose requirements cannot be replaced with a different source card", async () => {
  const { say, basket, calls } = session();
  for (const text of ["Я хочу безлактозный кефир", "Мне нужен кефир 1%", "хочу кефир НезнакомаяМарка"]) {
    const state = await say(text);
    assert.deepEqual(state.presentation.selectionCards, []);
    assert.deepEqual(basket.getSnapshot(), []);
  }
  assert.deepEqual(calls.map(call => call.query), ["безлактозный кефир", "кефир 1%", "кефир НезнакомаяМарка"]);
});

test("a prior unresolved food restriction blocks retail selection until explicitly cleared", async () => {
  const { say, flow, basket, calls } = session();
  await say("хочу молоко без лактозы");
  assert.ok(flow.getConversation().facts.unresolvedConstraints);
  const state = await say("Я хочу кефир");
  assert.match(state.presentation.message, /нераспознанное условие/u);
  assert.equal(state.presentation.selectionCards, undefined);
  await say("выбираю вариант 1"); await say("го");
  assert.deepEqual(basket.getSnapshot(), []);
  assert.deepEqual(calls, []);
  await say("забудь нераспознанное условие");
  const next = await say("Я хочу кефир");
  assert.equal(next.presentation.selectionCards.length, 2);
});

test("a changed or missing catalog cannot confirm an already reviewed source choice", async () => {
  for (const visible of [[], SHOP_CATALOG, [{ ...card, catalogDisplayOnly: true, storeName: "Другой адрес Магнита" }]]) {
    const { say, basket, setVisible } = session();
    await say("Я хочу кефир");
    await say("выбираю вариант 1");
    setVisible(visible);
    await say("го");
    assert.deepEqual(basket.getSnapshot(), []);
  }
});

test("leaving a source choice for a greeting cannot restore its hidden confirmation", async () => {
  const { say, basket } = session();
  await say("Я хочу кефир");
  await say("выбираю вариант 1");
  await say("Привет");
  await say("го");
  assert.deepEqual(basket.getSnapshot(), []);
});

test("admission rejects wrong retailer, ambiguous IDs, wrong Magnit address and unsafe links", () => {
  for (const row of [{ ...card, retailerId: "metro" }, { ...card, productUrl: card.productUrl.replace("777312", "771878") },
    { ...card, productUrl: "javascript:alert(1)", sourceUrl: "https://evil.example/p" }, { ...card, sourceUrl: "https://user:pass@magnit.ru/product/1" }]) {
    assert.deepEqual(admittedRetailSelectionCards(receipt([row]), "кефир"), []);
  }
  assert.deepEqual(admittedRetailSelectionCards(receipt([card, { ...card, priceMinor: 1 }]), "кефир"), []);
  const normalized = admittedRetailSelectionCards(receipt([{ ...card, imageUrl: "https://evil.example/photo.jpg" }]), "кефир");
  assert.equal(normalized[0].imageUrl, null);
  assert.deepEqual(admittedRetailSelectionCards(receipt([{ ...card, name: "Кефир 2.5% 1л", unit: "1 л" }]), "кефир 1 %"), []);
});

test("clear or changed store invalidates old numbered choices", async () => {
  const { say, flow, basket } = session();
  await say("хочу кефир"); flow.invalidate();
  await say("выбираю вариант 1");
  assert.deepEqual(basket.getSnapshot(), []);
  await say("хочу кефир"); flow.setRetailer("METRO");
  await say("выбираю вариант 1");
  assert.deepEqual(basket.getSnapshot(), []);
});

test("a late catalog response cannot restore choices after a store edit", async () => {
  let finish;
  const { flow, basket } = session({ resolveCommercialRequest: () => new Promise(resolve => { finish = resolve; }) });
  const old = flow.run("хочу кефир"); await new Promise(resolve => setImmediate(resolve));
  flow.setRetailer("METRO"); finish(receipt([card])); await old;
  assert.equal(flow.getState().status, "idle");
  assert.deepEqual(basket.getSnapshot(), []);
});

test("starting another product lookup clears prior choices before its response arrives", async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const { say, basket } = session({ resolveCommercialRequest: text =>
    text.includes("молоко") ? response : Promise.resolve(receipt([card])) });
  await say("хочу кефир");
  const request = say("хочу молоко");
  await say("выбираю вариант 1"); await say("го");
  assert.deepEqual(basket.getSnapshot(), []);
  release(receipt([])); await request;
  assert.deepEqual(basket.getSnapshot(), []);
});

test("a changed current catalog also blocks a response when the caller missed explicit invalidation", async () => {
  let finish;
  const { flow, basket, setVisible } = session({ resolveCommercialRequest: () => new Promise(resolve => { finish = resolve; }) });
  const old = flow.run("хочу кефир"); await new Promise(resolve => setImmediate(resolve));
  setVisible([{ ...card, catalogDisplayOnly: true, storeName: "Другой адрес" }]); finish(receipt([card])); await old;
  assert.match(flow.getState().presentation.message, /нового выбранного магазина/u);
  assert.deepEqual(basket.getSnapshot(), []);
});

test("a bare number asks packages-versus-choice and unsupported quantities remain bounded", async () => {
  const { say, basket } = session();
  await say("хочу кефир");
  assert.match((await say("2")).presentation.message, /количество упаковок или номер/u);
  assert.match((await say("100 бутылки")).presentation.message, /от 1 до 99/u);
  assert.deepEqual(basket.getSnapshot(), []);
});
