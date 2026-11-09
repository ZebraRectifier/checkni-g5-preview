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
  ['sourcream', 'Сметана', 'сметана', /сметан/u, 30, 'g'],
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
  ['bread','Хлеб','хлеб',/хлеб/u,100,'g'],
  ['kefir','Кефир','кефир',/кефир/u,200,'ml'],
  ['yogurt','Йогурт','йогурт',/йогурт/u,80,'g']
].map(([key, label, query, pattern, dailyAmount, dimension]) => ({ key, label, query, pattern, dailyAmount, dimension }));

const ECONOMY_GROUPS = ['mince', 'chicken', 'buckwheat', 'pasta', 'potatoes', 'carrots', 'onions', 'milk', 'eggs', 'apples', 'bananas', 'flakes', 'oil'];
export function weeklyRetailerRequest(text) {
  const value=clean(text),ids=[];
  if(/магнит/u.test(value)&&!/(?:без|не)\s+магнит/u.test(value))ids.push('magnit');
  if(/перекрест(?:ок|к[аеу])/u.test(value)&&!/(?:без|не)\s+перекрест(?:ок|к[аеу])/u.test(value))ids.push('perekrestok');
  if(/(?:в|из|и)\s+о['’]?кей|^о['’]?кей$/u.test(value)&&!/(?:без|не)\s+о['’]?кей/u.test(value))ids.push('okey');
  if(/пятерочк/u.test(value)&&!/(?:без|не)\s+пятерочк/u.test(value))ids.push('pyaterochka');
  return ids;
}
export function isGuidedEntryRequest(text) {
  return /^(?:собери недорогую корзину|подбери по вкусу и составу)$/u.test(clean(text))
    || /^(?:(?:мне|нам)\s+)?(?:нужн[аы]|хочу)\s+(?:(?:недорог\S*|дешев\S*)\s+)?(?:ед[ау]|продукты|покупки|корзину)(?:\s|$)/u.test(clean(text))
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
  if (memory.facts.cookingEffort?.origin === 'explicit' && memory.facts.cookingEffort.value === 'minimal')
    for (const key of ['bread','kefir','curd','cheese']) if (!groups.some(g=>g.key===key)) groups.push(GROUPS.find(g=>g.key===key));
  const retailers=weeklyRetailerRequest(goal);
  if(retailers.length)for(const key of retailers.includes('perekrestok')?['rice','cheese']:['rice','pork','cheese'])if(!groups.some(g=>g.key===key))groups.push(GROUPS.find(g=>g.key===key));
  if (memory.facts.cookingEffort?.origin === 'explicit' && memory.facts.cookingEffort.value === 'minimal')
    groups.sort((a,b)=>Number(guidedGroupAllowed(b,memory))-Number(guidedGroupAllowed(a,memory)));
  return { goal: String(goal).slice(0, 300), groups: groups.slice(0, 16).map(row => ({ ...row,
    ...(economy&&row.key==='chicken'&&!/филе/u.test(clean(user))?{label:'Курица',query:'цыпл',allowPoultryCuts:true}:{}) })), retailers, stage: 'intake', mode: economy ? 'economy' : 'balanced',
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
    if(/^(?:магнит|перекресток|о['’]?кей|пятерочка)(?: и (?:магнит|перекресток|о['’]?кей|пятерочка))*$/u.test(value))plan.location=null;
    for(const key of retailers.includes('perekrestok')?['rice','cheese']:['rice','pork','cheese'])if(!plan.groups.some(g=>g.key===key))plan.groups.push({...GROUPS.find(g=>g.key===key)});
    plan.groups=plan.groups.slice(0,16);plan.rows=[];plan.alternatives=[];
  }
  if (location) { plan.location = location; plan.rows = []; plan.alternatives = []; }
  if (value === 'текущий магазин') { plan.useCurrentStore = true; plan.location = null;plan.retailers=[]; }
  if (/есть морозилка|морозилка есть/u.test(value)) plan.freezer = true;
  const deferBudget = plan.question === 'budget' && /^(?:(?:бюджет|сумму)\s+)?(?:пока\s+)?(?:не решил(?:а)?|не знаю|не определил(?:а)?(?:сь)?)(?:\s+пока)?[.!]?$/u.test(value);
  if (/без точного бюджета|подбери подешевле|без лимита/u.test(value) || deferBudget) {
    plan.budgetMinor = null; delta.unset.push('budgetMinor');
    delta.unresolved = delta.unresolved.filter(row => !/бюджет|лимит/u.test(row));
  }
  if (value === 'подбери подешевле') { plan.mode = 'economy'; if (!plan.location) plan.useCurrentStore = true; }
  // The general food-refusal parser also records unknown "без ..." phrases.
  // This is a recognised budget command, not a dietary restriction.
  if (delta.unset.includes('budgetMinor')) delta.unresolved = delta.unresolved.filter(row => clean(row) !== 'без лимита');
  if (need.clarification) return { issue: need.clarification, delta };
  Object.assign(delta.facts, need.facts);
  if (delta.facts.cookingEffort?.value === 'minimal')
    for (const key of ['bread','kefir','curd','cheese']) if (!plan.groups.some(g=>g.key===key)) plan.groups.push({...GROUPS.find(g=>g.key===key)});
  const words = { один: 1, одна: 1, двое: 2, двоих: 2, два: 2, трое: 3, троих: 3, три: 3, четверо: 4, четыре: 4, пятеро: 5, пять: 5, шестеро: 6, шесть: 6, семеро: 7, семь: 7, восьмеро: 8, восемь: 8, девятеро: 9, девять: 9, десятеро: 10, десять: 10, одиннадцать: 11, двенадцать: 12 };
  const bare = value.replace(/^на\s+/u, '');
  if (plan.question === 'people' && (/^\d{1,2}$/u.test(bare) || words[bare])) {
    const count = words[bare] ?? Number(bare);
    if (count < 1 || count > 12) return { issue: 'На сколько человек собираем? Здесь можно указать от 1 до 12.', delta };
    delta.facts.peopleCount = { value: count, scope: 'goal' };
  }
  const dayWords = { один:1, два:2, три:3, четыре:4, пять:5, шесть:6, семь:7, восемь:8, девять:9,
    десять:10, одиннадцать:11, двенадцать:12, тринадцать:13, четырнадцать:14, пятнадцать:15,
    шестнадцать:16, семнадцать:17, восемнадцать:18, девятнадцать:19, двадцать:20, тридцать:30 };
  const dayAnswer = bare.replace(/\s+(?:день|дня|дней)$/u, '');
  const compoundDays = /^(двадцать|тридцать) (один|два|три|четыре|пять|шесть|семь|восемь|девять)$/u.exec(dayAnswer);
  const spokenDays = compoundDays ? dayWords[compoundDays[1]] + dayWords[compoundDays[2]] : dayWords[dayAnswer];
  if (plan.question === 'days' && (/^\d{1,2}$/u.test(dayAnswer) || spokenDays !== undefined)) {
    const count = spokenDays ?? Number(dayAnswer);
    if (count < 1 || count > 31) return { issue: 'На сколько дней нужны покупки? Укажи от 1 до 31.', delta };
    delta.facts.shoppingDays = { value: count, scope: 'goal' };
  }
  // Interpret abbreviated amounts only in the pending budget question, never
  // as household size, quantities or a price supplied by the model.
  if (plan.question === 'budget') {
    const amountText = value.replace(/^(?:до|примерно|около)\s+/u, '').replace(/\s*(?:рублей|рубля|рубль|руб\.?|₽)$/u, '');
    const thousands = /^(.*?)\s*тыс(?:яча|ячи|яч|\.)?$/u.exec(amountText)
      ?? /^тыс(?:яча|ячи|яч|\.)?\s+(.+)$/u.exec(amountText);
    if (thousands) {
      const wordsForAmount = { ...dayWords, одна:1, две:2, одной:1, двух:2, трех:3, четырех:4,
        пяти:5, шести:6, семи:7, восьми:8, девяти:9, десяти:10 };
      const raw = thousands[1].trim();
      const factor = wordsForAmount[raw] ?? (/^\d{1,3}(?:[.,]\d{1,2})?$/u.test(raw) ? Number(raw.replace(',', '.')) : null);
      if (factor !== null) {
        const amount = Math.round(factor * 100000);
        if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 99999900)
          return { issue: 'Укажи общий бюджет в рублях или выбери «Без лимита».', delta };
        delta.facts.budgetMinor = { value: amount, scope: 'goal' };
      }
    }
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
    people: 'На сколько человек нужны продукты?',
    days: 'На сколько дней собираем продукты?',
    location: 'Где закупаемся? Напиши город, район или ближайшее метро.',
    budget: 'Какой общий бюджет на весь список? Можно пока без точной суммы.',
    constraints: `${summary ? `Понял: ${summary}. ` : ''}${plan.freezer ? 'Учёл: морозилка есть. ' : ''}Какие продукты исключить? Есть особые пожелания?`
  };
  if (question) return { headline: 'Соберём под тебя.', message: messages[question], conversationChoices:
    question === 'people' ? ['На одного', 'На двоих', 'На троих']
      : question === 'days' ? ['На 3 дня', 'На неделю', 'На две недели']
        : question === 'location' ? ['Найти магазины рядом', 'Текущий магазин', 'Магнит и О’КЕЙ']
          : question === 'budget' ? ['Подбери подешевле', 'Без лимита'] : ['Ограничений нет', 'Без мяса'] };
  const groups = plan.groups.filter(group => guidedGroupAllowed(group, memory));
  return { headline: 'Вот основа списка.', message: `Подберу конкретные карточки ${groups.length} групп продуктов. Количества можно поправить перед добавлением. Это черновик покупок, а не полный рацион.`,
    conversationChoices: ['Подобрать товары и цены', 'Изменить список'] };
}

export function guidedGroupAllowed(group, memory) {
  const cooking = memory.facts.cookingEffort;
  if (cooking?.origin === 'explicit' && cooking.value === 'minimal'
    && ['mince','chicken','pork','buckwheat','pasta','rice','eggs','potatoes','oats','flakes'].includes(group.key)) return false;
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
    pasta: /^(?:макароны|макаронные изделия|изделие макаронное)(?=$|[\s,])/u,
    milk: /^молоко(?=$|[\s,])/u,
    sourcream: /^сметана(?=$|[\s,])/u,
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
    rice: /^(?:рис(?=$|[\s,])|крупа\s+рисов)/u,
    pork: /^(?:свинина(?=$|[\s,])|лопатка\s+свиная(?=$|[\s,]))/u,
    bread:/^(?:хлеб|батон)(?=$|[\s,])/u,
    kefir:/^кефир(?=$|[\s,])/u,
    yogurt:/^йогурт(?=$|[\s,])/u
  };
  if (group.key === 'milk' && /детск|ступень|месяц|\d\+/u.test(title)) return false;
  if (group.key === 'chicken' && /запечен|жарен|копчен|гриль|готов|отварн|в сыре|нежность|соус|маринад|паниров/u.test(title)) return false;
  if (group.key === 'pork' && /копчен|варен|жарен|тушен|консерв|готов|соус|маринад|паниров/u.test(title)) return false;
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

// Restore only known grocery groups; persisted requests never supply executable patterns.
export function guidedGroupByKey(key) {
  const group = GROUPS.find(row => row.key === key);
  return group ? { ...group } : null;
}

// Candidate grocery families only; the source anchor is revalidated on every comparison.
export function guidedGroupsForCard(card) {
  return GROUPS.flatMap(group=>guidedGroupMatches(group,card)?[{...group}]
    :group.key==='chicken'&&guidedGroupMatches({...group,allowPoultryCuts:true},card)?[{...group,allowPoultryCuts:true}]:[])
    .filter(group=>group.key!=='oats');
}
