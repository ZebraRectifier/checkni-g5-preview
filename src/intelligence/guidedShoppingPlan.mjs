import { extractShoppingNeedContext } from './shoppingNeedContext.mjs';
import { extractShoppingDelta, isShoppingProductRejected } from './shoppingConversation.mjs';
import { shoppingDialogueNeed } from './shoppingDialogueRecovery.mjs';
import { shoppingLocationRequest } from '../data/shoppingLocations.mjs';

const clean = value => String(value ?? '').normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim().replace(/[.!?]+$/u, '');
// Culinary starting amounts, presented for review; never nutrition requirements,
// retailer identities, stock or a guarantee that this is a complete diet.
const GROUPS = [
  ['mince', 'Фарш', 'фарш', /фарш/u, 100, 'g'],
  ['chicken', 'Куриное филе', 'филе', /(?:курин\S*\s+филе|филе\s+(?:кур|цып))/u, 75, 'g'],
  ['buckwheat', 'Гречка', 'греч', /греч/u, 40, 'g'],
  ['pasta', 'Макароны', 'макарон', /макарон/u, 40, 'g'],
  ['milk', 'Молоко', 'молоко', /молок/u, 200, 'ml'],
  ['eggs', 'Яйца', 'яйц', /яйц|яиц/u, 0.65, 'piece'],
  ['tomatoes', 'Томаты', 'томат', /томат|помидор/u, 100, 'g'],
  ['apples', 'Яблоки', 'яблок', /яблок/u, 150, 'g'],
  ['bananas', 'Бананы', 'банан', /банан/u, 100, 'g'],
  ['curd', 'Творог', 'творог', /творог/u, 80, 'g'],
  ['cheese', 'Сыр', 'сыр', /(?:^|\s)сыр(?:а|у|ом|ы)?(?=$|[\s,.])/u, 30, 'g'],
  ['potatoes', 'Картофель', 'картоф', /картоф/u, 180, 'g'],
  ['carrots', 'Морковь', 'морков', /морков/u, 40, 'g'],
  ['onions', 'Лук', 'лук', /(?:^|\s)лук/u, 30, 'g'],
  ['cabbage', 'Капуста', 'капуст', /капуст/u, 100, 'g'],
  ['oats', 'Овсяные хлопья', 'хлопья', /овсян|овсян\S*\s+хлоп|хлопья\s+овсян/u, 40, 'g'],
  ['oil', 'Подсолнечное масло', 'масло подсолнечное', /подсолнечн\S*\s+масл|масло\s+подсолнечн/u, 12, 'ml'],
  ['flakes', 'Хлопья для каши', 'хлопья', /хлопья\s+(?:гречнев|овсян)|(?:гречнев|овсян)\S*\s+хлопья/u, 40, 'g'],
  ['rice', 'Рис', 'рис', /(?:^|\s)рис(?=$|[\s,.])/u, 40, 'g'],
  ['pork', 'Свинина', 'свин', /свинин/u, 70, 'g'],
  ['yogurt','Йогурт','йогурт',/йогурт/u,80,'g']
].map(([key, label, query, pattern, dailyAmount, dimension]) => ({ key, label, query, pattern, dailyAmount, dimension }));

const ECONOMY_GROUPS = ['mince', 'chicken', 'buckwheat', 'pasta', 'potatoes', 'carrots', 'onions', 'milk', 'eggs', 'apples', 'bananas', 'flakes', 'oil'];
export function weeklyRetailerRequest(text) {
  const value=clean(text),ids=[];
  if(/магнит/u.test(value)&&!/(?:без|не)\s+магнит/u.test(value))ids.push('magnit');
  if(/(?:в|из|и)\s+о['’]?кей|^о['’]?кей$/u.test(value)&&!/(?:без|не)\s+о['’]?кей/u.test(value))ids.push('okey');
  return ids;
}
export function isGuidedEntryRequest(text) {
  return /^(?:собери недорогую корзину|подбери по вкусу и составу)$/u.test(clean(text))
    || /^(?:(?:хочу|нужна|нужны)\s+)?(?:недорог\S*|дешев\S*)\s+(?:корзин|продукт)/u.test(clean(text))
    || /^(?:(?:ну|давай)[,\s]+)?(?:собери|подбери)\s+(?:мне\s+|нам\s+)?(?:(?:недорог\S*|дешев\S*|качественн\S*)\s+)?(?:еду|продукты|покупки|корзину)/u.test(clean(text));
}

export function isGuidedBuildRequest(text) {
  return /^(?:(?:ну|да|давай|пожалуйста)[,\s]+)*(?:собери|собрать|собирай|подбери товары|подобрать товары)(?:\s+(?:мне|нам))?(?:\s+(?:корзину|список|это|по списку|продукты|товары))?$/u.test(clean(text));
}

export function createGuidedShoppingPlan(goal, history, memory) {
  const advice = history.filter(row => row.role === 'assistant').map(row => row.text).join(' ');
  const user = [goal, ...history.filter(row => row.role === 'user').map(row => row.text)].join(' ');
  const source = clean(advice || user);
  const economy = /недорог|дешев|эконом/u.test(clean(goal));
  let groups = economy ? GROUPS.filter(group => ECONOMY_GROUPS.includes(group.key)) : GROUPS.filter(group => group.pattern.test(source));
  if (!groups.length) groups = GROUPS.filter(group => ['mince', 'buckwheat', 'milk', 'eggs', 'tomatoes', 'apples'].includes(group.key));
  if (/фарш/u.test(user) && !groups.some(row => row.key === 'mince')) groups.unshift(GROUPS[0]);
  if (/фрукт/u.test(user) && !groups.some(row => ['apples', 'bananas'].includes(row.key))) groups.push(GROUPS.find(row => row.key === 'apples'));
  const retailers=weeklyRetailerRequest(goal);
  if(retailers.length)for(const key of ['rice','pork','cheese'])if(!groups.some(g=>g.key===key))groups.push(GROUPS.find(g=>g.key===key));
  return { goal: String(goal).slice(0, 300), groups: groups.slice(0, 16).map(row => ({ ...row,
    ...(economy&&row.key==='chicken'&&!/филе/u.test(clean(user))?{label:'Курица',query:'цыплен',allowPoultryCuts:true}:{}) })), retailers, stage: 'intake', mode: economy ? 'economy' : 'balanced',
    location: shoppingLocationRequest(goal), freezer: /морозилк/u.test(clean(goal)) ? true : null,
    question: null, people: memory.facts.peopleCount?.value ?? null, days: memory.facts.shoppingDays?.value ?? null,
    budgetMinor: memory.facts.budgetMinor?.value ?? (economy ? null : undefined), constraintsReviewed: false, rows: [], base: null, scope: null };
}

export function advanceGuidedIntake(plan, text, memory) {
  const value = clean(text), need = shoppingDialogueNeed(text, [{ role: 'assistant', text:
    plan.question === 'people' ? 'На сколько человек?' : plan.question === 'budget' ? 'Какой общий бюджет?' : '' }]),
    delta = JSON.parse(JSON.stringify(extractShoppingDelta(text)));
  const location = shoppingLocationRequest(text);
  const retailers=weeklyRetailerRequest(text);
  if(retailers.length){plan.retailers=retailers;plan.useCurrentStore=true;
    if(/^магнит и о['’]?кей$/u.test(value))plan.location=null;
    for(const key of ['rice','pork','cheese'])if(!plan.groups.some(g=>g.key===key))plan.groups.push({...GROUPS.find(g=>g.key===key)});
    plan.groups=plan.groups.slice(0,16);plan.rows=[];plan.alternatives=[];
  }
  if (location) { plan.location = location; plan.rows = []; plan.alternatives = []; }
  if (value === 'текущий магазин') { plan.useCurrentStore = true; plan.location = null;plan.retailers=[]; }
  if (/есть морозилка|морозилка есть/u.test(value)) plan.freezer = true;
  if (/без точного бюджета|подбери подешевле|без лимита/u.test(value)) {
    plan.budgetMinor = null; delta.unset.push('budgetMinor');
    delta.unresolved = delta.unresolved.filter(row => !/бюджет|лимит/u.test(row));
  }
  if (value === 'подбери подешевле') { plan.mode = 'economy'; if (!plan.location) plan.useCurrentStore = true; }
  // The general food-refusal parser also records unknown "без ..." phrases.
  // This is a recognised budget command, not a dietary restriction.
  if (delta.unset.includes('budgetMinor')) delta.unresolved = delta.unresolved.filter(row => clean(row) !== 'без лимита');
  if (need.clarification) return { issue: need.clarification, delta };
  Object.assign(delta.facts, need.facts);
  const words = { один: 1, одна: 1, двое: 2, двоих: 2, два: 2, трое: 3, троих: 3, три: 3, четверо: 4, четыре: 4 };
  const bare = value.replace(/^на\s+/u, '');
  if (plan.question === 'people' && (/^\d{1,2}$/u.test(bare) || words[bare])) {
    const count = words[bare] ?? Number(bare);
    if (count < 1 || count > 12) return { issue: 'На сколько человек собираем? Здесь можно указать от 1 до 12.', delta };
    delta.facts.peopleCount = { value: count, scope: 'goal' };
  }
  if (plan.question === 'days' && /^\d{1,2}$/u.test(bare)) {
    const count = Number(bare);
    if (count < 1 || count > 31) return { issue: 'На сколько дней нужны покупки? Укажи от 1 до 31.', delta };
    delta.facts.shoppingDays = { value: count, scope: 'goal' };
  }
  if (plan.question === 'budget' && /^(?:до\s+)?\d{1,6}$/u.test(value)) {
    const amount = Number(value.replace(/^до\s+/u, '')) * 100;
    if (amount < 1000 || amount > 99999900) return { issue: 'Укажи общий бюджет в рублях или выбери «Без лимита».', delta };
    delta.facts.budgetMinor = { value: amount, scope: 'goal' };
  }
  plan.people = delta.facts.peopleCount?.value ?? memory.facts.peopleCount?.value ?? plan.people;
  plan.days = delta.facts.shoppingDays?.value ?? memory.facts.shoppingDays?.value ?? plan.days;
  plan.budgetMinor = delta.unset.includes('budgetMinor') ? null : delta.facts.budgetMinor?.value ?? memory.facts.budgetMinor?.value ?? plan.budgetMinor;
  if (plan.question === 'constraints' && (/^(?:ограничений нет|без ограничений|все можно|нет|ничего|ничего не исключать)$/u.test(value)
      || delta.reject.length || delta.allow.length || delta.unresolved.length)) plan.constraintsReviewed = true;
  return { delta };
}

export function guidedIntakeView(plan, memory) {
  const question = !plan.people ? 'people' : !plan.days ? 'days'
    : !plan.useCurrentStore && (plan.mode === 'economy' || plan.location) && (!plan.location || plan.location.unsupported) ? 'location' : plan.budgetMinor === undefined ? 'budget'
    : !plan.constraintsReviewed ? 'constraints' : null;
  plan.question = question;
  const summary = [plan.people && `для ${plan.people} человек`, plan.days && `на ${plan.days} дн.`].filter(Boolean).join(', ').replace(/\.$/u, '');
  const messages = {
    people: `Давай соберём${summary ? ` ${summary}` : ''}. На сколько человек нужны продукты?`,
    days: `Учту ${plan.people} чел. На сколько дней собираем продукты?`,
    location: 'Где закупаемся? Найдём магазины рядом с твоим адресом или геолокацией, выберем радиус и согласуем магазин. Можно также продолжить в текущем каталоге. Точный бюджет необязателен.',
    budget: `Собираем ${summary}. Какой общий бюджет на весь список? Можно написать сумму или «без лимита».`,
    constraints: `Условия помню: ${summary}${plan.location?.landmark ? `, ${plan.location.landmark.name}, до ${plan.location.radiusKm} км по прямой` : ''}${plan.freezer ? ', морозилка есть' : ''}. Какие продукты исключить? Если всё подходит, выбери «Ограничений нет».${plan.mode === 'economy' && plan.budgetMinor == null ? ' Точный бюджет не нужен — ищем доступные варианты среди полученных карточек.' : ''}`
  };
  if (question) return { headline: 'Соберём под тебя.', message: messages[question], conversationChoices:
    question === 'people' ? ['На одного', 'На двоих', 'На троих']
      : question === 'days' ? ['На 3 дня', 'На неделю', 'На две недели']
        : question === 'location' ? ['Найти магазины рядом', 'Текущий магазин', 'Магнит и О’КЕЙ']
          : question === 'budget' ? ['Подбери подешевле', 'Без лимита'] : ['Ограничений нет', 'Без мяса'] };
  const groups = plan.groups.filter(group => guidedGroupAllowed(group, memory));
  return { headline: 'Вот основа списка.', message: `Предлагаю ${groups.map(group => group.label.toLowerCase()).join(', ')}. Подберу конкретные карточки в выбранном каталоге и покажу таблицу. Количества будут ориентировочными — их можно изменить до добавления. Это черновик покупок, а не полный рацион.`,
    conversationChoices: ['Подобрать товары и цены', 'Изменить список'] };
}

export function guidedGroupAllowed(group, memory) {
  return !isShoppingProductRejected({ name: group.label, category: ['mince', 'chicken','pork'].includes(group.key) ? 'Мясо' : '' }, memory);
}

export function guidedGroupMatches(group, card) {
  const title = clean(card?.name);
  // The head noun must be the requested food. A matching stem inside an
  // ingredient, flavour, brand or adjective is not evidence of that family.
  const families = {
    mince: /^фарш(?=$|[\s,])/u,
    chicken: group.allowPoultryCuts?/^(?:(?:филе|голень|бедро)\s+(?:(?:бедра|грудки)\s+)?(?:курин|цыплен)|курин\S*\s+филе)/u
      :/^(?:филе\s+(?:(?:бедра|грудки)\s+)?(?:курин|цыплен)|курин\S*\s+филе)/u,
    buckwheat: /^(?:крупа\s+)?гречнев\S*|^гречка(?=$|[\s,])/u,
    pasta: /^(?:макароны|макаронные изделия)(?=$|[\s,])/u,
    milk: /^молоко(?=$|[\s,])/u,
    eggs: /^(?:куриное\s+)?яйц[ао](?=$|[\s,])/u,
    tomatoes: /^(?:томаты|помидоры)(?=$|[\s,])/u,
    apples: /^яблоки(?=$|[\s,])/u,
    bananas: /^банан(?:ы)?(?=$|[\s,])/u,
    curd: /^творог(?=$|[\s,])/u,
    cheese: /^сыр(?=$|[\s,])/u,
    potatoes: /^картофель(?=$|[\s,])/u,
    carrots: /^морковь(?=$|[\s,])/u,
    onions: /^лук\s+репчат/u,
    cabbage: /^капуста\s+белокочан/u,
    oats: /^(?:хлопья\s+(?:.*\s)?овсяные(?=$|[\s,.])|овсяные\s+хлопья)/u,
    oil: /^(?:масло\s+подсолнечн|подсолнечное\s+масло)/u,
    flakes: /^(?:хлопья\s+(?:.*\s)?(?:овсяные|гречневые)(?=$|[\s,.])|(?:овсяные|гречневые)\s+хлопья)/u,
    rice: /^рис(?=$|[\s,])/u,
    pork: /^(?:свинина(?=$|[\s,])|лопатка\s+свиная(?=$|[\s,]))/u,
    yogurt:/^йогурт(?=$|[\s,])/u
  };
  if (group.key === 'milk' && /детск|ступень|месяц|\d\+/u.test(title)) return false;
  if (group.key === 'chicken' && /запечен|жарен|копчен|гриль|готов|отварн|в сыре|нежность|соус|маринад|паниров/u.test(title)) return false;
  if (group.key === 'pork' && /копчен|варен|жарен|готов|соус|маринад|паниров/u.test(title)) return false;
  if (['tomatoes', 'apples', 'bananas', 'potatoes', 'carrots', 'onions', 'cabbage'].includes(group.key)
      && /в собственном соку|маринован|сушен|вялен|консерв|пюре|чипс|карамел|квашен|жарен|фри(?=$|\s)/u.test(title)) return false;
  if (['oats', 'flakes'].includes(group.key) && /сахар|клубник|яблок|изюм|шоколад/u.test(title)) return false;
  return families[group.key]?.test(title) ?? false;
}

export function guidedEditGroups(plan, text) {
  const value = clean(text);
  if (!/^(?:убери|исключи|добавь|включи|замени)\s/u.test(value)) return false;
  const matches = GROUPS.filter(group => group.pattern.test(value));
  if (!matches.length) return false;
  const remove = /^(?:убери|исключи)/u.test(value);
  const replacement = value.match(/^замени\s+(.+?)\s+на\s+(.+)$/u);
  if (replacement) {
    const old = GROUPS.filter(group => group.pattern.test(replacement[1]));
    const next = GROUPS.filter(group => group.pattern.test(replacement[2]));
    if (!old.length || !next.length) return false;
    plan.groups = plan.groups.filter(group => !old.some(row => row.key === group.key));
    for (const group of next) if (!plan.groups.some(row => row.key === group.key)) plan.groups.push({ ...group });
  } else for (const group of matches) {
    if (remove) plan.groups = plan.groups.filter(row => row.key !== group.key);
    else if (!plan.groups.some(row => row.key === group.key)) plan.groups.push({ ...group });
  }
  plan.groups = plan.groups.slice(0, 16); plan.rows = []; plan.alternatives = []; plan.stage = 'outline';
  return true;
}
