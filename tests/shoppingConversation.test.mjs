import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { SHOP_CATALOG } from "../src/data/shopCatalog.mjs";
import { createShoppingConversation, extractShoppingDelta, updateShoppingConversation, isShoppingProductRejected, projectMartenConversation, CONVERSATION_LIMITS } from "../src/intelligence/shoppingConversation.mjs";
import { planConversationBasket, presentConversationBasket, conversationPriceSummary } from "../src/intelligence/conversationBasket.mjs";
import { createShoppingConversationFlow } from "../src/runtime/shoppingConversationFlow.mjs";
import { createBasketStore } from "../src/state/basketStore.mjs";
import { buildSnapshotPriceHints } from "../src/runtime/priceHints.mjs";
import * as interpreter from "../src/runtime/hybridBasketInterpreter.mjs";
import { validateBasketProposal } from "../src/core/ai-basket-proposal.mjs";

const update = (state, text) => updateShoppingConversation(state, extractShoppingDelta(text)).state;
const catalog = SHOP_CATALOG;
const product = id => catalog.find(row => row.id === id);
function session(extra = {}) {
  const basket = createBasketStore({ storage: null });
  let loads = 0;
  const flow = createShoppingConversationFlow({ basket, localCatalog: catalog, priceHints: buildSnapshotPriceHints(), loader: { load: async () => { loads++; return interpreter; } }, ...extra });
  return { basket, flow, loads: () => loads };
}
const ids = flow => flow.getState().presentation.items.map(row => row.productId);

test("postposed food refusal is a preference, not a product wish or paid fallback", async () => {
  for (const phrase of ["Морковь не добавляй", "Не добавляй морковь", "Морковь не клади"]) {
    const delta = extractShoppingDelta(phrase);
    assert.deepEqual(delta.reject, ["carrots"]);
    assert.deepEqual(delta.want, []);
    assert.equal(delta.recognized, true);
  }
  const mixed = extractShoppingDelta("Морковь не добавляй, яблоки возьми");
  assert.deepEqual(mixed.reject, ["carrots"]);
  assert.deepEqual(mixed.want, ["apples"]);
  assert.deepEqual(extractShoppingDelta("Хочу добавить морковь").reject, []);
  let paidCalls = 0;
  let catalogSearches = 0;
  const { flow, basket } = session({
    requestShoppingAdvice: async () => { paidCalls++; return null; },
    resolveRetailSelectionScope: () => ({ retailerId: "globus", storeId: "globus-store-5011" }),
    resolveCommercialRequest: async () => { catalogSearches++; return null; }
  });
  await flow.run("Морковь не добавляй");
  assert.equal(flow.getConversation().rejected.carrots.value, true);
  assert.equal(paidCalls, 0);
  assert.equal(catalogSearches, 0);
  assert.deepEqual(basket.getSnapshot(), []);
  await flow.run("Морковь теперь можно");
  assert.equal(flow.getConversation().rejected.carrots, undefined);
});

test("address-picker food refusal is saved without a draft, retailer lookup or paid AI", async () => {
  const saved = new Map();
  const preferenceStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key)
  };
  let paidCalls = 0, catalogSearches = 0;
  const { flow, basket, loads } = session({ preferenceStorage,
    requestShoppingAdvice: async () => { paidCalls++; return null; },
    resolveCommercialRequest: async () => { catalogSearches++; return null; }
  });
  assert.equal(flow.rememberLocationConstraint("Морковь не добавляй."), true);
  assert.equal(flow.getConversation().rejected.carrots.value, true);
  assert.equal(flow.getState().status, "idle");
  assert.deepEqual(basket.getSnapshot(), []);
  assert.equal(paidCalls, 0);
  assert.equal(catalogSearches, 0);
  assert.equal(loads(), 0);
  const record = JSON.stringify([...saved.values()]);
  assert.match(record, /carrots/u);
  assert.doesNotMatch(record, /Пушкино/u);
  const revision = flow.getConversation().revision;
  assert.equal(flow.rememberLocationConstraint("глютен исключи"), false);
  assert.equal(flow.getConversation().revision, revision);
  assert.equal(flow.rememberLocationConstraint("Морковь теперь можно"), false);
  await flow.run("Морковь теперь можно");
  assert.equal(flow.getConversation().rejected.carrots, undefined);
});

test("golden shopping dialogue accumulates intent, refusals, fruit and persistent brand format with zero AI", async () => {
  const { flow, basket, loads } = session();
  await flow.run("Корзину на 1300 ₽ в Чижике, Пушкино");
  assert.equal(basket.getSnapshot().length, 0);
  await flow.run("вместо курицы хочу дешёвый куриный фарш, яйца, рис, макароны, овощи, молоко и кефир не хочу; готовить особо не люблю");
  await flow.run("хочу ещё фрукты");
  const before = ids(flow);
  await flow.run("наггетсы и чебуреки не хочу");
  await flow.run("хочу видеть конкретные марки");
  await flow.run("не знаю, что мне не нравится");
  const memory = flow.getConversation();
  assert.equal(memory.facts.budgetMinor.value, 130000);
  assert.equal(memory.facts.cookingEffort.value, "minimal");
  assert.equal(memory.facts.cookingEffort.origin, "explicit");
  assert.equal(memory.facts.brandStyle.value, "specific");
  assert.equal(memory.wishes.fruit.value, true);
  assert.equal(memory.wishes.chicken_mince.value, true);
  for (const key of ["chicken", "eggs", "rice", "pasta", "vegetables", "milk", "kefir", "nuggets", "chebureki"]) assert.equal(memory.rejected[key].value, true, key);
  assert.notDeepEqual(ids(flow), before, "dissatisfaction must change structure, not just copy");
  assert.ok(ids(flow).includes("apples-1kg") || ids(flow).includes("bananas-1kg"));
  assert.ok(flow.getState().presentation.items.every(row => row.displayLabel.includes("→")));
  assert.match(flow.getState().presentation.message, /Похоже|Предполож/u);
  assert.match(flow.getState().presentation.message, /Я бы/u);
  assert.match(flow.getState().presentation.message, /куриный фарш/u);
  assert.ok(!ids(flow).includes("chicken-fillet-600"));
  assert.ok(!ids(flow).includes("ground-beef-400"));
  assert.equal(loads(), 0);
  assert.ok(new TextEncoder().encode(JSON.stringify(memory)).length <= CONVERSATION_LIMITS.bytes);
  assert.equal(Object.hasOwn(memory, "text"), false);
  assert.equal(basket.getSnapshot().length, 0);
});

test("inference is tentative, never an exclusion, and explicit correction wins", () => {
  let memory = update(createShoppingConversation(), "яйца, рис, макароны не хочу");
  assert.equal(memory.facts.cookingEffort.origin, "inferred");
  assert.equal(memory.facts.cookingEffort.confidence, "medium");
  assert.equal(projectMartenConversation(memory).cookingEffort, undefined);
  memory = update(memory, "готовить теперь можно");
  assert.equal(memory.facts.cookingEffort.value, "normal");
  assert.equal(memory.facts.cookingEffort.origin, "explicit");
  assert.equal(memory.rejected.eggs.value, true);
  memory = update(memory, "яйца и рис теперь можно");
  assert.equal(memory.rejected.eggs, undefined);
  assert.equal(memory.rejected.rice, undefined);
});

test("unconfirmed hypotheses expire without refreshing their evidence or dropping explicit refusals", () => {
  let state = update(createShoppingConversation(), "яйца, рис, макароны, наггетсы и чебуреки не хочу");
  assert.equal(state.facts.cookingEffort.origin, "inferred");
  const evidence = state.facts.cookingEffort.evidenceTurn;
  for (let i = 0; i < 3; i++) state = update(state, "хочу фрукты");
  assert.equal(state.facts.cookingEffort.evidenceTurn, evidence);
  state = update(state, "хочу фрукты");
  assert.equal(state.facts.cookingEffort, undefined);
  assert.deepEqual(state.hypotheses, []);
  assert.equal(state.rejected.eggs.value, true);
  assert.equal(state.rejected.nuggets.value, true);
  state = update(state, "рис снова не хочу");
  assert.equal(state.facts.cookingEffort.origin, "inferred");
  state = update(state, "забудь про готовку");
  state = update(state, "хочу фрукты");
  assert.equal(state.facts.cookingEffort, undefined);
  state = update(state, "не знаю, что мне не нравится");
  assert.equal(state.hypotheses[0].value, "structure_mismatch");
  state = update(state, "наггетсы теперь можно");
  assert.deepEqual(state.hypotheses, []);
});

test("category refusal supports a precise exception without dropping other refusals", () => {
  const state = update(createShoppingConversation(), "овощи не хочу, но томаты можно");
  assert.equal(isShoppingProductRejected(product("potatoes-1kg"), state), true);
  assert.equal(isShoppingProductRejected(product("tomatoes-600"), state), false);
  assert.equal(isShoppingProductRejected(product("carrots-1kg"), state), true);
  const revised = update(state, "томаты не хочу");
  assert.equal(isShoppingProductRejected(product("tomatoes-600"), revised), true);
});

test("chicken refusal includes mince unless it is an explicit exception", () => {
  const mince = { id: "fixture-chicken-mince", name: "Фарш куриный", unit: "400 г" };
  let state = update(createShoppingConversation(), "курицу не хочу");
  assert.equal(isShoppingProductRejected(mince, state), true);
  state = update(state, "вместо курицы хочу куриный фарш");
  assert.equal(isShoppingProductRejected(mince, state), false);
  assert.equal(isShoppingProductRejected(product("chicken-fillet-600"), state), true);
});

test("price questions preserve the commercial boundary without generating a basket", async () => {
  const { flow, basket } = session();
  await flow.run("где дешевле молоко");
  assert.equal(flow.getState().result.triggerReason, "commercial_constraint");
  assert.equal(basket.getSnapshot().length, 0);
  assert.equal(flow.getState().presentation.items.length, 0);
  await flow.run("1300 ₽; молоко не хочу");
  const memory = flow.getConversation();
  await flow.run("цена молока в Магните");
  assert.equal(basket.getSnapshot().length, 0);
  assert.equal(flow.getConversation().facts.budgetMinor.value, memory.facts.budgetMinor.value);
  assert.equal(flow.getConversation().rejected.milk.value, true);
  await flow.run("добавь самое дешёвое молоко");
  assert.equal(flow.getState().result.triggerReason, "commercial_constraint");
  flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().length, 0);
});

test("mixed comma clauses retain the positive wish and the separate refusal", () => {
  const memory = update(createShoppingConversation(), "яйца не хочу, рис хочу");
  assert.equal(memory.rejected.eggs.value, true);
  assert.equal(memory.rejected.rice, undefined);
  assert.equal(memory.wishes.rice.value, true);
  const list = update(createShoppingConversation(), "яйца, рис, макароны не хочу");
  for (const key of ["eggs", "rice", "pasta"]) assert.equal(list.rejected[key].value, true);
  assert.equal(update(createShoppingConversation(), "без яиц").rejected.eggs.value, true);
});

test("ordinary dislike wording is an explicit refusal, not a product request", async () => {
  const { flow, basket } = session();
  for (const phrase of ["яйца не нравятся", "рис не подходит", "макароны надоели"]) await flow.run(phrase);
  for (const key of ["eggs", "rice", "pasta"]) assert.equal(flow.getConversation().rejected[key].origin, "explicit");
  assert.equal(basket.getSnapshot().length, 0);
});

test("a subsequent price/store query cannot confirm the superseded basket draft", async () => {
  const { flow, basket } = session();
  await flow.run("1300 ₽");
  await flow.run("где дешевле молоко");
  flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().length, 0);
  await flow.run("молоко в Чижике");
  assert.notEqual(flow.getState().result.triggerReason, "conversation_draft");
  flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().length, 0);
  assert.equal(flow.getConversation().facts.retailer.value, "чижике");
});

test("even a mistaken commercial parser proposal cannot mutate the basket", async () => {
  const proposal = { items: [{ productId: "milk-25-900", quantity: 1 }] };
  const { flow, basket } = session({ loader: { load: async () => ({ interpretHybridBasketText: async () => ({ kind: "proposal", source: "local", proposal, validation: validateBasketProposal(proposal, { catalog }) }) }) } });
  await flow.run("цена молока");
  assert.equal(basket.getSnapshot().length, 0);
  flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().length, 0);
  assert.equal(flow.getState().result.triggerReason, "smalltalk");
});

test("recommendation copy does not repeat expressly rejected foods", async () => {
  const { flow } = session();
  await flow.run("1300 ₽; не люблю готовить; хлеб и сыр не хочу");
  const recommendation = flow.getState().presentation.message.match(/Я бы[^.]+/u)[0];
  assert.doesNotMatch(recommendation, /Хлеб|Сыр|хлеб|сыр/u);
});

test("one-reply brand requirement expires on the next submitted turn", async () => {
  const { flow } = session();
  await flow.run("1300 ₽; хочу конкретные марки в этом ответе");
  assert.equal(flow.getConversation().facts.brandStyle.scope, "turn");
  await flow.run("привет");
  assert.equal(flow.getConversation().facts.brandStyle, undefined);
});

test("new goal clears budget and temporary refusals, preserving conversation preferences", () => {
  let memory = update(createShoppingConversation(), "1300 ₽; не люблю готовить; хочу конкретные марки; молоко не хочу");
  memory = update(memory, "новая корзина для гостей на 2000 ₽");
  assert.equal(memory.facts.budgetMinor.value, 200000);
  assert.equal(memory.rejected.milk, undefined);
  assert.equal(memory.facts.cookingEffort.value, "minimal");
  assert.equal(memory.facts.brandStyle.value, "specific");
});

test("today's cooking preference expires with the goal; permanent rejection survives", () => {
  let memory = update(createShoppingConversation(), "сегодня не люблю готовить; вообще не ем яйца");
  memory = update(memory, "новая задача");
  assert.equal(memory.facts.cookingEffort, undefined);
  assert.equal(memory.rejected.eggs.value, true);
});

test("temporary and persistent refusals in one message keep separate scopes", () => {
  let memory = update(createShoppingConversation(), "сегодня молоко не хочу; вообще не ем яйца");
  memory = update(memory, "новая корзина");
  assert.equal(memory.rejected.milk, undefined);
  assert.equal(memory.rejected.eggs.value, true);
});

test("explicitly cancelled budget or retailer does not survive into a later plan", () => {
  let memory = update(createShoppingConversation(), "1300 ₽ в Чижике");
  memory = update(memory, "бюджет больше не важен; магазин любой");
  assert.equal(memory.facts.budgetMinor, undefined);
  assert.equal(memory.facts.retailer, undefined);
});

test("inference is revised when its evidence is withdrawn", () => {
  let state = update(createShoppingConversation(), "яйца, рис, макароны не хочу");
  state = update(state, "рис теперь можно");
  assert.equal(state.facts.cookingEffort, undefined);
});

test("negated preferences do not become the opposite preference", () => {
  const state = update(createShoppingConversation(), "не хочу без готовки; не хочу конкретные марки");
  assert.equal(state.facts.cookingEffort.value, "normal");
  assert.equal(state.facts.brandStyle.value, "any");
});

test("state overflow preserves all previous constraints atomically", () => {
  const state = createShoppingConversation();
  const delta = { ...extractShoppingDelta(""), reject: Array.from({ length: 33 }, (_, i) => `target_${i}`) };
  const result = updateShoppingConversation(state, delta);
  assert.equal(result.overflow, true);
  assert.equal(result.state, state);
});

test("unknown refusal blocks later replanning until explicitly cancelled", async () => {
  const { flow, basket } = session();
  await flow.run("1300 ₽");
  await flow.run("не хочу сурими");
  await flow.run("хочу фрукты");
  assert.equal(flow.getState().result.triggerReason, "smalltalk");
  assert.ok(flow.getConversation().facts.unresolvedConstraints);
  flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().length, 0);
  await flow.run("забудь нераспознанное условие");
  assert.equal(flow.getState().result.triggerReason, "conversation_draft");
  assert.equal(flow.getConversation().wishes.fruit.value, true);
});

test("confirmation replaces assistant contribution once and preserves manual quantities", async () => {
  const { flow, basket } = session();
  basket.add(product("water-15"));
  basket.add(product("bread-wheat-400"));
  await flow.run("Корзина на 1300 ₽");
  flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().find(row => row.id === "bread-wheat-400").quantity, 2);
  await flow.run("хочу ещё фрукты");
  flow.confirm("confirm_all");
  const snapshot = basket.getSnapshot();
  flow.confirm("confirm_all");
  await flow.run("го");
  assert.deepEqual(basket.getSnapshot(), snapshot);
  assert.equal(snapshot.find(row => row.id === "bread-wheat-400").quantity, 2);
  assert.equal(snapshot.find(row => row.id === "water-15").quantity, 1);
});

test("manual edit invalidates the reviewed basket lease without partial writes", async () => {
  const { flow, basket } = session();
  await flow.run("1300 ₽");
  basket.add(product("water-15"));
  const snapshot = basket.getSnapshot();
  flow.confirm("confirm_all");
  assert.deepEqual(basket.getSnapshot(), snapshot);
  assert.match(flow.getState().presentation.headline, /измениться/u);
  await flow.run("перестрой");
  flow.confirm("confirm_all");
  assert.ok(basket.getSnapshot().some(row => row.id === "water-15"));
});

test("rejection of an existing manual item is a visible removal, never an immediate mutation", async () => {
  const { flow, basket } = session();
  basket.add(product("milk-25-900"));
  await flow.run("молоко не хочу");
  assert.equal(basket.getSnapshot().length, 1);
  assert.match(flow.getState().presentation.message, /Молоко.*1 → 0/u);
  flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().length, 0);
});

test("undo restores the previous preferences and basket only after review", async () => {
  const { flow, basket } = session();
  await flow.run("1300 ₽");
  flow.confirm("confirm_all");
  const original = basket.getSnapshot();
  await flow.run("молоко не хочу");
  flow.confirm("confirm_all");
  assert.ok(!basket.getSnapshot().some(row => row.id === "milk-25-900"));
  await flow.run("отмени последнее");
  assert.ok(!basket.getSnapshot().some(row => row.id === "milk-25-900"));
  flow.confirm("confirm_all");
  assert.deepEqual(basket.getSnapshot(), original);
  assert.equal(flow.getConversation().rejected.milk, undefined);
});

test("reset forgets preferences but keeps confirmed basket; recreated session starts empty", async () => {
  const { flow, basket } = session();
  await flow.run("1300 ₽; не люблю готовить"); flow.confirm("confirm_all");
  const prior = basket.getSnapshot();
  await flow.run("сбрось предпочтения");
  assert.deepEqual(basket.getSnapshot(), prior);
  assert.deepEqual(flow.getMartenPreferences(), {});
  assert.equal(Object.keys(flow.getConversation().facts).length, 0);
  const fresh = createShoppingConversationFlow({ basket, localCatalog: catalog, loader: { load: async () => interpreter } });
  assert.deepEqual(fresh.getConversation().facts, {});
  assert.deepEqual(basket.getSnapshot(), prior);
});

test("input edits invalidate pending drafts without erasing submitted preferences", async () => {
  const { flow, basket } = session();
  await flow.run("1300 ₽; молоко не хочу");
  flow.invalidate(); flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().length, 0);
  assert.equal(flow.getConversation().rejected.milk.value, true);
  await flow.run("хочу фрукты");
  assert.ok(!ids(flow).includes("milk-25-900"));
});

test("latest intent cancels a delayed older parser result before mutation", async () => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const { flow, basket } = session({ loader: { load: () => delayed } });
  const old = flow.run("два молока");
  await flow.run("молоко не хочу");
  release(interpreter);
  await old;
  assert.equal(basket.getSnapshot().length, 0);
  assert.equal(flow.getConversation().rejected.milk.value, true);
});

test("affirmative input during loading cannot commit an unseen draft", async () => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const { flow, basket } = session({ loader: { load: () => delayed } });
  const old = flow.run("два молока");
  await flow.run("го"); release(interpreter); await old;
  assert.equal(basket.getSnapshot().length, 0);
});

test("exact product quantities and identity qualifiers keep the existing safe parser", async () => {
  const { flow, basket } = session();
  await flow.run("хочу два молока и хлеб");
  assert.equal(basket.getSnapshot().find(row => row.id === "milk-25-900").quantity, 2);
  await flow.run("1300 ₽");
  const prior = basket.getSnapshot();
  await flow.run("хочу молоко без лактозы");
  assert.deepEqual(basket.getSnapshot(), prior);
  assert.equal(flow.getState().presentation?.items?.some(row => row.productId === "milk-25-900"), false);
});

test("concrete additions retain quantities in later preference revisions", async () => {
  const { flow, basket } = session();
  await flow.run("1300 ₽");
  await flow.run("хочу два молока");
  assert.equal(basket.getSnapshot().length, 0);
  flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().find(row => row.id === "milk-25-900").quantity, 2);
  await flow.run("хочу конкретные марки"); flow.confirm("confirm_all");
  assert.equal(basket.getSnapshot().find(row => row.id === "milk-25-900").quantity, 2);
});

test("a subsequent meal request respects cooking preference; exact cooking items get a warning", async () => {
  const { flow, basket } = session();
  await flow.run("1300 ₽; готовить особо не люблю");
  await flow.run("на завтрак");
  assert.ok(!ids(flow).includes("eggs-c1-10"));
  assert.ok(!ids(flow).includes("oat-flakes-400"));
  assert.match(flow.getState().presentation.message, /общий запрос не отменяет/u);
  assert.equal(basket.getSnapshot().length, 0);
  await flow.run("пельмени");
  assert.ok(ids(flow).includes("pelmeni-800"));
  assert.match(flow.getState().presentation.message, /Пельмени потребует готовки/u);
  assert.equal(flow.getConversation().facts.cookingEffort.value, "minimal");
});

test("unknown price is never zero and historical minima cannot prove a current budget fit", () => {
  const hints = new Map([["bread-wheat-400", { minMinor: 5000, observedDateLabel: "2020-01-01" }]]);
  const rows = [{ productId: "bread-wheat-400", quantity: 1 }, { productId: "apples-1kg", quantity: 1 }];
  const summary = conversationPriceSummary(rows, hints);
  assert.equal(summary.kind, "incomplete_historical");
  assert.equal(summary.unknownCount, 1);
  assert.equal(summary.knownSubtotalMinor, 5000);
  const memory = update(createShoppingConversation(), "1300 ₽; хочу конкретные марки");
  const view = presentConversationBasket(memory, { items: rows, unresolved: [], warnings: [] }, catalog, hints, rows, []);
  assert.match(view.message, /Полную сумму и попадание в бюджет подтвердить не могу/u);
  assert.match(view.items[1].displayLabel, /цена неизвестна/u);
  assert.match(view.items[0].displayLabel, /2020-01-01/u);
  assert.ok(view.items.every(row => row.displayLabel.includes("марка не подтверждена")));
});

test("unknown preparation effort is excluded from inferred minimal-cooking suggestions", () => {
  const state = update(createShoppingConversation(), "не люблю готовить");
  const unknownCatalog = [{ id: "bread-wheat-400-other", name: "Хлеб", unit: "400 г" }];
  assert.equal(planConversationBasket(state, unknownCatalog, new Map()).items.length, 0);
});

test("local update latency stays bounded without transcript growth", () => {
  let memory = createShoppingConversation();
  const delta = extractShoppingDelta("яйца, рис, макароны не хочу; хочу фрукты; 1300 ₽");
  for (let i = 0; i < 30; i++) memory = updateShoppingConversation(memory, delta).state;
  const samples = [];
  for (let i = 0; i < 100; i++) { const start = performance.now(); memory = updateShoppingConversation(memory, delta).state; samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  assert.ok(samples[94] < 10, `p95=${samples[94]}ms`);
  assert.ok(new TextEncoder().encode(JSON.stringify(memory)).length < 8192);
});

test("basket replacement rejects all invalid rows atomically and notifies only once", () => {
  const basket = createBasketStore({ storage: null });
  basket.add(product("bread-wheat-400"));
  let notifications = 0;
  basket.subscribe(() => notifications++);
  const base = basket.getSnapshot();
  assert.equal(basket.replaceReviewedBasket(base, [{ ...base[0], quantity: 0 }]).applied, false);
  assert.deepEqual(basket.getSnapshot(), base);
  assert.equal(notifications, 0);
  assert.equal(basket.replaceReviewedBasket(base, [{ ...base[0], quantity: 2 }]).applied, true);
  assert.equal(notifications, 1);
  assert.equal(basket.replaceReviewedBasket(base, []).applied, false);
  assert.equal(notifications, 1);
});
