import { createHybridBasketFlow } from "./hybridBasketFlow.mjs";
import { extractShoppingDelta, updateShoppingConversation, isShoppingProductRejected, projectMartenConversation, shoppingTargets, shoppingTargetLabel } from "../intelligence/shoppingConversation.mjs";
import { planConversationBasket, presentConversationBasket, knownPreparation } from "../intelligence/conversationBasket.mjs";
import { validateBasketProposal } from "../core/ai-basket-proposal.mjs";
import { parseLocalBasketText } from "../intelligence/localBasketParser.mjs";
import { shoppingAdviceTopic, shoppingAdviceInput, localShoppingExplanation, localShoppingComparisonExplanation, localShoppingAdvice, localShoppingReference } from "../intelligence/shoppingAdvice.mjs";
import { localShoppingDialogueReference } from "../intelligence/shoppingDialogueReference.mjs";
import { normalizeShoppingAdviceResponse, normalizeShoppingAdviceHistory } from "../intelligence/shoppingAdviceContract.mjs";
import { isShoppingProductFactsQuestion, localShoppingProductFacts } from "../intelligence/shoppingProductFacts.mjs";
import { createShoppingPreferenceStore } from "./shoppingPreferenceStorage.mjs";
import { preflightLocalBasketText } from "../intelligence/localBasketPreflight.mjs";
import { shoppingAdviceFocus, resolveShoppingAdviceFollowup, resolveShoppingBasketFollowup, resolveShoppingPriceFollowup, explicitShoppingItems } from "../intelligence/shoppingTurnContext.mjs";
import { currentRetailSelectionScope, retailSelectionRequest, admittedRetailSelectionCards, retailSelectionView, reviewedRetailSelection } from "../intelligence/retailProductSelection.mjs";
import { advanceMealNeed, mealNeedView, mealNeedProductView } from "../intelligence/shoppingMealNeed.mjs";
import { isRetailSortFollowup, normalizeRetailShoppingText, retailBudgetIntent } from "../intelligence/retailShoppingIntent.mjs";
import { extractShoppingNeedContext, shoppingNeedContextSummary } from "../intelligence/shoppingNeedContext.mjs";
import { currentComparisonExplanation } from "../intelligence/currentComparisonExplanation.mjs";
import { resolveLocalAssistantDialogue } from "../intelligence/localAssistantDialogue.mjs";

const copy = value => JSON.parse(JSON.stringify(value));
const rowsOf = validation => (validation?.basket ?? []).map(row => ({ productId: row.product.id, quantity: row.quantity }));
const messageState = (headline, message) => ({ status: "clarification", result: { kind: "clarification", triggerReason: "smalltalk" }, presentation: { headline, message, items: [], primaryAction: "Продолжить", mascotState: "curious" } });

export function createShoppingConversationFlow(options) {
  const { basket, localCatalog, priceHints } = options;
  if (!basket?.replaceReviewedBasket || !basket?.getSnapshot) throw new TypeError("conversation requires a reviewed basket store");
  const preferenceStore = createShoppingPreferenceStore({ storage: options.preferenceStorage });
  let memory = preferenceStore.read();
  function setMemory(next) { memory = next; preferenceStore.write(memory); }
  let checkpoint = null;
  let managed = [];
  let lastPlan = [];
  let referencePlan = [];
  let adviceFocus = null;
  // Advice exchanges belong only to this tab. Preference persistence receives
  // the typed shopping memory, never these messages or a model-made summary.
  let adviceHistory = [];
  let adviceHistoryBasket = null;
  let adviceExclusionPending = false;
  function rememberAdvice(text, message) {
    const pair = [{ role: "user", text }, { role: "assistant", text: message }]
      .map(row => ({ ...row, text: row.text.replace(/\s+/gu, " ").trim() }));
    let next = [...adviceHistory, ...pair].slice(-6);
    while (next.length && !normalizeShoppingAdviceHistory(next)) next = next.slice(2);
    adviceHistory = normalizeShoppingAdviceHistory(next) ?? [];
    adviceHistoryBasket = JSON.stringify(basket.getSnapshot());
  }
  let productSelection = null;
  let retailList = null;
  let mealNeed = null;
  let referenceAction = null;
  let pending = null;
  let suspendedDraft = null;
  let stagedByHybrid = null;
  let commercialTurn = false;
  let epoch = 0;
  let state = { status: "idle" };
  let inFlight = null;
  const byId = new Map(localCatalog.map(product => [product.id, product]));
  const retailScope = () => currentRetailSelectionScope(options.resolveProductFactsCatalog, localCatalog, options.resolveRetailSelectionScope);
  const activeMemory = () => Object.keys(memory.facts).length || Object.keys(memory.rejected).length || Object.keys(memory.wishes).length;
  const hybrid = createHybridBasketFlow({ ...options,
    resolveCommercialRequest: typeof options.resolveCommercialRequest === "function"
      ? (text, catalog) => options.resolveCommercialRequest(text, catalog, { retailer: memory.facts.retailer?.value ?? null })
      : undefined,
    applyValidatedBasket: rows => {
    if (activeMemory() || commercialTurn) { stagedByHybrid = rowsOf({ basket: rows }); return { rejectedRows: [] }; }
    const result = basket.mergeValidatedBasket(rows);
    const rejected = new Set(result.rejectedRows.map(row => row.productId));
    const owned = new Map(managed.map(row => [row.productId, row.quantity]));
    for (const row of rows) if (!rejected.has(row.product.id)) owned.set(row.product.id, (owned.get(row.product.id) ?? 0) + row.quantity);
    managed = [...owned].map(([productId, quantity]) => ({ productId, quantity }));
    return result;
  } });

  function invalidate() {
    epoch += 1; pending = null; suspendedDraft = null; inFlight = null; stagedByHybrid = null;
    referencePlan = []; adviceFocus = null; referenceAction = null;
    adviceHistory = []; adviceHistoryBasket = null; adviceExclusionPending = false;
    productSelection = null;
    retailList = null;
    mealNeed = null;
    hybrid.invalidate(); state = { status: "idle" };
    return state;
  }
  function edit() {
    const draft = pending ? { pending, state } : suspendedDraft;
    const references = referencePlan, focus = adviceFocus, action = referenceAction;
    const history = adviceHistory, historyBasket = adviceHistoryBasket;
    const exclusionPending = adviceExclusionPending;
    const selection = productSelection;
    const list = retailList;
    const need = mealNeed;
    invalidate();
    referencePlan = references; adviceFocus = focus; referenceAction = action;
    adviceHistory = history; adviceHistoryBasket = historyBasket;
    adviceExclusionPending = exclusionPending;
    productSelection = selection;
    retailList = list;
    mealNeed = need;
    suspendedDraft = draft;
    return state;
  }
  function preview(plan, exactTarget = null) {
    suspendedDraft = null;
    const base = basket.getSnapshot();
    // A confirmed row keeps its chosen name/package when a later preference
    // rebuilds the same product ID. The generic seed cannot relabel that row.
    const planCatalog = localCatalog.map(product => {
      const confirmed = base.find(row => row.id === product.id);
      return confirmed && (confirmed.name !== product.name || confirmed.unit !== product.unit)
        ? { ...product, name: confirmed.name, unit: confirmed.unit } : product;
    });
    const planById = new Map(planCatalog.map(product => [product.id, product]));
    const owned = new Map(managed.map(row => [row.productId, row.quantity]));
    const next = new Map();
    for (const row of base) {
      const product = planById.get(row.id) ?? row;
      if (isShoppingProductRejected(product, memory)) continue;
      const quantity = row.quantity - (owned.get(row.id) ?? 0);
      if (quantity > 0) next.set(row.id, { ...row, quantity });
    }
    for (const row of plan.items) {
      const product = planById.get(row.productId);
      if (!product || isShoppingProductRejected(product, memory)) continue;
      const prior = next.get(product.id);
      next.set(product.id, { id: product.id, name: product.name, unit: product.unit, quantity: (prior?.quantity ?? 0) + row.quantity });
    }
    const replacement = exactTarget ?? [...next.values()];
    const diff = [...new Set([...base.map(row => row.id), ...replacement.map(row => row.id)])].map(id => ({
      id, name: replacement.find(row => row.id === id)?.name ?? base.find(row => row.id === id)?.name,
      before: base.find(row => row.id === id)?.quantity ?? 0, after: replacement.find(row => row.id === id)?.quantity ?? 0
    })).filter(row => row.before !== row.after);
    const validation = plan.items.length ? validateBasketProposal({ items: plan.items }, { catalog: planCatalog }) : { status: "accepted", basket: [], acceptedRows: [] };
    const invalid = validation.status !== "accepted" || replacement.some(row => row.quantity > 99 || row.quantity < 1);
    if (invalid) {
      pending = null;
      state = messageState("Набор не прошёл проверку.", "Количество или товар не удалось безопасно сопоставить. Корзина не изменилась.");
      return state;
    }
    pending = { epoch, revision: memory.revision, base: copy(base), replacement: copy(replacement), plan: copy(plan), diff };
    lastPlan = copy(plan.items);
    referencePlan = copy(plan.items);
    state = { status: "clarification", result: { kind: "clarification", triggerReason: "conversation_draft", reason: "confirmation_required", draftProposal: { items: plan.items }, validation }, validation,
      presentation: presentConversationBasket(memory, plan, planCatalog, priceHints, replacement, diff) };
    pending.presentation = state.presentation;
    return state;
  }
  function confirm(mode) {
    if (!pending) {
      if (hybrid.getState().status !== "clarification") return state;
      const next = hybrid.confirm(mode);
      if (activeMemory() && stagedByHybrid) { const items = stagedByHybrid; stagedByHybrid = null; return preview({ items, unresolved: [], warnings: [] }); }
      state = next;
      return state;
    }
    if (mode !== "confirm_all" || pending.epoch !== epoch || pending.revision !== memory.revision) return state;
    suspendedDraft = null;
    const draft = pending;
    pending = null;
    const applied = basket.replaceReviewedBasket(draft.base, draft.replacement);
    if (!applied.applied) {
      state = messageState("Корзина успела измениться.", "Старый черновик не применён. Напиши «перестрой», чтобы пересчитать изменения по текущей корзине.");
      return state;
    }
    if (typeof draft.selectionId === "string") {
      const owned = new Map(managed.map(row => [row.productId,
        Math.min(row.quantity, draft.base.find(item => item.id === row.productId)?.quantity ?? 0)]));
      const chosen = draft.plan.items[0];
      owned.set(chosen.productId, (owned.get(chosen.productId) ?? 0)
        - (productSelection?.appliedQuantity ?? 0) + chosen.quantity);
      managed = [...owned].filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity }));
      lastPlan = copy(managed); referencePlan = copy(managed);
    } else managed = copy(draft.plan.items);
    if (typeof draft.selectionId === "string" && productSelection?.cards[0]?.id === draft.selectionId) productSelection = { ...productSelection,
      appliedQuantity: draft.plan.items[0].quantity, appliedSnapshot: copy(applied.snapshot) };
    if (typeof draft.selectionId === "string" && retailList && productSelection?.cards[0]?.id === draft.selectionId) {
      retailList.items[retailList.index].status = "confirmed";
      retailList.items[retailList.index].quantity = draft.plan.items[0].quantity;
      retailList.items[retailList.index].confirmedQuantity = draft.plan.items[0].quantity;
    }
    if (checkpoint) checkpoint.appliedSnapshot = copy(applied.snapshot);
    state = { status: "success", result: { kind: "proposal" }, validation: state.validation, presentation: { headline: "Применены показанные изменения. Теперь можно сравнить магазины.", mascotState: "found" }, mergeRejectedRows: [] };
    decorateMealProduct();
    decorateRetailList();
    decorateNeedContext();
    return state;
  }
  function decorateRetailList() {
    if (!retailList || state.status === "loading" || !state.presentation) return;
    const item = retailList.items[retailList.index];
    const confirmed = item.status === "confirmed";
    state = { ...state, presentation: { ...state.presentation,
      message: `Товар ${retailList.index + 1}/${retailList.items.length}: ${item.query}.${retailList.budgetMinor ? ` Общий лимит списка: ${retailList.budgetMinor / 100} ₽; стоимость проверим по корзине.` : ""} ${state.presentation.message ?? ""}${confirmed
        ? " Этот товар подтверждён. Перейдём к следующему?" : " Выбери и подтверди этот товар или явно пропусти его."}`,
      conversationChoices: [...(state.presentation.conversationChoices ?? []).filter(choice => !/Следующий товар|Пропусти этот товар|Отмени изменение/u.test(choice.text)),
        { label: confirmed ? retailList.index + 1 < retailList.items.length ? "Следующий товар" : "Завершить список"
          : item.confirmedQuantity ? "Отменить изменение" : "Пропустить этот товар",
        text: confirmed ? "Следующий товар" : item.confirmedQuantity ? "Отмени изменение" : "Пропусти этот товар" }] } };
  }
  function handleRetailList(text, token) {
    if (!retailList) return false;
    const value = text.trim().toLocaleLowerCase("ru-RU").replace(/[.!?]+$/u, "");
    const skip = /^(?:пропусти(?: этот товар)?|пропустить(?: этот товар)?)$/u.test(value);
    const next = /^(?:дальше|следующий товар|заверши(?:ть)? список)$/u.test(value);
    const cancelChange = value === "отмени изменение";
    if (!skip && !next && !cancelChange) return false;
    if (retailList.scope !== retailScope()) {
      retailList = null; productSelection = null; pending = null; suspendedDraft = null;
      state = messageState("Магазин изменился.", "Напиши список заново для выбранного магазина. Подтверждённая корзина сохранилась."); return true;
    }
    const item = retailList.items[retailList.index];
    if (cancelChange && item.confirmedQuantity) {
      pending = null; suspendedDraft = null; item.quantity = item.confirmedQuantity; item.status = "confirmed";
      if (productSelection) productSelection = { ...productSelection, quantity: item.quantity };
      state = messageState("Изменение отменено.", "Подтверждённое количество в корзине сохранилось.");
      decorateRetailList(); return true;
    }
    if (skip && item.confirmedQuantity) {
      state = messageState("Этот товар уже в корзине.", "Для удаления напиши «убери» и название товара. Чтобы продолжить список, нажми «Следующий товар».");
      decorateRetailList(); return true;
    }
    if (!skip && item.status !== "confirmed") {
      if (!pending && suspendedDraft && suspendedDraft.pending.revision === memory.revision
          && JSON.stringify(suspendedDraft.pending.base) === JSON.stringify(basket.getSnapshot())) {
        pending = suspendedDraft.pending; pending.epoch = epoch; state = suspendedDraft.state;
      }
      if (pending) state = { ...state, presentation: { ...pending.presentation,
        message: "Сначала подтверди показанный товар или явно пропусти его. " + pending.presentation.message } };
      else state = messageState("Этот товар ещё не подтверждён.", "Выбери реальную карточку. Если подходящего варианта нет, можно явно пропустить товар; я отмечу неполный список.");
      decorateRetailList(); return true;
    }
    if (skip) item.status = "skipped";
    pending = null; suspendedDraft = null; productSelection = null; hybrid.invalidate();
    if (retailList.index + 1 >= retailList.items.length) {
      const skipped = retailList.items.filter(row => row.status === "skipped").map(row => row.query);
      const count = retailList.items.filter(row => row.status === "confirmed").length;
      retailList = null;
      state = messageState(skipped.length ? "Список разобрали частично." : "Все товары списка разобрали.",
        `Подтверждено товаров: ${count}.${skipped.length ? ` Пропущены: ${skipped.join(", ")}.` : ""} Проверь состав и количество в корзине. «Где дешевле?» проверит общую стоимость; попадание в бюджет и наличие пока не подтверждены.`);
      return true;
    }
    retailList.index++;
    const turn = { kind: "search", ...retailList.items[retailList.index] };
    const result = selectRetailProduct(`хочу ${turn.query}`, token, turn);
    if (result && typeof result.then === "function") return result.then(() => { if (token === epoch) decorateRetailList(); return true; });
    decorateRetailList(); return true;
  }
  function decorateMealProduct() {
    if (mealNeed?.stage !== "products" || state.status === "loading") return;
    const view = mealNeedProductView(mealNeed);
    if (!view || !state.presentation) return;
    state = { ...state, presentation: { ...state.presentation,
      message: `${view.summary} ${state.presentation.message ?? ""} Напиши «дальше», чтобы посмотреть следующий ингредиент.`,
      conversationChoices: [{ label: view.next, text: "Следующий ингредиент" }] } };
  }
  function decorateNeedContext() {
    if (mealNeed || !productSelection || !state.presentation || state.status === "loading") return;
    const summary = shoppingNeedContextSummary(memory);
    if (!summary || state.presentation.message?.startsWith(summary)) return;
    state = { ...state, presentation: { ...state.presentation, message: `${summary} ${state.presentation.message ?? ""}`.trim() } };
    if (pending) pending.presentation = state.presentation;
  }
  function handleMealNeed(text, token) {
    const turn = advanceMealNeed(text, mealNeed, memory);
    if (!turn) return false;
    retailList = null;
    pending = null; suspendedDraft = null; productSelection = null;
    referencePlan = []; referenceAction = null; adviceFocus = null; hybrid.invalidate();
    if (turn.kind === "cancel") {
      mealNeed = null; state = messageState("Подбор отменён.", "Подтверждённая корзина сохранилась. Можно написать другой запрос."); return true;
    }
    const updated = updateShoppingConversation(memory, turn.delta);
    if (updated.overflow) { mealNeed = null; state = messageState("Условий уже много.", "Сохранила предыдущие условия. Можно сбросить предпочтения или начать новую корзину."); return true; }
    setMemory(updated.state);
    mealNeed = turn.focus;
    if (memory.facts.unresolvedConstraints) {
      state = messageState("Уточню ограничение.", `Не распознала: ${memory.facts.unresolvedConstraints.value.join("; ")}. Уточни эту часть или явно отмени её. Пока не предлагаю блюда, чтобы не нарушить условие.`);
      return true;
    }
    if (turn.kind === "clarification") { state = messageState("Уточню один момент.", turn.message); return true; }
    if (turn.kind === "complete") {
      mealNeed = null;
      state = messageState("Ингредиенты посмотрели.", "В корзине остались только явно подтверждённые товары. Проверь, что удалось добавить, и количество упаковок. Затем «Где дешевле?» проверит стоимость и покрытие; полный набор и попадание в бюджет пока не подтверждены."); return true;
    }
    if (turn.kind === "search") {
      if (retailScope() === null) {
        state = messageState("Начнём с ингредиентов.", "Выбери магазин в каталоге и напиши нужный продукт — посмотрим его реальные карточки. Подтверждённая корзина сохранилась.");
        decorateMealProduct(); return true;
      }
      const selection = selectRetailProduct(`хочу ${turn.query}`, token);
      if (selection && typeof selection.then === "function") return selection.then(() => { if (token === epoch) decorateMealProduct(); return true; });
      decorateMealProduct(); return true;
    }
    const view = mealNeedView(mealNeed, memory);
    state = messageState(view.headline, view.message);
    state.presentation.conversationChoices = view.choices.map(choice => typeof choice === "string" ? { label: choice, text: choice } : choice);
    return true;
  }
  function selectRetailProduct(text, token, suppliedTurn = null) {
    const scope = retailScope();
    if (productSelection && productSelection.scope !== scope) {
      productSelection = null; retailList = null; pending = null; suspendedDraft = null;
    }
    if (scope === null) return false;
    if (typeof options.resolveRetailSelectionScope === "function" && scope === "retail:unavailable") {
      pending = null; suspendedDraft = null; productSelection = null; retailList = null; hybrid.invalidate();
      state = messageState("Уточню выбранный магазин.", "Не удалось проверить текущий выбор каталога. Выбери магазин ещё раз; корзина сохранилась."); return true;
    }
    const need = extractShoppingNeedContext(text);
    const delta = extractShoppingDelta(normalizeRetailShoppingText(text));
    const withoutMeat = need.text.replace(/(?:[,;]\s*)?\s*без\s+мяса[.!?]*$/iu, "").trim();
    const simpleMeatRefusal = withoutMeat !== need.text.trim() && delta.reject.includes("meat")
      && delta.reject.every(key => key === "meat") && !delta.allow.length && !delta.unresolved.length;
    const selectionDelta = simpleMeatRefusal ? { ...delta, reject: [] } : delta;
    const turn = suppliedTurn ?? (simpleMeatRefusal && !withoutMeat
      ? { kind: "context" } : retailSelectionRequest(simpleMeatRefusal ? withoutMeat : text, localCatalog, selectionDelta, productSelection));
    if (!turn) {
      if (!/^(?:го|ок|да|давай|применить|применяй|подтверждаю)$/iu.test(text.trim())) { productSelection = null; retailList = null; }
      return false;
    }
    pending = null; suspendedDraft = null; referencePlan = []; referenceAction = null; adviceFocus = null;
    hybrid.invalidate();
    if (memory.facts.unresolvedConstraints) {
      productSelection = null;
      state = messageState("Осталось непонятое условие.", "Сначала уточни или явно отмени нераспознанное условие. Я сохранила его, чтобы не нарушить отказ.");
      return true;
    }
    if (!need.clarification && (Object.keys(need.facts).length || simpleMeatRefusal)) {
      const updated = updateShoppingConversation(memory, { ...extractShoppingDelta(""), facts: need.facts,
        reject: simpleMeatRefusal ? ["meat"] : [], rejectScopes: delta.rejectScopes, rejectionScope: delta.rejectionScope });
      if (updated.overflow) { state = messageState("Условий уже много.", "Предыдущие условия сохранила. Уточни запрос короче."); return true; }
      setMemory(updated.state);
    }
    if (turn.kind === "context") {
      if (productSelection) {
        const cards = productSelection.cards.filter(card => !isShoppingProductRejected(card, memory));
        productSelection = { ...productSelection, cards, selected: productSelection.selected && cards.length > 0 };
      }
      if (productSelection?.selected) return selectRetailProduct("выбираю вариант 1", token);
      state = productSelection ? retailSelectionView(productSelection)
        : messageState("Условия покупки сохранила.", `${shoppingNeedContextSummary(memory)} Что хочешь купить?`.trim());
      return true;
    }
    if (turn.budgetMinor && turn.kind === "search") {
      const updated = updateShoppingConversation(memory, { ...extractShoppingDelta(""), facts: { budgetMinor: { value: turn.budgetMinor, scope: "goal" } } });
      if (updated.overflow) { state = messageState("Условий уже много.", "Сохранила предыдущие условия; уточни запрос короче."); return true; }
      setMemory(updated.state);
    }
    if (turn.kind === "clarification") { state = messageState("Уточню один момент.", turn.message); return true; }
    if (turn.kind === "quantity") {
      if (!Number.isSafeInteger(turn.quantity) || turn.quantity < 1 || turn.quantity > 99) {
        state = messageState("Уточни количество.", "Можно выбрать от 1 до 99 упаковок. Предыдущий выбор сохранила."); return true;
      }
      productSelection = { ...productSelection, quantity: turn.quantity };
      if (retailList) { retailList.items[retailList.index].quantity = turn.quantity; retailList.items[retailList.index].status = "waiting"; }
      if (productSelection.selected) return selectRetailProduct("выбираю вариант 1", token);
      state = retailSelectionView(productSelection); return true;
    }
    if (turn.kind === "sort") {
      productSelection = { ...productSelection, cards: [...productSelection.cards].sort((a, b) => a.priceMinor - b.priceMinor) };
      state = retailSelectionView(productSelection, "Показала по указанной цене упаковки; объём и условия могут отличаться."); return true;
    }
    if (turn.kind === "choice") {
      const card = productSelection.cards[turn.index];
      if (!card) { state = messageState("Уточни вариант.", "Такого номера среди показанных карточек нет."); return true; }
      productSelection = { ...productSelection, cards: [card], selected: true };
      const product = reviewedRetailSelection(card);
      if (!product || !byId.has(product.id)) {
        productSelection = { ...productSelection, cards: [card] };
        state = retailSelectionView(productSelection, "Выбранную карточку пока нельзя безопасно добавить в расчётную корзину. Открой её источник или уточни другой вариант."); return true;
      }
      if (isShoppingProductRejected(product, memory)) {
        state = messageState("Этот вариант конфликтует с сохранённым отказом.", "Если передумал, напиши, что этот продукт теперь можно."); return true;
      }
      const base = basket.getSnapshot();
      const prior = base.find(row => row.id === product.id);
      if (productSelection.appliedQuantity && JSON.stringify(base) !== JSON.stringify(productSelection.appliedSnapshot)) {
        state = messageState("Корзина успела измениться.", "Напиши новый запрос на этот товар, чтобы я заново проверила количество. Старый выбор не применяю."); return true;
      }
      const quantity = (prior?.quantity ?? 0) - (productSelection.appliedQuantity ?? 0) + productSelection.quantity;
      if (quantity > 99 || (prior && (prior.name !== product.name || prior.unit !== product.unit))) {
        state = messageState("Уточню корзину.", "В корзине уже есть другая упаковка этого товара или количество слишком велико. Сначала исправь её, чтобы я не подменила выбранный вариант."); return true;
      }
      const replacement = [...base.filter(row => row.id !== product.id), { id: product.id, name: product.name, unit: product.unit, quantity }];
      const validation = validateBasketProposal({ items: [{ productId: product.id, quantity: productSelection.quantity }] }, { catalog: [product] });
      if (validation.status !== "accepted") { state = messageState("Не удалось проверить выбор.", "Корзина сохранилась. Уточни товар или количество."); return true; }
      const plan = { items: [{ productId: product.id, quantity: productSelection.quantity }], unresolved: [], warnings: [] };
      pending = { epoch, revision: memory.revision, base: copy(base), replacement: copy(replacement), plan: copy(plan), diff: [], selectionId: card.id };
      checkpoint = { memory, plan: copy(lastPlan), basket: copy(base), appliedSnapshot: null };
      state = { status: "clarification", result: { kind: "clarification", triggerReason: "conversation_draft", reason: "confirmation_required" }, validation,
        presentation: { headline: "Этот вариант подходит по точной карточке.", message: `Добавить ${product.name}, ${product.unit} ×${productSelection.quantity}? Подтверди выбор. Цены корзины проверим отдельно.`,
          items: [{ productId: product.id, name: product.name, unit: product.unit, quantity: productSelection.quantity }], primaryAction: "Применить изменения", mascotState: "checking" } };
      pending.presentation = state.presentation;
      return true;
    }
    if (!suppliedTurn && !turn.refinement) retailList = turn.items?.length > 1
      ? { items: turn.items.map(item => ({ ...item, status: "waiting" })), index: 0, scope, budgetMinor: turn.budgetMinor } : null;
    if (retailList && turn.refinement) retailList.items[retailList.index] = { query: turn.query, quantity: turn.quantity, status: "waiting" };
    if (turn.needsFat) {
      productSelection = { query: turn.query, quantity: turn.quantity, scope, cards: [], needsFat: true };
      state = messageState("Товар поняла, уточню жирность.", `Для «${turn.query}» какую жирность искать? Напиши процент, например «1%» или «2,5%». Слово «нежирный» не буду заменять случайным вариантом.`);
      state.presentation.conversationChoices = [{ label: "1%", text: "1%" }, { label: "2,5%", text: "2,5%" }];
      return true;
    }
    if (retailList) retailList.items[retailList.index].status = "waiting";
    productSelection = null;
    state = { status: "loading" };
    return (async () => {
      let result = null, timeout;
      try {
        result = await Promise.race([
          // The retail-mode callback supplies the currently selected store.
          // A prior conversational store wish must not override that selection.
          Promise.resolve().then(() => options.resolveCommercialRequest?.(`хочу ${turn.query}`, localCatalog, { retailer: null, selectionDiscovery: true })),
          new Promise(resolve => { timeout = setTimeout(() => resolve(null), 4500); })
        ]);
      } catch { /* A failed catalog must not fall through into a generic product. */ }
      finally { clearTimeout(timeout); }
      if (token !== epoch) return true;
      const currentScope = retailScope();
      if (currentScope === null || (scope.startsWith("[") && currentScope.startsWith("[") && scope !== currentScope)) {
        productSelection = null; state = messageState("Каталог изменился.", "Повтори запрос для нового выбранного магазина. Корзина сохранилась."); return true;
      }
      const scopedResult = typeof options.resolveRetailSelectionScope !== "function"
        || JSON.stringify([result?.retailerId, result?.retailerContext?.storeId]) === currentScope;
      const cards = (scopedResult ? admittedRetailSelectionCards(result, turn.query) : []).filter(card => !isShoppingProductRejected(card, memory));
      productSelection = { query: turn.query, quantity: turn.quantity, scope: currentScope, cards, budgetMinor: turn.budgetMinor ?? retailList?.budgetMinor };
      if (retailList && retailList.scope === scope) retailList.scope = currentScope;
      state = retailSelectionView(productSelection);
      return true;
    })();
  }
  async function execute(text, token) {
    const utterance = text;
    commercialTurn = false;
    if (adviceHistoryBasket !== null && adviceHistoryBasket !== JSON.stringify(basket.getSnapshot())) {
      adviceHistory = []; adviceHistoryBasket = null; adviceFocus = null;
      adviceExclusionPending = false;
    }
    // Complete greetings and attention calls take precedence over fuzzy SKU
    // matching: "хай" must not become tea in the selected retailer catalog.
    const dialogue = resolveLocalAssistantDialogue(text);
    if (dialogue && (["greeting", "attention", "thanks"].includes(dialogue.dialogueKind)
      || dialogue.dialogueKind === "acknowledgement" && adviceFocus && !pending && !suspendedDraft)) {
      // Social replies consume a turn too: expire one-turn facts and age
      // hypotheses through the same empty-delta update as ordinary fallback.
      setMemory(updateShoppingConversation(memory, extractShoppingDelta("")).state);
      mealNeed = null; retailList = null; productSelection = null; stagedByHybrid = null;
      pending = null; suspendedDraft = null; referencePlan = []; referenceAction = null;
      const request = hybrid.run(text);
      state = hybrid.getState();
      const next = await request;
      if (token === epoch) state = next;
      return state;
    }
    if (preflightLocalBasketText(text).kind === "reject") {
      mealNeed = null;
      retailList = null; productSelection = null;
      pending = null; suspendedDraft = null; referencePlan = []; adviceFocus = null; referenceAction = null;
      adviceHistory = []; adviceHistoryBasket = null;
      adviceExclusionPending = false;
      const request = hybrid.run(text);
      state = hybrid.getState();
      const next = await request;
      if (token === epoch) state = next;
      return state;
    }
    if (adviceExclusionPending) {
      const explicit = extractShoppingDelta(text);
      const newRequest = shoppingAdviceTopic(text) || isShoppingProductFactsQuestion(text)
        || explicit.reset || explicit.newGoal || explicit.undo
        || /^(?:добавь|положи|убери|удали|замени|возьми|купи|собери|закажи)\s/iu.test(text)
        || resolveShoppingPriceFollowup(text, adviceFocus, referencePlan, localCatalog);
      if (newRequest) adviceExclusionPending = false;
      else if (text.length <= 80 && !/^(?:да|нет|го|ок|давай|не знаю)[.!?]*$/iu.test(text)
        && !/[?!]/u.test(text)) {
        text = /^без\s/iu.test(text) ? text : `без ${text}`;
        adviceExclusionPending = false;
      } else {
        state = messageState("Уточню один момент.", "Назови продукт, который исключаем, например «сыр» или «без сыра». Корзину не меняю.");
        return state;
      }
    }
    const possibleContinuation = adviceFocus ? resolveShoppingAdviceFollowup(text, adviceFocus) : null;
    const adviceContinuation = possibleContinuation?.adviceExplanation && !adviceHistory.length ? null : possibleContinuation;
    if (adviceContinuation?.kind === "clarification") {
      adviceExclusionPending = adviceContinuation.exclusion === true;
      pending = null; suspendedDraft = null; hybrid.invalidate();
      state = messageState("Уточню один момент.", adviceContinuation.message);
      return state;
    }
    const continuingAdvice = adviceContinuation?.readOnly === true;
    const mealBasketRemoval = mealNeed?.stage === "products" && /^убери\s/iu.test(text);
    const need = continuingAdvice ? null : handleMealNeed(text, token);
    if (need) { if (typeof need.then === "function") await need; return state; }
    if (mealNeed && (mealNeed.stage !== "products" || extractShoppingDelta(text).reset || extractShoppingDelta(text).newGoal
      || extractShoppingDelta(text).undo || shoppingAdviceTopic(text) || isShoppingProductFactsQuestion(text)
      || /^(?:хочу|добавь|убери|верни|нужен|нужна|нужны|возьми)\s/iu.test(text))) mealNeed = null;
    const listTurn = continuingAdvice ? null : handleRetailList(text, token);
    if (listTurn) { if (typeof listTurn.then === "function") await listTurn; return state; }
    // Retail selection uses admitted source cards before the generic seed
    // proposal. Advice, refusals, budgets and commercial questions keep their
    // established routes; a catalog outage cannot add a placeholder product.
    const selectionQuestion = continuingAdvice || shoppingAdviceTopic(text) || isShoppingProductFactsQuestion(text);
    if (selectionQuestion) { productSelection = null; retailList = null; }
    const needContext = extractShoppingNeedContext(text);
    const needDelta = extractShoppingDelta(text);
    const meatContext = /без\s+мяса[.!?]*$/iu.test(needContext.text)
      && needDelta.reject.length === 1 && needDelta.reject[0] === "meat" && !needDelta.unresolved.length && !needDelta.allow.length;
    const contextualShopping = (needContext.recognized || meatContext) && !selectionQuestion
      && !/цен[ауы]|стоим|сто[ия]т|скидк|акци|дешев|налич|доставк|заказ|где/iu.test(text);
    if (contextualShopping && retailScope() === null) {
      pending = null; suspendedDraft = null; productSelection = null; retailList = null; hybrid.invalidate();
      if (needContext.clarification) { state = messageState("Уточню условие.", needContext.clarification); return state; }
      const updated = updateShoppingConversation(memory, { ...needDelta, facts: { ...needDelta.facts, ...needContext.facts } });
      if (!updated.overflow) setMemory(updated.state);
      state = memory.facts.unresolvedConstraints
        ? messageState("Уточню ограничение.", `Не распознала: ${memory.facts.unresolvedConstraints.value.join("; ")}. Уточни эту часть; остальные условия сохранила.`)
        : messageState("Условия покупки сохранила.", `${shoppingNeedContextSummary(memory)} Выбери магазин и напиши продукты — начнём с реальных карточек.`);
      return state;
    }
    const selection = (!selectionQuestion && (preflightLocalBasketText(text).kind === "pass"
      || retailScope() !== null && (retailBudgetIntent(text, localCatalog) || contextualShopping)))
      || (productSelection && isRetailSortFollowup(text))
      ? selectRetailProduct(text, token) : false;
    if (selection) {
      if (typeof selection.then === "function") await selection;
      if (token === epoch) { decorateMealProduct(); decorateRetailList(); }
      return state;
    }
    const priceTurn = resolveShoppingPriceFollowup(text, adviceFocus, referencePlan, localCatalog);
    if (priceTurn?.kind === "clarification") {
      pending = null; suspendedDraft = null; referenceAction = null; hybrid.invalidate();
      state = messageState("Уточню один момент.", priceTurn.message);
      return state;
    }
    if (priceTurn) text = priceTurn.text;
    const editTurn = resolveShoppingBasketFollowup(text, referencePlan, localCatalog, referenceAction);
    referenceAction = null;
    if (editTurn) {
      pending = null; suspendedDraft = null; hybrid.invalidate();
      if (editTurn.kind === "clarification") {
        referenceAction = editTurn.action ?? null;
        state = messageState("Уточню один момент.", editTurn.message);
        return state;
      }
      const updated = updateShoppingConversation(memory, extractShoppingDelta(editTurn.memoryText));
      if (updated.overflow) {
        state = messageState("Условия уже не помещаются в короткую память.", "Предыдущие условия сохранены. Можно сбросить предпочтения или начать новую корзину.");
        return state;
      }
      checkpoint = { memory, plan: copy(lastPlan), basket: basket.getSnapshot(), appliedSnapshot: null };
      setMemory(updated.state);
      return preview({ items: editTurn.items, unresolved: [], warnings: [], explicit: true });
    }
    const inferredFocus = referencePlan.length === 1
      ? shoppingAdviceFocus(`Как выбрать ${byId.get(referencePlan[0].productId)?.name ?? ""}?`) : null;
    const possibleFollowup = resolveShoppingAdviceFollowup(text, adviceFocus ?? inferredFocus);
    const followup = possibleFollowup?.adviceExplanation && !adviceHistory.length ? null : possibleFollowup;
    if (followup?.kind === "clarification") {
      adviceExclusionPending = followup.exclusion === true;
      pending = null; suspendedDraft = null; hybrid.invalidate();
      state = messageState("Уточню один момент.", followup.message);
      return state;
    }
    if (followup) {
      text = followup.text;
      // A people/day clarification continues the existing advice. Repeating
      // "Как выбрать…" here would turn "А на двоих?" into the initial task.
      const householdOnly = continuingAdvice && followup.readOnly && needContext.recognized
        && !needContext.clarification && /^(?:а\s*)?[\s,.!?;]*$/iu.test(needContext.text);
      if (householdOnly) {
        const subject = adviceFocus?.targets.map(shoppingTargetLabel).join(" и ") || adviceFocus?.subject;
        const scoped = subject ? `Про ${subject}: ${utterance}` : utterance;
        text = scoped.length <= 300 ? scoped : utterance;
      }
    }
    // Exact heating answers belong to the source-backed ready-food reference.
    // "Без разогрева" is a preparation question, not an unknown food refusal
    // or a request to persist a new cooking preference.
    const extracted = extractShoppingDelta(text);
    const extractedDelta = followup?.referenceOnly ? { ...extracted, facts: {}, unresolved: [] } : extracted;
    const delta = (contextualShopping || continuingAdvice) && !needContext.clarification
      ? { ...extractedDelta, facts: { ...extractedDelta.facts, ...needContext.facts } } : extractedDelta;
    // "For guests" can answer the current product-selection question. Its
    // occasion marker alone must not start a new basket goal or drop a budget.
    // Keep explicit conversation commands and mixed shopping changes on their
    // old path, including commands whose standalone parser uses an anchor.
    const explicitConversationCommand = /новая корзина|новая задача|другая корзина/iu.test(text)
      || /сбрось предпочтения|забудь (?:вс[её]|мои) предпочтения|начн[её]м с чистого листа|отмени последнее|откат|верни как было/iu.test(text)
      || /перестрой|пересобери|обнови корзину/iu.test(text);
    const advicePurposeOnly = adviceFocus !== null && followup?.kind === "question" && delta.newGoal
      && !explicitConversationCommand
      && !Object.keys(delta.facts).length && !delta.unset.length
      && !delta.reject.length && !delta.allow.length && !delta.want.length
      && !delta.reset && !delta.undo && !delta.clearUnresolved
      && !delta.dissatisfaction && !delta.directions && !delta.unresolved.length;
    const affirmative = /^(?:го|ок|да|давай|применить|применяй|подтверждаю)$/iu.test(text.trim());
    if (affirmative) {
      if (!pending && suspendedDraft && suspendedDraft.pending.revision === memory.revision
        && JSON.stringify(suspendedDraft.pending.base) === JSON.stringify(basket.getSnapshot())) {
        pending = suspendedDraft.pending; pending.epoch = epoch; state = suspendedDraft.state;
      }
      suspendedDraft = null;
      if (pending) return confirm("confirm_all");
      const result = hybrid.getState().result;
      if (result?.kind === "clarification" && result.triggerReason !== "smalltalk") return confirm("confirm_all");
      hybrid.invalidate();
      state = messageState("Продолжим.", "Черновика для подтверждения сейчас нет. Можно написать покупки или попросить перестроить набор.");
      decorateRetailList();
      return state;
    }
    const adviceTopic = isShoppingProductFactsQuestion(text) ? "product_facts" : followup?.readOnly ? "advice" : shoppingAdviceTopic(text);
    const questionFocus = adviceTopic === "advice" ? followup?.focus ?? (followup?.readOnly && adviceFocus ? adviceFocus : shoppingAdviceFocus(text)) : null;
    // "How to choose ready food without cooking?" is a selection question,
    // even when the preference extractor notices cooking-effort vocabulary.
    const cookingSelectionQuestion = questionFocus?.topic === "selection" && questionFocus.subject
      && Object.keys(delta.facts).every(key => key === "cookingEffort");
    // Question words such as "можно" and mentions of mince can look like
    // permissions or preparation commands to the preference extractor.
    // A plain product question must stay read-only; explicit changes still
    // go through the existing preference/constraint path.
    const readOnlyQuestion = ["advice", "product_facts"].includes(adviceTopic)
      && (followup?.readOnly || adviceTopic === "product_facts" || !Object.keys(delta.facts).length || cookingSelectionQuestion)
      && !delta.want.length && !delta.unset.length
      && !delta.reset && !delta.undo && (!delta.newGoal || advicePurposeOnly) && !delta.clearUnresolved
      && (followup?.readOnly || !/убери|не надо|надоел|терпеть не могу|не\s+(?:хочу|нужн|ем|люблю|нрав|подход|перенош)/iu.test(text));
    let comparisonExplanation = adviceTopic === "explanation" ? localShoppingComparisonExplanation(text, basket.getSnapshot()) : null;
    let hasCurrentComparison = false;
    if (comparisonExplanation && typeof options.getCurrentComparison === "function") {
      try {
        const current = currentComparisonExplanation(options.getCurrentComparison());
        if (current) { comparisonExplanation = current; hasCurrentComparison = true; }
      } catch { /* An unavailable local receipt keeps the existing honest retry. */ }
    }
    if (adviceTopic && (!delta.recognized || readOnlyQuestion || comparisonExplanation)) {
      const currentBasket = basket.getSnapshot();
      const currentDraft = draft => draft && draft.revision === memory.revision
        && JSON.stringify(draft.base) === JSON.stringify(currentBasket);
      if (pending && !currentDraft(pending)) pending = null;
      if (comparisonExplanation) {
        pending = null; suspendedDraft = null; referencePlan = []; adviceFocus = null; hybrid.invalidate();
        adviceHistory = []; adviceHistoryBasket = null;
        state = messageState("Объяснение сравнения.", comparisonExplanation);
        if (hasCurrentComparison) state.result.currentComparisonExplanation = true;
        return state;
      }
      if (adviceTopic === "explanation" && !pending && suspendedDraft
        && currentDraft(suspendedDraft.pending)) {
        pending = suspendedDraft.pending;
        pending.epoch = epoch;
        state = suspendedDraft.state;
      }
      suspendedDraft = null;
      const explanation = localShoppingExplanation(adviceTopic, memory, localCatalog, pending?.plan.items ?? [], pending ? undefined : currentBasket);
      if (["explanation", "preferences"].includes(adviceTopic)) {
        adviceHistory = []; adviceHistoryBasket = null; adviceFocus = null;
        if (pending && adviceTopic === "explanation") {
          state = { ...state, presentation: { ...pending.presentation, headline: "Почему такой набор.",
            message: `${explanation} ${pending.presentation.message}` } };
        } else { pending = null; hybrid.invalidate();
          const persistence = preferenceStore.status();
          const notice = adviceTopic === "preferences" && persistence.available ? persistence.failed
            ? " Сохранение в этом браузере недоступно; новые условия помню только сейчас."
            : persistence.saved ? " Предпочтения сохранены в этом браузере. «Сбрось предпочтения» удалит их." : "" : "";
          state = messageState(adviceTopic === "explanation" ? "Объясню выбор." : "Помню, о чём договорились.", explanation + notice);
        }
        return state;
      }
      pending = null; hybrid.invalidate();
      // A question with a food exclusion stays an advice turn. Never let
      // "можно" authorize an excluded food or turn a question into a draft.
      if (continuingAdvice && needContext.clarification) {
        state = messageState("Уточню условие.", needContext.clarification); return state;
      }
      if (readOnlyQuestion && (delta.reject.length || delta.unresolved.length || continuingAdvice && Object.keys(delta.facts).length)) {
        const updated = updateShoppingConversation(memory, { ...delta, allow: [], want: [] });
        if (!updated.overflow) setMemory(updated.state);
      }
      if (!followup && adviceFocus && questionFocus && JSON.stringify([questionFocus.targets, questionFocus.subject]) !== JSON.stringify([adviceFocus.targets, adviceFocus.subject])) {
        adviceHistory = []; adviceHistoryBasket = null;
      }
      adviceFocus = questionFocus ?? shoppingAdviceFocus(text); referencePlan = [];
      if (memory.facts.unresolvedConstraints) {
        state = messageState("Осталось непонятое условие.", "Сначала уточни или явно отмени нераспознанное условие. Сохраняю его, чтобы не нарушить отказ.");
        return state;
      }
      if (adviceTopic === "product_facts") {
        // Card facts have their own evidence path. Keep only the explicit
        // product focus for the next question, never feed facts or an unrelated
        // old advice answer into the model's temporary exchange history.
        adviceHistory = []; adviceHistoryBasket = null;
        let catalog = localCatalog;
        try { if (typeof options.resolveProductFactsCatalog === "function") catalog = options.resolveProductFactsCatalog(); }
        catch { catalog = []; }
        state = messageState("Посмотрю на карточки.", localShoppingProductFacts(text, catalog, memory).message);
        return state;
      }
      const input = shoppingAdviceInput(text, memory, localCatalog, [], currentBasket, adviceHistory);
      if (!input.catalog.length) {
        state = messageState("В корзине пока нет товаров.", "Добавь покупки, и я помогу выбрать вариант готовки из этого набора. Это не требует менять твои предпочтения.");
        return state;
      }
      const reference = localShoppingDialogueReference(input) ?? localShoppingReference(input);
      const referenceReply = reference ? normalizeShoppingAdviceResponse(reference.reply, input.context) : null;
      if (referenceReply) {
        state = messageState("Давай разберёмся.", referenceReply.message);
        if (typeof reference.referenceKey === "string") state.presentation.referenceKey = reference.referenceKey;
        rememberAdvice(utterance, referenceReply.message);
        return state;
      }
      state = { status: "loading" };
      let answer;
      try { answer = typeof options.requestShoppingAdvice === "function" ? await options.requestShoppingAdvice(input) : null; }
      catch { answer = null; }
      if (token !== epoch) return state;
      if (JSON.stringify(currentBasket) !== JSON.stringify(basket.getSnapshot())) {
        adviceFocus = null;
        adviceHistory = []; adviceHistoryBasket = null;
        state = messageState("Корзина изменилась.", "Совет относился к прежнему набору. Повтори вопрос — учту текущие товары. Корзина сохранена.");
        return state;
      }
      const reply = normalizeShoppingAdviceResponse(answer, input.context);
      const recovery = reply ? null : localShoppingAdvice(input);
      state = messageState(reply ? "Давай разберёмся." : recovery ? "Подскажу простой вариант." : "Сейчас могу опереться на твои условия.",
        reply?.message ?? `Автоматический совет сейчас недоступен. ${recovery?.message ?? explanation}`);
      if ((reply || recovery) && normalizeShoppingAdviceResponse({ kind: "advice", message: state.presentation.message }, input.context)) {
        rememberAdvice(utterance, state.presentation.message);
      }
      return state;
    }
    // Every new substantive message supersedes the previous reviewed candidate,
    // including a price question or an unsupported specification.
    pending = null; suspendedDraft = null;
    adviceFocus = null;
    adviceHistory = []; adviceHistoryBasket = null;
    const rebuild = /перестрой|пересобери|обнови корзину/u.test(text.toLocaleLowerCase("ru-RU"));
    const onlyProductWish = delta.want.length && !delta.reject.length && !delta.allow.length && !Object.keys(delta.facts).length
      && !delta.reset && !delta.undo && !delta.newGoal && !delta.dissatisfaction && !delta.unresolved.length;
    const categoryWish = delta.want.every(key => key === "fruit" || key === "vegetables");
    // Concrete identity/quantity/specification stays with the existing parser.
    // A concept match alone must not turn lactose-free milk into generic milk.
    const retailerProductQuery = delta.facts.retailer && shoppingTargets(text).length && !delta.facts.budgetMinor
      && !delta.reject.length && !delta.allow.length && !/корзин|перестрой/u.test(text.toLocaleLowerCase("ru-RU"));
    const commercialQuery = retailerProductQuery || /где дешевле|цен[ау]|сколько сто|в наличии|скидк|акци|сам(?:ый|ая|ое|ые|ую|ого|ой)\s+деш[её]в/u.test(text.toLocaleLowerCase("ru-RU"));
    commercialTurn = Boolean(commercialQuery);
    if (commercialQuery && delta.facts.retailer) {
      const updated = updateShoppingConversation(memory, { ...extractShoppingDelta(""), facts: { retailer: delta.facts.retailer } });
      setMemory(updated.state);
    }
    const useConversation = !commercialQuery && delta.recognized && !(onlyProductWish && !categoryWish && !/вместо/u.test(text));
    if (useConversation || (rebuild && activeMemory())) {
      hybrid.invalidate(); pending = null;
      if (delta.undo) {
        if (!checkpoint) { state = messageState("Отменять пока нечего.", "Текущая корзина сохранена."); return state; }
        const old = checkpoint;
        checkpoint = null;
        setMemory(Object.freeze({ ...old.memory, revision: memory.revision + 1 }));
        lastPlan = old.plan;
        // Exact undo of a reviewed mutation only if the basket still matches it.
        const unchanged = old.appliedSnapshot && JSON.stringify(basket.getSnapshot()) === JSON.stringify(old.appliedSnapshot);
        return preview({ items: old.plan, unresolved: [], warnings: unchanged ? [] : ["Корзина могла быть изменена вручную: показываю новый черновик отмены для проверки."] }, unchanged ? old.basket : null);
      }
      const updated = updateShoppingConversation(memory, delta);
      if (updated.overflow) { state = messageState("Условия уже не помещаются в короткую память.", "Я сохранила предыдущие условия. Можно начать новую корзину или сбросить предпочтения; активные отказы не удаляла."); return state; }
      checkpoint = { memory, plan: copy(lastPlan), basket: basket.getSnapshot(), appliedSnapshot: null };
      setMemory(updated.state);
      if (delta.reset) {
        managed = []; lastPlan = []; referencePlan = [];
        state = preferenceStore.status().failed
          ? messageState("Сбросила условия этого разговора.", "Сохранённые предпочтения удалить не удалось. После перезагрузки они могут восстановиться. Подтверждённая корзина сохранена.")
          : messageState("Предпочтения сброшены.", "Начнём новый разговор о покупках. Подтверждённая корзина сохранена.");
        return state;
      }
      if (delta.newGoal) { lastPlan = []; referencePlan = []; }
      if (memory.facts.unresolvedConstraints) {
        state = messageState("Не всё условие удалось понять.", `Не распознала: ${memory.facts.unresolvedConstraints.value.join("; ")}. Уточни именно эту часть, чтобы я не нарушила отказ. Можно явно написать «забудь нераспознанное условие». Другие пожелания сохранила; корзина не изменилась.`);
        return state;
      }
      const explicit = delta.reject.length ? explicitShoppingItems(text, localCatalog, lastPlan) : null;
      if (explicit) {
        const items = new Map(lastPlan.map(row => [row.productId, row]));
        for (const row of explicit.items) items.set(row.productId, row);
        const allowed = [...items.values()].filter(row => !isShoppingProductRejected(byId.get(row.productId), memory));
        return preview({ ...explicit, items: allowed });
      }
      if (mealBasketRemoval && delta.reject.length && !delta.want.length && !delta.allow.length && !Object.keys(delta.facts).length) {
        return preview({ items: lastPlan.filter(row => !isShoppingProductRejected(byId.get(row.productId), memory)),
          unresolved: [], warnings: [], explicit: true });
      }
      return preview(planConversationBasket(memory, localCatalog, priceHints, lastPlan));
    }
    stagedByHybrid = null;
    if (memory.facts.unresolvedConstraints) {
      state = messageState("Осталось непонятое условие.", "Сначала уточни или явно отмени нераспознанное условие. Я сохранила его, чтобы не нарушить отказ.");
      return state;
    }
    if (activeMemory() && onlyProductWish) {
      const parsed = parseLocalBasketText(text, localCatalog);
      if (parsed.kind === "local") {
        const updated = updateShoppingConversation(memory, delta);
        if (!updated.overflow) {
          checkpoint = { memory, plan: copy(lastPlan), basket: basket.getSnapshot(), appliedSnapshot: null };
          setMemory(updated.state);
        }
      }
    } else {
      const updated = updateShoppingConversation(memory, extractShoppingDelta(""));
      setMemory(updated.state);
    }
    const request = hybrid.run(text);
    state = hybrid.getState();
    const next = await request;
    if (token !== epoch) return state;
    if (commercialQuery) {
      // Commercial answers may discuss Core data, but can never retain a
      // confirmable product interpretation or an earlier basket candidate.
      hybrid.invalidate();
      stagedByHybrid = null;
      adviceFocus = shoppingAdviceFocus(text); referencePlan = [];
      if (next.result?.triggerReason === "commercial_constraint") {
        const { validation, draftProposal, proposal, ...safeResult } = next.result;
        state = { ...next, validation: null, result: safeResult, presentation: { ...next.presentation,
          items: safeResult.reason === "commercial_truth" ? next.presentation?.items ?? [] : [] } };
      } else {
        state = messageState("Цену проверяем отдельно.",
          (memory.facts.retailer ? "Выбранный магазин сохранён как пожелание. " : "")
          + "Товар из вопроса о цене в корзину не добавляю: стоимость и покрытие проверяет сравнение CHECKNI.");
      }
      return state;
    }
    if (activeMemory() && (stagedByHybrid || next.validation?.basket?.length)) {
      const rows = stagedByHybrid ?? rowsOf(next.validation);
      stagedByHybrid = null;
      const exactRequest = parseLocalBasketText(text, localCatalog).kind === "local";
      const needsPreparation = rows.filter(row => !["none", "heat"].includes(knownPreparation(byId.get(row.productId) ?? { id: row.productId })));
      if (memory.facts.cookingEffort?.value === "minimal" && !exactRequest && needsPreparation.length) {
        const plan = planConversationBasket(memory, localCatalog, priceHints, lastPlan);
        return preview({ ...plan, unresolved: [...new Set([...plan.unresolved, ...(next.result?.unresolvedTerms ?? [])])],
          warnings: [...plan.warnings, "Учитываю сохранённое пожелание о минимуме готовки: общий запрос не отменяет его. Оставила варианты с известным способом подготовки."] });
      }
      const rejected = rows.filter(row => isShoppingProductRejected(byId.get(row.productId), memory));
      if (rejected.length) {
        state = messageState("Этот вариант конфликтует с сохранённым отказом.", "Не буду добавлять его молча. Если передумал, напиши, что этот продукт теперь можно.");
        return state;
      }
      const items = new Map(lastPlan.map(row => [row.productId, row]));
      for (const row of rows) items.set(row.productId, row);
      const warnings = memory.facts.cookingEffort?.value === "minimal" && exactRequest
        ? needsPreparation.filter(row => knownPreparation(byId.get(row.productId) ?? { id: row.productId }) === "cook").map(row => `${byId.get(row.productId).name} потребует готовки; оставила по твоему прямому запросу.`)
        : [];
      return preview({ items: [...items.values()], unresolved: next.result?.unresolvedTerms ?? [], warnings });
    }
    state = next;
    if (next.validation?.basket?.length) { lastPlan = rowsOf(next.validation); referencePlan = copy(lastPlan); }
    return state;
  }
  function run(text) {
    if (typeof text !== "string" || !text.trim() || text.trim().length > 300) {
      invalidate(); state = { status: "rejected", inputReason: text?.trim?.() ? "too_long" : "empty" }; return Promise.resolve(state);
    }
    const key = text.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (inFlight?.key === key) return inFlight.promise;
    // Affirmation confirms the exact pending draft; a new substantive turn supersedes it.
    epoch += 1;
    if (pending) pending.epoch = epoch;
    const token = epoch;
    const promise = execute(key, token).then(() => {
      if (token === epoch) decorateNeedContext();
      return state;
    });
    const flight = { key, promise };
    inFlight = flight;
    promise.finally(() => { if (inFlight === flight) inFlight = null; });
    return promise;
  }
  function setRetailer(retailer) {
    if (typeof retailer !== "string" || !retailer.trim() || retailer.length > 80) return state;
    invalidate();
    const updated = updateShoppingConversation(memory, { ...extractShoppingDelta(""),
      facts: { retailer: { value: retailer.trim(), scope: "goal" } } });
    if (!updated.overflow) setMemory(updated.state);
    return state;
  }
  const checkCurrentComparisonExplanation = () => {
    if (state.result?.currentComparisonExplanation !== true) return false;
    let current = null;
    try { current = currentComparisonExplanation(options.getCurrentComparison?.()); } catch { /* Read only, fail closed. */ }
    if (current) return false;
    state = messageState("Сравнение нужно обновить.", localShoppingComparisonExplanation("Почему этот магазин дешевле?", basket.getSnapshot()));
    return true;
  };
  return Object.freeze({ run, confirm, invalidate, edit, preload: hybrid.preload, getState: () => state, checkCurrentComparisonExplanation,
    setRetailer, getConversation: () => memory, getMartenPreferences: () => projectMartenConversation(memory) });
}
