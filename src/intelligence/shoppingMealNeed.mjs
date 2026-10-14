import { extractShoppingDelta, normalizeShoppingText, isShoppingProductRejected, shoppingTargets } from "./shoppingConversation.mjs";
import { stripAssistantGreetingPrefix } from "./localAssistantDialogue.mjs";

// Session-only meal focus. Meal ideas are culinary suggestions, never retailer
// evidence, a priced basket, a portion guarantee or an automatic pack count.
const meals = Object.freeze([
  { id: "omelette", title: "Омлет с томатами", cooking: "quick", ingredients: ["яйца", "томаты"] },
  { id: "pasta", title: "Макароны с томатами и сыром", cooking: "quick", ingredients: ["макароны", "томаты", "сыр"] },
  { id: "oatmeal", title: "Овсянка с молоком и бананом", cooking: "quick", breakfast: true, ingredients: ["овсянка", "молоко", "бананы"] },
  { id: "sandwich", title: "Бутерброды с сыром и томатами", cooking: "none", ingredients: ["хлеб", "сыр", "томаты"] },
  { id: "kefir", title: "Кефир с бананом и хлебом", cooking: "none", snack: true, ingredients: ["кефир", "бананы", "хлеб"] },
  { id: "cold", title: "Хлеб, томаты и яблоки", cooking: "none", snack: true, ingredients: ["хлеб", "томаты", "яблоки"] }
]);
const counts = { одного: 1, одну: 1, двоих: 2, двух: 2, троих: 3, трех: 3, четверых: 4, четырех: 4,
  пятерых: 5, пяти: 5, шестерых: 6, шести: 6, один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5 };
const number = value => /^\d+$/u.test(value) ? Number(value) : counts[value];
const kinds = { завтрак: "Завтрак", обед: "Обед", ужин: "Ужин", перекус: "Перекус" };

function startingKind(value) {
  const match = value.match(/^(?:(?:давай|пожалуйста)\s+)?(?:(?:собери|подбери|предложи|посоветуй|(?:я )?хочу|(?:мне )?нужен|помоги (?:собрать|подобрать))\s+(?:мне\s+)?|что (?:купить|взять) на\s+|(?:я )?хочу что-(?:то|нибудь) на\s+)?(?:(?:сытный|быстрый|легкий|вкусный|нормальный)\s+)*(завтрак|обед|ужин|перекус)(?=$|[\s,.!?])/u);
  return match?.[1] ?? null;
}

export function mealNeedOptions(focus, memory) {
  return meals.filter(meal => meal.cooking === focus.cooking
    && (!meal.breakfast || focus.kind === "завтрак")
    && !meal.ingredients.some(name => isShoppingProductRejected({ name }, memory)))
    .sort((a, b) => Number(Boolean(b.breakfast && focus.kind === "завтрак")) - Number(Boolean(a.breakfast && focus.kind === "завтрак")))
    .slice(0, 3);
}

export function advanceMealNeed(text, current, memory) {
  const value = normalizeShoppingText(stripAssistantGreetingPrefix(text)).replace(/[.!?]+$/u, "");
  const kind = startingKind(value);
  if (!kind && !current) return null;
  if (/^(?:отмени|забудь) (?:ужин|обед|завтрак|перекус|подбор)|^отмена$/u.test(value)) return { kind: "cancel" };
  const delta = JSON.parse(JSON.stringify(extractShoppingDelta(text)));
  if (delta.reset || delta.undo || delta.newGoal) return null;
  if (!kind && /^(?:убери|верни|добавь)\s/u.test(value)) return null;
  const knownCooking = memory.facts.cookingEffort?.origin === "explicit" ? memory.facts.cookingEffort.value : null;
  const focus = kind ? { kind, stage: "intake", people: null, cooking: knownCooking === "minimal" ? "none"
    : knownCooking === "normal" ? "quick" : null,
    budgetMinor: memory.facts.budgetMinor?.value, mealId: null, ingredientIndex: 0 } : { ...current };
  if (["intake", "custom"].includes(current?.stage) && !kind && /^(?:го|да|давай|ок|угу)$/u.test(value)) return { kind: "message", focus, delta };

  const positiveTargets = shoppingTargets(value).filter(target => !delta.reject.includes(target) && !delta.allow.includes(target));
  const minutes = value.match(/(?:готовить|готовк\S*|уложиться|за)\s+(?:до\s+)?(\d{1,3})\s*(?:минут[уыа]?|мин\.?)(?=$|[\s,.])/u)
    ?? value.match(/(?:готовить|готовк\S*)\s+минут\S*\s+(\d{1,3})(?=$|[\s,.])/u);
  const customRequest = kind && (/\s(?:с|из)\s+(?!готовкой(?:$|[\s,.]))/u.test(value) || positiveTargets.length
    || /веган|вегетариан|постн|диет|белков|горяч|сытн/u.test(value) || minutes)
    || current && (positiveTargets.length && /(?:^|\s)(?:с|из)\s/u.test(value) || minutes || /сытн/u.test(value));

  if (current?.stage === "products" && !kind && /^(?:дальше|следующий(?: продукт| ингредиент)?)$/u.test(value)) {
    const meal = meals.find(row => row.id === focus.mealId);
    if (!meal || !mealNeedOptions(focus, memory).some(row => row.id === meal.id)) return { kind: "message", focus: { ...focus, stage: "menu", mealId: null }, delta };
    if (focus.ingredientIndex + 1 >= meal.ingredients.length) return { kind: "complete", focus, delta };
    focus.ingredientIndex++;
    return { kind: "search", focus, query: meal.ingredients[focus.ingredientIndex], delta };
  }
  if (current?.stage === "menu" && !kind) {
    const choice = value.match(/^(?:выбираю (?:блюдо |вариант )?|блюдо |вариант )?([1-9]\d?)$/u);
    const ordinal = { первый: 0, второй: 1, третий: 2 }[value];
    const options = mealNeedOptions(focus, memory);
    const named = options.findIndex(row => normalizeShoppingText(row.title) === value);
    const index = choice ? Number(choice[1]) - 1 : ordinal ?? (named >= 0 ? named : null);
    if (index !== null) {
      const meal = options[index];
      if (!meal) return { kind: "clarification", focus, message: "Такого блюда среди предложенных нет. Напиши его номер или название.", delta };
      return { kind: "search", focus: { ...focus, stage: "products", mealId: meal.id, ingredientIndex: 0 }, query: meal.ingredients[0], delta };
    }
    if (/^(?:го|да|давай|ок)$/u.test(value)) return { kind: "clarification", focus, message: "Какое блюдо выбираешь? Напиши, например, «первый».", delta };
  }

  const peopleMatches = [...value.matchAll(/(?:^|\s)на\s+(одного|одну|двоих|двух|троих|трех|четверых|четырех|пятерых|пяти|шестерых|шести|\d{1,5}(?:\s+(?:человек[а]?|людей|персон[ы]?|взрослых))?)(?![.,]\d)(?!\s*(?:₽|руб(?:лей|ля|ль)?\.?|р\.?)(?=$|[\s,.]))(?=$|[\s,.])/gu)];
  const barePeople = focus.stage === "intake" && !focus.people && /^(?:\d{1,5}|один|одна|два|две|три|четыре|пять)$/u.test(value);
  const me = /(?:^|\s)(?:на одного|только (?:для )?меня|для меня)(?=$|[\s,.])/u.test(value);
  const people = peopleMatches.length ? number(peopleMatches.at(-1)[1].split(/\s/u)[0]) : barePeople ? number(value) : me ? 1 : null;
  const explicitAmounts = [...value.matchAll(/(?:^|[^\d.,])(-?\d{1,12}(?:[.,]\d+)?)\s*(?:₽|руб(?:лей|ля|ль)?\.?)(?=$|[^а-яa-z0-9])/gu)];
  const budgetValue = explicitAmounts.at(-1)?.[1] ?? value.match(/(?:^|\s)(?:до|бюджет(?:ом)?|лимит|не больше)\s*(-?\d{1,12}(?:[.,]\d+)?)(?:\s*(?:₽|руб\S*))?(?=$|[\s,.])/u)?.[1]
    ?? (focus.stage === "intake" && focus.people && focus.cooking && focus.budgetMinor === undefined && /^\d{1,9}$/u.test(value) ? value : null);
  const budgetMinor = budgetValue != null ? Math.round(Number(budgetValue.replace(",", ".")) * 100) : delta.facts.budgetMinor?.value ?? null;
  const unlimited = delta.unset.includes("budgetMinor") || /^(?:без лимита|без ограничения|бюджет не важен)$/u.test(value);
  const cooking = delta.facts.cookingEffort?.value === "minimal" || /^(?:не хочу готовить|готовить не хочу|без плиты|готовить лень|лень готовить|не хочу возиться|без возни)$/u.test(value) ? "none"
    : delta.facts.cookingEffort?.value === "normal" || /^(?:быстро|быстренько|можно (?:быстро )?готовить|с готовкой|быстрая готовка)$/u.test(value) ? "quick" : null;
  const constraints = delta.reject.length || delta.allow.length || delta.unresolved.length || delta.clearUnresolved;
  if (!kind && people === null && budgetMinor === null && !unlimited && !cooking && !constraints && !customRequest) return null;
  if (peopleMatches.length > 1 || /ребен|детей|взросл\S*\s+и\s+\d/u.test(value)) return { kind: "clarification", focus,
    message: "На сколько человек всего подбираем? Здесь подбираю общие блюда; отдельное детское меню нужно уточнять.", delta };
  if (people !== null && (!Number.isSafeInteger(people) || people < 1 || people > 12)) return { kind: "clarification", focus,
    message: "Подбираю один приём пищи на 1–12 человек. Уточни число людей.", delta };
  if (budgetMinor !== null && (!Number.isSafeInteger(budgetMinor) || budgetMinor < 1000 || budgetMinor > 99999900 || /[.,]\d{3}/u.test(budgetValue ?? ""))) {
    delete delta.facts.budgetMinor;
    return { kind: "clarification", focus, message: "Уточни общий бюджет в рублях, например «700 ₽», или напиши «без лимита».", delta };
  }
  if (/на неделю|на \d+ (?:дня|дней)|всю неделю|аллерги|непереносим/u.test(value)) return { kind: "clarification", focus: null,
    message: "Для такого запроса нужны дополнительные условия. Начнём с одного приёма пищи: напиши блюдо или продукты и ограничения, которые нужно учесть.", delta };
  if (people !== null) focus.people = people;
  if (budgetMinor !== null) { focus.budgetMinor = budgetMinor; delta.facts.budgetMinor = { value: budgetMinor, scope: "goal" }; }
  if (unlimited) { focus.budgetMinor = null; if (!delta.unset.includes("budgetMinor")) delta.unset = [...delta.unset, "budgetMinor"]; }
  if (cooking) { focus.cooking = cooking; delta.facts = { ...delta.facts, cookingEffort: { value: cooking === "none" ? "minimal" : "normal", scope: "goal" } }; }
  if (customRequest || current?.stage === "custom") {
    focus.stage = "custom"; focus.mealId = null;
    if (customRequest) focus.requirements = value;
    return { kind: "clarification", focus, message: customMealQuestion(focus), delta };
  }
  focus.stage = focus.people && focus.cooking && focus.budgetMinor !== undefined ? "menu" : "intake";
  focus.mealId = null;
  return { kind: "message", focus, delta };
}

export function mealNeedSummary(focus) {
  return `${kinds[focus.kind]}${focus.people ? ` на ${focus.people} чел.` : ""}${focus.budgetMinor ? `, лимит ${focus.budgetMinor / 100} ₽ на всех` : focus.budgetMinor === null ? ", без лимита" : ""}`;
}

export function mealNeedView(focus, memory) {
  if (focus.stage === "custom") return { headline: "Условия сохранила, уточню подбор.", message: customMealQuestion(focus), choices: [] };
  const summary = mealNeedSummary(focus);
  if (!focus.people) return { headline: "Давай подберём, что поесть.", message: `${summary}. На сколько человек?`, choices: ["На одного", "На двоих", "На троих"] };
  if (!focus.cooking) return { headline: "Поняла, подберём под тебя.", message: `${summary}. Хочешь быстро приготовить или обойтись без готовки?`, choices: ["Быстро", "Без готовки"] };
  if (focus.budgetMinor === undefined) return { headline: "Осталось уточнить бюджет.", message: `${summary}. Какой общий бюджет на этот приём пищи? Можно написать «700 ₽» или «без лимита».`, choices: ["Без лимита"] };
  const options = mealNeedOptions(focus, memory);
  if (!options.length) return { headline: "Нужен другой вариант.", message: `${summary}. Мои простые варианты не подходят под сохранённые отказы. Напиши, какие продукты тебе подходят; отказы сохраняю.`, choices: [] };
  return { headline: "Вот несколько идей под твои условия.", message: `${summary}. ${options.map((meal, i) => `${i + 1}. ${meal.title}${meal.snack && focus.kind !== "перекус" ? " (лёгкий вариант)" : ""}`).join("; ")}. Выбери блюдо — посмотрим его ингредиенты в магазине. Количество упаковок выберем отдельно. Попадание в бюджет проверим по корзине; стоимость блюд пока неизвестна.`,
    choices: options.map((meal, i) => ({ label: `${i + 1}. ${meal.title}`, text: `Выбираю блюдо ${i + 1}` })) };
}

function customMealQuestion(focus) {
  return `${mealNeedSummary(focus)}. Учитываю запрос: «${focus.requirements}». Мои простые идеи пока не проверены под все эти условия, поэтому прежний вариант не подставляю. С какого конкретного продукта начнём? Напиши название и нужный вид, например «готовая курица» или «куриное филе».`;
}

export function mealNeedProductView(focus) {
  const meal = meals.find(row => row.id === focus.mealId);
  if (!meal) return null;
  return { summary: `${mealNeedSummary(focus)}: ${meal.title}. Ингредиент ${focus.ingredientIndex + 1}/${meal.ingredients.length}: ${meal.ingredients[focus.ingredientIndex]}.`,
    next: focus.ingredientIndex + 1 < meal.ingredients.length ? "Следующий ингредиент" : "Завершить просмотр" };
}
