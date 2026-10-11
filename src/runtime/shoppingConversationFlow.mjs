import { createHybridBasketFlow } from "./hybridBasketFlow.mjs";
import { extractShoppingDelta, updateShoppingConversation, isShoppingProductRejected, projectMartenConversation, shoppingTargets } from "../intelligence/shoppingConversation.mjs";
import { planConversationBasket, presentConversationBasket, knownPreparation } from "../intelligence/conversationBasket.mjs";
import { validateBasketProposal } from "../core/ai-basket-proposal.mjs";
import { parseLocalBasketText } from "../intelligence/localBasketParser.mjs";
import { shoppingAdviceTopic, shoppingAdviceInput, localShoppingExplanation, localShoppingAdvice, localShoppingReference } from "../intelligence/shoppingAdvice.mjs";
import { normalizeShoppingAdviceResponse } from "../intelligence/shoppingAdviceContract.mjs";
import { isShoppingProductFactsQuestion, localShoppingProductFacts } from "../intelligence/shoppingProductFacts.mjs";
import { createShoppingPreferenceStore } from "./shoppingPreferenceStorage.mjs";
import { preflightLocalBasketText } from "../intelligence/localBasketPreflight.mjs";
import { shoppingAdviceFocus, resolveShoppingAdviceFollowup, resolveShoppingBasketFollowup, resolveShoppingPriceFollowup, explicitShoppingItems } from "../intelligence/shoppingTurnContext.mjs";

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
  let referenceAction = null;
  let pending = null;
  let suspendedDraft = null;
  let stagedByHybrid = null;
  let commercialTurn = false;
  let epoch = 0;
  let state = { status: "idle" };
  let inFlight = null;
  const byId = new Map(localCatalog.map(product => [product.id, product]));
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
    hybrid.invalidate(); state = { status: "idle" };
    return state;
  }
  function edit() {
    const draft = pending ? { pending, state } : suspendedDraft;
    const references = referencePlan, focus = adviceFocus, action = referenceAction;
    invalidate();
    referencePlan = references; adviceFocus = focus; referenceAction = action;
    suspendedDraft = draft;
    return state;
  }
  function preview(plan, exactTarget = null) {
    suspendedDraft = null;
    const base = basket.getSnapshot();
    const owned = new Map(managed.map(row => [row.productId, row.quantity]));
    const next = new Map();
    for (const row of base) {
      const product = byId.get(row.id) ?? row;
      if (isShoppingProductRejected(product, memory)) continue;
      const quantity = row.quantity - (owned.get(row.id) ?? 0);
      if (quantity > 0) next.set(row.id, { ...row, quantity });
    }
    for (const row of plan.items) {
      const product = byId.get(row.productId);
      if (!product || isShoppingProductRejected(product, memory)) continue;
      const prior = next.get(product.id);
      next.set(product.id, { id: product.id, name: product.name, unit: product.unit, quantity: (prior?.quantity ?? 0) + row.quantity });
    }
    const replacement = exactTarget ?? [...next.values()];
    const diff = [...new Set([...base.map(row => row.id), ...replacement.map(row => row.id)])].map(id => ({
      id, name: replacement.find(row => row.id === id)?.name ?? base.find(row => row.id === id)?.name,
      before: base.find(row => row.id === id)?.quantity ?? 0, after: replacement.find(row => row.id === id)?.quantity ?? 0
    })).filter(row => row.before !== row.after);
    const validation = plan.items.length ? validateBasketProposal({ items: plan.items }, { catalog: localCatalog }) : { status: "accepted", basket: [], acceptedRows: [] };
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
      presentation: presentConversationBasket(memory, plan, localCatalog, priceHints, replacement, diff) };
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
    managed = copy(draft.plan.items);
    if (checkpoint) checkpoint.appliedSnapshot = copy(applied.snapshot);
    state = { status: "success", result: { kind: "proposal" }, validation: state.validation, presentation: { headline: "Применены показанные изменения. Теперь можно сравнить магазины.", mascotState: "found" }, mergeRejectedRows: [] };
    return state;
  }
  async function execute(text, token) {
    commercialTurn = false;
    if (preflightLocalBasketText(text).kind === "reject") {
      pending = null; suspendedDraft = null; referencePlan = []; adviceFocus = null; referenceAction = null;
      const request = hybrid.run(text);
      state = hybrid.getState();
      const next = await request;
      if (token === epoch) state = next;
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
    const followup = resolveShoppingAdviceFollowup(text, adviceFocus ?? inferredFocus);
    if (followup?.kind === "clarification") {
      pending = null; suspendedDraft = null; hybrid.invalidate();
      state = messageState("Уточню один момент.", followup.message);
      return state;
    }
    if (followup) text = followup.text;
    const delta = extractShoppingDelta(text);
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
      return state;
    }
    const adviceTopic = isShoppingProductFactsQuestion(text) ? "product_facts" : shoppingAdviceTopic(text);
    const questionFocus = adviceTopic === "advice" ? shoppingAdviceFocus(text) : null;
    // "How to choose ready food without cooking?" is a selection question,
    // even when the preference extractor notices cooking-effort vocabulary.
    const cookingSelectionQuestion = questionFocus?.topic === "selection" && questionFocus.subject
      && Object.keys(delta.facts).every(key => key === "cookingEffort");
    // Question words such as "можно" and mentions of mince can look like
    // permissions or preparation commands to the preference extractor.
    // A plain product question must stay read-only; explicit changes still
    // go through the existing preference/constraint path.
    const readOnlyQuestion = ["advice", "product_facts"].includes(adviceTopic)
      && (adviceTopic === "product_facts" || !Object.keys(delta.facts).length || cookingSelectionQuestion)
      && !delta.want.length && !delta.unset.length
      && !delta.reset && !delta.undo && !delta.newGoal && !delta.clearUnresolved
      && !/убери|не надо|надоел|терпеть не могу|не\s+(?:хочу|нужн|ем|люблю|нрав|подход|перенош)/iu.test(text);
    if (adviceTopic && (!delta.recognized || readOnlyQuestion)) {
      const explanation = localShoppingExplanation(adviceTopic, memory, localCatalog, lastPlan);
      if (adviceTopic === "explanation" && !pending && suspendedDraft
        && suspendedDraft.pending.revision === memory.revision
        && JSON.stringify(suspendedDraft.pending.base) === JSON.stringify(basket.getSnapshot())) {
        pending = suspendedDraft.pending;
        pending.epoch = epoch;
        state = suspendedDraft.state;
      }
      suspendedDraft = null;
      if (["explanation", "preferences"].includes(adviceTopic)) {
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
      if (readOnlyQuestion && delta.reject.length) {
        const updated = updateShoppingConversation(memory, { ...delta, allow: [] });
        if (!updated.overflow) setMemory(updated.state);
      }
      adviceFocus = questionFocus ?? shoppingAdviceFocus(text); referencePlan = [];
      if (memory.facts.unresolvedConstraints) {
        state = messageState("Осталось непонятое условие.", "Сначала уточни или явно отмени нераспознанное условие. Сохраняю его, чтобы не нарушить отказ.");
        return state;
      }
      if (adviceTopic === "product_facts") {
        let catalog = localCatalog;
        try { if (typeof options.resolveProductFactsCatalog === "function") catalog = options.resolveProductFactsCatalog(); }
        catch { catalog = []; }
        state = messageState("Посмотрю на карточки.", localShoppingProductFacts(text, catalog, memory).message);
        return state;
      }
      const input = shoppingAdviceInput(text, memory, localCatalog, lastPlan);
      const reference = localShoppingReference(input);
      if (reference) {
        state = messageState("Давай разберёмся.", reference.reply.message);
        state.presentation.referenceKey = reference.referenceKey;
        return state;
      }
      state = { status: "loading" };
      let answer;
      try { answer = typeof options.requestShoppingAdvice === "function" ? await options.requestShoppingAdvice(input) : null; }
      catch { answer = null; }
      if (token !== epoch) return state;
      const reply = normalizeShoppingAdviceResponse(answer, input.context);
      const recovery = reply ? null : localShoppingAdvice(input);
      state = messageState(reply ? "Давай разберёмся." : recovery ? "Подскажу простой вариант." : "Сейчас могу опереться на твои условия.",
        reply?.message ?? `Автоматический совет сейчас недоступен. ${recovery?.message ?? explanation}`);
      return state;
    }
    // Every new substantive message supersedes the previous reviewed candidate,
    // including a price question or an unsupported specification.
    pending = null; suspendedDraft = null;
    adviceFocus = null;
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
      const explicit = delta.reject.length ? explicitShoppingItems(text, localCatalog) : null;
      if (explicit) {
        const items = new Map(lastPlan.map(row => [row.productId, row]));
        for (const row of explicit.items) items.set(row.productId, row);
        const allowed = [...items.values()].filter(row => !isShoppingProductRejected(byId.get(row.productId), memory));
        return preview({ ...explicit, items: allowed });
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
    const promise = execute(key, token);
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
  return Object.freeze({ run, confirm, invalidate, edit, preload: hybrid.preload, getState: () => state,
    setRetailer, getConversation: () => memory, getMartenPreferences: () => projectMartenConversation(memory) });
}
