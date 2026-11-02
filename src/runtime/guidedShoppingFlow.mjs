import { createGuidedShoppingPlan, advanceGuidedIntake, guidedIntakeView, guidedEditGroups, guidedGroupMatches, guidedGroupAllowed,weeklyRetailerRequest } from '../intelligence/guidedShoppingPlan.mjs';
import { validWeeklyCardSource,createWeeklyRetailCatalogPort,PEREKRESTOK_WEEKLY_SCOPE } from '../ports/weeklyRetailCatalogPort.mjs';
import { extractShoppingDelta, isShoppingProductRejected } from '../intelligence/shoppingConversation.mjs';
import { retailSelectionUrl } from '../intelligence/retailProductSelection.mjs';
import { getReviewedRetailBasketProduct } from '../catalog/reviewedRetailBasket.mjs';
import { quoteCatalogDraft, suggestedCatalogQuantity, suggestedCatalogQuantityForIntent, catalogPurchaseUnit, economicalCatalogCards, rankCatalogDrafts, compareCatalogDraftAlternatives } from '../core/catalogDraft.mjs';
import { extractShoppingNeedContext } from '../intelligence/shoppingNeedContext.mjs';

const clean = value => String(value ?? '').toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim().replace(/[.!?]+$/u, '');
const choices = labels => labels.map(label => ({ label, text: label }));
const view = (headline, message, extra = {}) => ({ status: 'clarification', result: { kind: 'clarification', triggerReason: 'smalltalk', guidedShopping: true },
  presentation: { headline, message, items: [], primaryAction: 'Написать уточнение', mascotState: 'curious', ...extra } });

export function createGuidedShoppingFlow(options) {
  let plan = null, state = null, version = 0;
  let quantityEdits = new Map();
  const editedQuantity = (edit,card) => edit.intent ? suggestedCatalogQuantityForIntent(card,edit.intent)
    : card?.id===edit.cardId ? {quantity:edit.quantity,quantityReview:false} : {quantity:null,quantityReview:true};
  const deliveryCatalog=options.deliveryCatalog??createWeeklyRetailCatalogPort();
  const contextKey = () => { try { const scope = options.getContext?.();
    return JSON.stringify([scope?.retailerId ?? null, scope?.storeId ?? null, options.getRetailContextKey?.() ?? null]);
  } catch { return null; } };
  const presentIntake = () => {
    const presentation = guidedIntakeView(plan, options.getMemory());
    if (!plan.question) plan.stage = 'outline';
    state = view(presentation.headline, presentation.message, { locationRequested:plan.question==='location',conversationChoices: choices(presentation.conversationChoices) });
    return state;
  };
  const table = (message = '', comparison = null) => {
    plan.requiresReview = false;
    if(plan.alternatives?.length)plan.alternatives=plan.alternatives.map(alternative=>{
      const draft=plan.drafts?.find(d=>d.scope.storeId===alternative.storeId);
      const currentQuote=draft?quoteCatalogDraft(draft.rows,{nowMs:options.now?.()??Date.now()}):null;
      return currentQuote?{...alternative,knownSubtotalMinor:currentQuote.knownSubtotalMinor,
        complete:currentQuote.complete,allRecent:currentQuote.allRecent,hasEstimates:currentQuote.hasEstimates,
        found:currentQuote.basket.length}:alternative;
    });
    const quote = quoteCatalogDraft(plan.rows, { nowMs: options.now?.() ?? Date.now() });
    const missing = quote.lines.filter(row => !row.addable).map(row => row.group.label);
    const budget = plan.budgetMinor != null && quote.knownSubtotalMinor != null
      ? quote.knownSubtotalMinor > plan.budgetMinor ? ' По найденной части сумма выше бюджета. Можно уменьшить количества или заменить товары.'
        : quote.complete ? ' По указанным наблюдениям список укладывается в бюджет.' : ' Весь список по бюджету ещё не проверен.' : '';
    const messageText = message || `Вот конкретные варианты из каталога ${plan.storeName}. Количества — мой предварительный вариант; меняй их в таблице.`;
    const deliveryAlternatives=plan.alternatives?.some(a=>a.retailerId==='perekrestok');
    state = view(plan.stage === 'confirmed' ? 'Корзина собрана. Посмотрим магазины?' : 'Посмотри, что получилось.',
      `${messageText}${budget}${missing.length ? ` Ещё нужно подобрать ${missing.length} поз. — список под таблицей.` : ''} Цены показаны на дату наблюдения; наличие неизвестно.`, {
        guidedShopping: { quote, comparison, storeName: plan.storeName, confirmed: plan.stage === 'confirmed',
          draftComparison:deliveryAlternatives?compareCatalogDraftAlternatives(plan.drafts,{nowMs:options.now?.()??Date.now()}):null,
          mode: plan.mode, location: plan.location, alternatives: plan.alternatives ?? [],
          people: plan.people, days: plan.days },
        conversationChoices: choices(plan.stage === 'confirmed' ? [deliveryAlternatives?'Сравнить варианты':'Сравнить магазины', 'Изменить список']
          : [quote.basket.length ? missing.length ? 'Добавить найденное' : 'Добавить показанное' : null, 'Сравнить этот список', 'Изменить список'].filter(Boolean))
      });
    if (plan.stage === 'confirmed') state.status = 'success';
    return state;
  };
  function start(goal, history) {
    version++;
    quantityEdits = new Map();
    plan = createGuidedShoppingPlan(goal, history, options.getMemory());
    if(options.hasAgreedStore?.()===true&&!plan.location&&!plan.retailers.length)plan.useCurrentStore=true;
    const intake = advanceGuidedIntake(plan, goal, options.getMemory());
    if (!intake.issue) options.updateMemory(intake.delta);
    else return state = view('Уточню условия.', intake.issue);
    return presentIntake();
  }
  const current = (token, isCurrent) => token === version && isCurrent();
  async function load(isCurrent, retainedDrafts = []) {
    if (options.getMemory().facts.unresolvedConstraints) return view('Сначала уточним ограничение.', 'В условиях есть непонятая часть. Уточни её или явно отмени перед подбором товаров.');
    let scope = options.getContext?.();
    const key = contextKey();
    if(plan.retailers?.length>2)return state=view('Выберем два каталога.', 'Сейчас можно сопоставить два каталога за один подбор. Напиши, например, «Магнит и Пятёрочка» или «Магнит и О’КЕЙ». Список продуктов сохраняю.');
    const retailScopes=plan.retailers?.length?[
      ...(options.getRetailContexts?.(plan.retailers)??[]).filter(s=>s.retailerId!=='perekrestok'),
      ...(plan.retailers.includes('perekrestok')?[PEREKRESTOK_WEEKLY_SCOPE]:[])
    ]:[];
    if(plan.retailers?.includes('perekrestok')&&plan.retailers.includes('magnit')
      &&(scope?.retailerId!=='magnit'||!retailScopes.some(s=>s.retailerId==='magnit'&&s.storeId===scope.storeId)))
      return state=view('Сначала выберем адрес Магнита.', 'Открой нужный Магнит и повтори подбор. Перекрёсток подключён как каталог доставки Яндекс Еды с Большого Овчинниковского переулка, 16; доступность доставки нужно проверить отдельно.',
        {conversationChoices:choices(['Подобрать товары и цены'])});
    if (!key || (!retailScopes.length && (!scope?.retailerId || !scope?.storeId)) || typeof options.searchCatalog !== 'function') {
      state = view('Список готов, выберем магазин.', 'Открой каталог нужного магазина, затем нажми «Подобрать товары и цены». Условия и список сохраняю.',
        { conversationChoices: choices(['Подобрать товары и цены', 'Изменить список']) }); return state;
    }
    if(plan.retailers?.length&&plan.location) return state=view('Уточним охват магазинов.',
      plan.retailers.includes('perekrestok')?'Перекрёсток здесь — один каталог доставки с Большого Овчинниковского переулка, 16. Он не подтверждает магазин или доставку в твоём радиусе. Для сравнения этих каталогов укажи «Магнит и Перекрёсток» без радиуса; адрес Магнита сначала выбери на сайте.':
      plan.retailers.includes('pyaterochka')?'Для Пятёрочки есть акции Москвы, расстояние до конкретного магазина неизвестно. Выбери «Пятёрочка» без радиуса или «текущий магазин».':
      'Для О’КЕЙ есть городской каталог Москвы, расстояние до конкретного магазина неизвестно. Выбери «Магнит и О’КЕЙ» без радиуса или «текущий магазин».');
    const nearby = plan.location?.landmark ? options.getNearbyContexts?.(plan.location) ?? [] : [];
    if (plan.location?.landmark && !nearby.length) return view('Для этого радиуса пока нет каталога.',
      'Условия и список сохранились. Можно выбрать больший радиус до 20 км или написать «текущий магазин».');
    if(plan.retailers?.length&&!retailScopes.length)return state=view('Выберем источники.', 'Запрошенные каталоги сейчас не подключены. Список сохранился; выбери текущий магазин.');
    const scopes = retailScopes.length?retailScopes.slice(0,2):nearby.length ? nearby.slice(0, 4) : [scope];
    const token = version;
    const groups = plan.groups.filter(group => guidedGroupAllowed(group, options.getMemory()));
    if (!groups.length) { state = view('Нужен другой состав.', 'Все предложенные продукты исключены. Напиши, что добавить в список.'); return state; }
    state = { status: 'loading' };
    // At most four registered scopes and sixteen groups, three catalogue reads
    // at a time. Existing client deadlines remain; no retailer crawl or retry.
    const drafts = [], deadline = Date.now() + 15000;
    for (const candidateScope of scopes) {
    // Adding a catalogue must not re-fetch and overwrite an already reviewed
    // draft. Its original cards and observation times remain visible; Core
    // independently re-evaluates freshness when quoting/comparing them.
    const retained = retainedDrafts.find(draft => draft.scope.retailerId === candidateScope.retailerId
      && draft.scope.storeId === candidateScope.storeId && draft.rows.length === groups.length
      && draft.rows.every((row,index) => row.group.key === groups[index].key));
    if (retained) { drafts.push(retained); continue; }
    const rows = new Array(groups.length);
    let nextGroup = 0;
    const worker = async () => {
    while (nextGroup < groups.length) {
      const index = nextGroup++, group = groups[index];
      if (!current(token, isCurrent)) return state;
      if (Date.now() >= deadline) { rows[index] = makeRow(group, [], null); continue; }
      let response = null, timer;
      try { response = await Promise.race([Promise.resolve().then(() => candidateScope.retailerId==='perekrestok'
        ? deliveryCatalog.search(group.query,{limit:40,scope:candidateScope})
        : options.searchCatalog(group.query, { limit: 40, scope: candidateScope })),
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
    const edit = quantityEdits.get(group.key);
    const edited = edit ? editedQuantity(edit,card) : null;
    return { group, cards, card, quantity: edited?.quantity ?? (card ? suggestedCatalogQuantity(group, card, plan.people, plan.days) : 1),
      ...(edit?.intent ? {quantityIntent:edit.intent} : {}),
      quantityReview: Boolean(edit && card && edited.quantityReview),
      product: card ? reviewed ?? { id: card.id, name: card.name, unit: catalogPurchaseUnit(card)?.approximate?catalogPurchaseUnit(card).label:card.unit } : null };
  }
  function showRetailer(retailerId) {
    if(plan.scope!==contextKey())return table('Адрес на сайте изменился. Обнови подбор для выбранного адреса; старые количества сохранились.');
    const draft = plan.drafts?.find(row => row.scope.retailerId === retailerId);
    if (!draft || !draft.rows.some(row => row.card)) return table('В этом каталоге пока нет подходящих карточек. Предыдущий список и количества сохранились.');
    plan.rows = draft.rows; plan.storeName = draft.scope.storeName;
    plan.alternatives = (plan.alternatives ?? []).map(row => ({ ...row, selected: row.storeId === draft.scope.storeId }));
    return table(plan.rows.some(row=>row.quantityReview)
      ? 'В другом магазине фасовки отличаются. Твои количества сохранены в прежнем варианте; здесь проверь и задай количество для отличающихся упаковок. Суммы разных количеств не сравниваю.'
      : 'Показываю выбранный каталог. Условия и нужное количество сохранены; число упаковок зависит от фасовки. Наличие неизвестно.');
  }
  function confirm() {
    if (!plan || plan.stage !== 'review') return state;
    if (plan.rows.some(row=>row.quantityReview)) return table('Фасовка изменилась. Задай количество для отличающейся упаковки перед добавлением; прежний вариант сохранился.');
    if (plan.requiresReview) return table('Вернёмся к списку. Проверь показанные товары и подтверди добавление ещё раз.');
    if (options.getMemory().facts.unresolvedConstraints || plan.rows.some(row => !guidedGroupAllowed(row.group, options.getMemory())
        || row.card && isShoppingProductRejected(row.card, options.getMemory()))) {
      plan.rows = []; plan.stage = 'outline'; return view('Условия изменились.', 'Старый состав не добавлен. Подберём товары заново с учётом ограничений.', { conversationChoices: choices(['Подобрать товары и цены']) });
    }
    if (plan.scope !== contextKey()) { plan.rows = []; plan.stage = 'outline'; state = view('Выбран другой магазин.', 'Старые карточки не добавлены. Подберём товары для нового адреса.', { conversationChoices: choices(['Подобрать товары и цены']) }); return state; }
    const at=options.now?.()??Date.now();
    if(plan.rows.some(row=>row.card?.priceScope==='city-promotion'&&at-Date.parse(row.card.observedAt)>86400000)){
      plan.rows=[];plan.stage='outline';return state=view('Акции нужно обновить.', 'Наблюдению больше суток. Корзина сохранилась; подберём товары заново по актуальному каталогу.',
        {conversationChoices:choices(['Подобрать товары и цены','Текущий магазин'])});
    }
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
    plan.confirmedBasket=JSON.stringify(options.basket.getSnapshot());
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
    const retailerFollowup = /^(?:а\s+)?(?:в\s+)?(?:магните?|перекрест(?:ок|ке)|о['’]?кей|пятерочке?)$/u.test(value)
      ? weeklyRetailerRequest(value)[0] : null;
    if (retailerFollowup && plan.stage === 'review') {
      if (plan.scope !== contextKey()) return table('Адрес на сайте изменился. Обнови подбор для выбранного адреса; старые количества сохранились.');
      if (plan.drafts?.some(draft=>draft.scope.retailerId===retailerFollowup)) return showRetailer(retailerFollowup);
      const prior = { rows:plan.rows, drafts:plan.drafts, alternatives:plan.alternatives, scope:plan.scope,
        storeName:plan.storeName, base:plan.base, stage:plan.stage, retailers:plan.retailers };
      const retailers = [...new Set([...(plan.drafts??[]).map(draft=>draft.scope.retailerId),retailerFollowup])];
      if (retailers.length>2) return table('За один раз сравниваем два каталога. Текущие варианты сохранились; уточни нужную пару.');
      plan.retailers = retailers;
      const token = version;
      await load(isCurrent,prior.drafts??[]);
      if (!current(token,isCurrent)) return state;
      const next = plan.drafts?.find(draft=>draft.scope.retailerId===retailerFollowup);
      if (!next?.rows.some(row=>row.card)) {
        Object.assign(plan,prior);
        return table('Не удалось подобрать товары второго магазина. Первый черновик и твои количества сохранились; можно повторить позже.');
      }
      return showRetailer(retailerFollowup);
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
    const storeChoice=value.match(/^показать вариант (magnit|okey|pyaterochka|perekrestok)$/u);
    if(storeChoice&&plan.stage==='review'){
      return showRetailer(storeChoice[1]);
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
        row.quantityReview = false;
        const unit=catalogPurchaseUnit(row.card);
        const intent=unit&&!unit.approximate&&['g','ml','piece'].includes(unit.dimension)
          ?{dimension:unit.dimension,amount:unit.amount*quantity}:null;
        const edit = {quantity,cardId:row.card?.id,intent};
        quantityEdits.set(row.group.key,edit);
        if(intent) row.quantityIntent=intent; else delete row.quantityIntent;
        for (const draft of plan.drafts??[]) for (const other of draft.rows) {
          if (other===row || other.group.key!==row.group.key || !other.card) continue;
          if(intent) other.quantityIntent=intent; else delete other.quantityIntent;
          const resolved=editedQuantity(edit,other.card);
          if(resolved.quantity!==null)other.quantity=resolved.quantity;
          other.quantityReview=resolved.quantityReview;
        }
      } else {
        const card = row.cards[Number(choice[2]) - 1];
        if (!card) return table('Такого варианта нет среди полученных карточек.');
        const replacement = makeRow(row.group, row.cards, card);
        const before = catalogPurchaseUnit(row.card), after = catalogPurchaseUnit(card);
        if (before && after && before.dimension === after.dimension && before.amount === after.amount) replacement.quantity = row.quantity;
        plan.rows[index] = replacement;
      }
      return table('Изменение учтено в черновике. Корзина изменится после подтверждения.');
    }
    if (/^(?:сравнить этот список|сравнить магазины|сравни магазины|сравнить варианты|сравни(?:ть)? с другим магазином|где дешевле)$/u.test(value)) {
      if (!plan.rows.length) return load(isCurrent);
      if (plan.scope !== contextKey()) return load(isCurrent);
      if(plan.stage==='confirmed'&&plan.alternatives?.some(a=>a.retailerId==='perekrestok')
        &&plan.confirmedBasket!==JSON.stringify(options.basket.getSnapshot())){
        plan.alternatives=[];return table('Корзина изменилась после подбора. Старые варианты больше не описывают её состав; обнови подбор перед сравнением.');
      }
      if(plan.alternatives?.some(a=>a.retailerId==='perekrestok'))
        return table('Сопоставляю варианты по одним продуктовым группам. Марки и фасовки могут отличаться — открой каждый вариант перед добавлением. Доставку и сборы в сумму не включаю.');
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
