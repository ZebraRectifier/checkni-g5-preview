import { createGuidedShoppingPlan, advanceGuidedIntake, guidedIntakeView, guidedEditGroups, guidedGroupMatches, guidedGroupAllowed,weeklyRetailerRequest } from '../intelligence/guidedShoppingPlan.mjs';
import { validWeeklyCardSource } from '../ports/weeklyRetailCatalogPort.mjs';
import { extractShoppingDelta, isShoppingProductRejected } from '../intelligence/shoppingConversation.mjs';
import { retailSelectionUrl } from '../intelligence/retailProductSelection.mjs';
import { getReviewedRetailBasketProduct } from '../catalog/reviewedRetailBasket.mjs';
import { quoteCatalogDraft, suggestedCatalogQuantity, catalogPurchaseUnit, economicalCatalogCards, rankCatalogDrafts } from '../core/catalogDraft.mjs';
import { extractShoppingNeedContext } from '../intelligence/shoppingNeedContext.mjs';

const clean = value => String(value ?? '').toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim().replace(/[.!?]+$/u, '');
const choices = labels => labels.map(label => ({ label, text: label }));
const view = (headline, message, extra = {}) => ({ status: 'clarification', result: { kind: 'clarification', triggerReason: 'smalltalk', guidedShopping: true },
  presentation: { headline, message, items: [], primaryAction: 'Написать уточнение', mascotState: 'curious', ...extra } });

export function createGuidedShoppingFlow(options) {
  let plan = null, state = null, version = 0;
  const contextKey = () => { try { const scope = options.getContext?.(); return scope?.retailerId && scope?.storeId
    ? JSON.stringify([scope.retailerId, scope.storeId,options.getRetailContextKey?.()??null]) : null; } catch { return null; } };
  const presentIntake = () => {
    const presentation = guidedIntakeView(plan, options.getMemory());
    if (!plan.question) plan.stage = 'outline';
    state = view(presentation.headline, presentation.message, { locationRequested:plan.question==='location',conversationChoices: choices(presentation.conversationChoices) });
    return state;
  };
  const table = (message = '', comparison = null) => {
    plan.requiresReview = false;
    const quote = quoteCatalogDraft(plan.rows, { nowMs: options.now?.() ?? Date.now() });
    const missing = quote.lines.filter(row => !row.addable).map(row => row.group.label);
    const budget = plan.budgetMinor != null && quote.knownSubtotalMinor != null
      ? quote.knownSubtotalMinor > plan.budgetMinor ? ' По найденной части сумма выше бюджета. Можно уменьшить количества или заменить товары.'
        : quote.complete ? ' По указанным наблюдениям список укладывается в бюджет.' : ' Весь список по бюджету ещё не проверен.' : '';
    const messageText = message || `Вот конкретные варианты из каталога ${plan.storeName}. Количества — мой предварительный вариант; меняй их в таблице.`;
    state = view(plan.stage === 'confirmed' ? 'Корзина собрана. Посмотрим магазины?' : 'Посмотри, что получилось.',
      `${messageText}${budget}${missing.length ? ` Ещё нужно подобрать ${missing.length} поз. — список под таблицей.` : ''} Цены показаны на дату наблюдения; наличие неизвестно.`, {
        guidedShopping: { quote, comparison, storeName: plan.storeName, confirmed: plan.stage === 'confirmed',
          mode: plan.mode, location: plan.location, alternatives: plan.alternatives ?? [],
          people: plan.people, days: plan.days },
        conversationChoices: choices(plan.stage === 'confirmed' ? ['Сравнить магазины', 'Изменить список']
          : [quote.basket.length ? missing.length ? 'Добавить найденное' : 'Добавить показанное' : null, 'Сравнить этот список', 'Изменить список'].filter(Boolean))
      });
    if (plan.stage === 'confirmed') state.status = 'success';
    return state;
  };
  function start(goal, history) {
    version++;
    plan = createGuidedShoppingPlan(goal, history, options.getMemory());
    if(options.hasAgreedStore?.()===true&&!plan.location&&!plan.retailers.length)plan.useCurrentStore=true;
    const intake = advanceGuidedIntake(plan, goal, options.getMemory());
    if (!intake.issue) options.updateMemory(intake.delta);
    else return state = view('Уточню условия.', intake.issue);
    return presentIntake();
  }
  const current = (token, isCurrent) => token === version && isCurrent();
  async function load(isCurrent) {
    if (options.getMemory().facts.unresolvedConstraints) return view('Сначала уточним ограничение.', 'В условиях есть непонятая часть. Уточни её или явно отмени перед подбором товаров.');
    let scope = options.getContext?.();
    const key = contextKey();
    if (!key || typeof options.searchCatalog !== 'function') {
      state = view('Список готов, выберем магазин.', 'Открой каталог нужного магазина, затем нажми «Подобрать товары и цены». Условия и список сохраняю.',
        { conversationChoices: choices(['Подобрать товары и цены', 'Изменить список']) }); return state;
    }
    const retailScopes=plan.retailers?.length?options.getRetailContexts?.(plan.retailers)??[]:[];
    if(plan.retailers?.length&&plan.location) return state=view('Уточним охват магазинов.',
      'Для О’КЕЙ есть городской каталог Москвы, расстояние до конкретного магазина неизвестно. Выбери «Магнит и О’КЕЙ» без радиуса или «текущий магазин».');
    const nearby = plan.location?.landmark ? options.getNearbyContexts?.(plan.location) ?? [] : [];
    if (plan.location?.landmark && !nearby.length) return view('Для этого радиуса пока нет каталога.',
      'Условия и список сохранились. Можно выбрать больший радиус до 20 км или написать «текущий магазин».');
    if(plan.retailers?.length&&!retailScopes.length)return state=view('Выберем источники.', 'Каталоги Магнита и О’КЕЙ сейчас не подключены. Список сохранился; выбери текущий магазин.');
    const scopes = retailScopes.length?retailScopes.slice(0,2):nearby.length ? nearby.slice(0, 4) : [scope];
    const token = version;
    const groups = plan.groups.filter(group => guidedGroupAllowed(group, options.getMemory()));
    if (!groups.length) { state = view('Нужен другой состав.', 'Все предложенные продукты исключены. Напиши, что добавить в список.'); return state; }
    state = { status: 'loading' };
    // At most four registered scopes and sixteen groups, three catalogue reads
    // at a time. Existing client deadlines remain; no retailer crawl or retry.
    const drafts = [], deadline = Date.now() + 15000;
    for (const candidateScope of scopes) {
    const rows = new Array(groups.length);
    let nextGroup = 0;
    const worker = async () => {
    while (nextGroup < groups.length) {
      const index = nextGroup++, group = groups[index];
      if (!current(token, isCurrent)) return state;
      if (Date.now() >= deadline) { rows[index] = makeRow(group, [], null); continue; }
      let response = null, timer;
      try { response = await Promise.race([Promise.resolve().then(() => options.searchCatalog(group.query, { limit: 40, scope: candidateScope })),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.min(3500, Math.max(1, deadline - Date.now()))); })]); }
      catch { /* Keep this group visibly unresolved. */ }
      finally { clearTimeout(timer); }
      if (!current(token, isCurrent)) return state;
      if (key !== contextKey()) return;
      const seen = new Set();
      const cards = (response?.kind === 'catalog' && Array.isArray(response.products) ? response.products : []).filter(card => {
        if (!card || typeof card.sourceProductId !== 'string' || card.retailerId !== candidateScope.retailerId
            || card.id !== `retail:${candidateScope.retailerId}:${candidateScope.storeId}:${card.sourceProductId}` || seen.has(card.id)
            || typeof card.name !== 'string' || card.name.length > 300 || !card.name.trim()
            || !Number.isSafeInteger(card.priceMinor) || card.priceMinor <= 0 || card.currency !== 'RUB' || card.availability !== 'unknown'
            || !Number.isFinite(Date.parse(card.observedAt)) || Date.parse(card.observedAt) > (options.now?.() ?? Date.now())
            || !(validWeeklyCardSource(card,candidateScope) || retailSelectionUrl(card.sourceUrl, card.retailerId) && retailSelectionUrl(card.productUrl, card.retailerId, 'productUrlRules'))
            || !guidedGroupMatches(group, card) || isShoppingProductRejected(card, options.getMemory())) return false;
        seen.add(card.id); return true;
      }).slice(0, 40);
      const ranked = plan.mode === 'economy' ? economicalCatalogCards(group, cards, plan.people, plan.days, { nowMs: options.now?.() ?? Date.now() }) : cards;
      const offered = ranked.slice(0, 4);
      const card = offered[0] ?? null;
      rows[index] = makeRow(group, offered, card);
    }
    };
    await Promise.all(Array.from({ length: Math.min(3, groups.length) }, () => worker()));
    if (!current(token, isCurrent)) return state;
    if (key !== contextKey()) { plan.rows = []; plan.stage = 'outline'; return state = view('Магазин изменился.', 'Заново подберём товары для выбранного адреса.', { conversationChoices: choices(['Подобрать товары и цены']) }); }
    drafts.push({ scope: candidateScope, rows });
    }
    const ranked = rankCatalogDrafts(drafts, { nowMs: options.now?.() ?? Date.now() });
    const selected = ranked[0];
    if (nearby.length) {
      if (typeof options.selectStore !== 'function' || options.selectStore(selected.scope) !== true) return state = view('Выберем адрес.', 'Не удалось переключить адрес каталога. Старые карточки не добавлены; список сохранился.');
      scope = options.getContext?.();
      if (scope?.storeId !== selected.scope.storeId || scope?.retailerId !== selected.scope.retailerId) return state = view('Проверим адрес.', 'Адрес подбора изменился. Запусти подбор заново.');
    }
    plan.scope = contextKey(); plan.storeName = selected.scope.storeName ?? selected.scope.displayName ?? selected.scope.retailerId;
    plan.drafts=ranked;plan.alternatives = nearby.length||retailScopes.length ? ranked.map(row => ({ storeName: row.scope.storeName, storeId: row.scope.storeId,
      address: row.scope.storeAddress, distanceKm: row.scope.distanceKm, knownSubtotalMinor: row.quote.knownSubtotalMinor,
      retailerId:row.scope.retailerId,priceScope:row.scope.priceScope,
      found: row.quote.basket.length, requested: groups.length, complete: row.quote.complete, allRecent: row.quote.allRecent,hasEstimates:row.quote.hasEstimates,
      selected: row === selected })) : [];
    plan.rows = selected.rows; plan.base = options.basket.getSnapshot(); plan.stage = 'review';
    return table(plan.mode === 'economy'
      ? `Вот черновик на ${plan.days} дн. для ${plan.people} человек. Учёл фасовку и порции; состав и количества можно поправить.${plan.freezer && groups.some(group => group.key === 'mince') ? ' Фарш можно разделить и заморозить.' : ''}` : '');
  }
  function makeRow(group, cards, card) {
    const reviewed = getReviewedRetailBasketProduct(card);
    return { group, cards, card, quantity: card ? suggestedCatalogQuantity(group, card, plan.people, plan.days) : 1,
      product: card ? reviewed ?? { id: card.id, name: card.name, unit: catalogPurchaseUnit(card)?.approximate?catalogPurchaseUnit(card).label:card.unit } : null };
  }
  function confirm() {
    if (!plan || plan.stage !== 'review') return state;
    if (plan.requiresReview) return table('Вернёмся к списку. Проверь показанные товары и подтверди добавление ещё раз.');
    if (options.getMemory().facts.unresolvedConstraints || plan.rows.some(row => !guidedGroupAllowed(row.group, options.getMemory())
        || row.card && isShoppingProductRejected(row.card, options.getMemory()))) {
      plan.rows = []; plan.stage = 'outline'; return view('Условия изменились.', 'Старый состав не добавлен. Подберём товары заново с учётом ограничений.', { conversationChoices: choices(['Подобрать товары и цены']) });
    }
    if (plan.scope !== contextKey()) { plan.rows = []; plan.stage = 'outline'; state = view('Выбран другой магазин.', 'Старые карточки не добавлены. Подберём товары для нового адреса.', { conversationChoices: choices(['Подобрать товары и цены']) }); return state; }
    const quote = quoteCatalogDraft(plan.rows, { nowMs: options.now?.() ?? Date.now() });
    if (!quote.basket.length) return table('Нет проверенных упаковок для добавления. Можно изменить список или найти товар вручную.');
    const base = plan.base, byId = new Map(base.map(row => [row.id, { ...row }]));
    for (const row of quote.basket) {
      const prior = byId.get(row.id);
      if (prior && (prior.name !== row.name || prior.unit !== row.unit || prior.quantity + row.quantity > 99)) return table('Количество или упаковка конфликтует с корзиной. Проверь текущую корзину; ничего не добавлено.');
      byId.set(row.id, { ...row, quantity: (prior?.quantity ?? 0) + row.quantity });
    }
    const applied = options.basket.replaceReviewedBasket(base, [...byId.values()]);
    if (!applied.applied) { plan.base = options.basket.getSnapshot(); return table('Пока мы обсуждали список, корзина изменилась. Проверь таблицу и подтверди добавление ещё раз.'); }
    plan.stage = 'confirmed';
    return table('Добавлены только показанные товары и количества. Можно открыть корзину или сравнить выбранные адреса.');
  }
  async function handle(text, isCurrent = () => true) {
    if (!plan) return null;
    version++;
    const value = clean(text), delta = extractShoppingDelta(text);
    if (delta.reset || delta.newGoal || delta.undo || /^(?:отмена|отмени подбор|забудь список)$/u.test(value)) { plan = null; return null; }
    if (plan.stage === 'intake') {
      const result = advanceGuidedIntake(plan, text, options.getMemory());
      if (!options.updateMemory(result.delta)) return view('Уточним условия.', 'Условий уже много. Предыдущие сохранились; напиши уточнение короче.');
      if (result.issue || options.getMemory().facts.unresolvedConstraints) return view('Уточню один момент.', result.issue ?? 'Есть непонятое ограничение. Уточни его перед подбором.');
      const next = presentIntake();
      return plan.mode === 'economy' && !plan.question ? load(isCurrent) : next;
    }
    if (/завет(?:ы|ах|ов)\s+ильича|^текущий магазин$/u.test(value)||weeklyRetailerRequest(value).length) {
      const result = advanceGuidedIntake(plan, text, options.getMemory());
      if (!options.updateMemory(result.delta)) return view('Уточним условия.', 'Напиши условия короче.');
      plan.rows = []; plan.stage = 'intake'; return presentIntake();
    }
    if (extractShoppingNeedContext(text).recognized || Object.hasOwn(delta.facts, 'budgetMinor') || delta.unset.includes('budgetMinor')) {
      const result = advanceGuidedIntake(plan, text, options.getMemory());
      if (result.issue || !options.updateMemory(result.delta)) return view('Уточним условия.', result.issue ?? 'Предыдущие условия сохранились. Напиши уточнение короче.');
      plan.rows = []; plan.alternatives = []; plan.stage = 'outline'; return presentIntake();
    }
    if (value === 'изменить список') return view('Давай поправим.', `Сейчас в списке: ${plan.groups.map(row => row.label).join(', ')}. Напиши, например, «убери молоко», «добавь бананы» или «замени куриное филе на фарш».`, { conversationChoices: choices(['Подобрать товары и цены']) });
    if (guidedEditGroups(plan, text)) {
      if (delta.reject.length || delta.allow.length) options.updateMemory(delta);
      return presentIntake();
    }
    if (delta.reject.length || delta.allow.length || delta.unresolved.length || delta.clearUnresolved) {
      options.updateMemory(delta); plan.rows = []; plan.stage = 'outline';
      if (options.getMemory().facts.unresolvedConstraints) return view('Уточню ограничение.', 'Не все условия удалось разобрать. Уточни их перед подбором; прежний состав не добавляю.');
      return presentIntake();
    }
    if (/^(?:подобрать товары и цены|подбери товары и цены|обновить подбор)$/u.test(value)) return load(isCurrent);
    const storeChoice=value.match(/^показать вариант (magnit|okey)$/u);
    if(storeChoice&&plan.stage==='review'){
      const draft=plan.drafts?.find(d=>d.scope.retailerId===storeChoice[1]);
      if(!draft)return table('Такой вариант ещё не проверен.');
      plan.rows=draft.rows;plan.storeName=draft.scope.storeName;
      plan.alternatives=plan.alternatives.map(a=>({...a,selected:a.storeId===draft.scope.storeId}));
      return table('Показываю выбранный каталог. Отсутствующие в срезе позиции остаются неизвестными.');
    }
    if (/^(?:добавить показанное|добавить найденное|подтверждаю|применить изменения)$/u.test(value)) return confirm();
    const count = value.match(/^количество\s+(\d{1,2})\s*:\s*(\d{1,3})$/u);
    const choice = value.match(/^для позиции\s+(\d{1,2})\s+вариант\s+(\d)$/u);
    if ((count || choice) && plan.stage === 'review') {
      const index = Number((count ?? choice)[1]) - 1, row = plan.rows[index];
      if (!row) return table('Такой позиции в таблице нет.');
      if (plan.scope !== contextKey()) return load(isCurrent);
      if (count) {
        const quantity = Number(count[2]);
        if (quantity < 1 || quantity > 99) return table('Можно указать от 1 до 99 единиц выбранной упаковки или весовой меры.');
        row.quantity = quantity;
      } else {
        const card = row.cards[Number(choice[2]) - 1];
        if (!card) return table('Такого варианта нет среди полученных карточек.');
        const replacement = makeRow(row.group, row.cards, card);
        const before = catalogPurchaseUnit(row.card), after = catalogPurchaseUnit(card);
        if (before && after && before.dimension === after.dimension && before.amount === after.amount) replacement.quantity = row.quantity;
        plan.rows[index] = replacement;
      }
      plan.alternatives = [];
      return table('Изменение учтено в черновике. Корзина изменится после подтверждения.');
    }
    if (/^(?:сравнить этот список|сравнить магазины|сравни магазины|где дешевле)$/u.test(value)) {
      if (!plan.rows.length) return load(isCurrent);
      if (plan.scope !== contextKey()) return load(isCurrent);
      const quote = quoteCatalogDraft(plan.rows, { nowMs: options.now?.() ?? Date.now() });
      if (!quote.basket.length) return table('Для сравнения пока нет точно выбранных товаров.');
      const token = version, scope = contextKey(), base = JSON.stringify(options.basket.getSnapshot());
      state = { status: 'loading' };
      let result = null, timer;
      const comparedBasket = plan.stage === 'confirmed' ? options.basket.getSnapshot() : quote.basket;
      try { result = await Promise.race([Promise.resolve().then(() => options.compareBasket?.(comparedBasket)),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 15000); })]); }
      catch { /* A failed comparison cannot invent a cheaper store. */ }
      finally { clearTimeout(timer); }
      if (!current(token, isCurrent)) return state;
      if (scope !== contextKey() || base !== JSON.stringify(options.basket.getSnapshot())) return table('Условия сравнения изменились. Запусти сравнение заново.');
      return table('Сверили точные товары по выбранным адресам. Для неподтверждённых соответствий цена остаётся неизвестной.', result ?? { kind: 'unavailable' });
    }
    plan.requiresReview = true;
    return null;
  }
  return { start, handle, confirm, hideReview: () => { if (plan) plan.requiresReview = true; }, getState: () => state, active: () => Boolean(plan) };
}
