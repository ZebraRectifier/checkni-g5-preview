// Bounded shopping memory. Storage projects explicit preferences only;
// transcripts, identity, commercial facts and inferred hypotheses stay out.
export const CONVERSATION_LIMITS = Object.freeze({ facts: 16, rejected: 32, wishes: 16, exceptions: 8, bytes: 8192 });
export const normalizeShoppingText = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
export const shoppingTargetLabel = key => ({ meat: "мясо и птица", chicken_mince: "куриный фарш", chicken: "курица", nuggets: "наггетсы", chebureki: "чебуреки", eggs: "яйца", rice: "рис", pasta: "макароны", oatmeal: "овсянка", potatoes: "картофель", onions: "лук", carrots: "морковь", cabbage: "капуста", milk: "молоко", kefir: "кефир", vegetables: "овощи", fruit: "фрукты", tomatoes: "томаты", bread: "хлеб", cheese: "сыр", apples: "яблоки", bananas: "бананы", pelmeni: "пельмени", beef_mince: "говяжий фарш" }[key] ?? key);

const TERMS = Object.freeze({
  meat: /(?:^|[^а-я])мяс(?:о|а|у|ом|ные|ной|ная|ное|ных|ным|ную)(?=$|[^а-я])/u,
  chicken_mince: /курин\S*\s+фарш|фарш\s+(?:из\s+куриц\S*|курин\S*)/u,
  chicken: /куриц\S*|цыплен\S*|курин\S*\s+филе|филе\s+курин\S*/u,
  nuggets: /наггетс\S*/u, chebureki: /чебурек\S*/u, eggs: /яйц\S*|яиц(?=$|[^а-я])/u,
  rice: /рис(?:а|у|ом)?(?=$|[^а-я])/u, pasta: /макарон\S*|паст(?:а|у|ы)(?=$|[^а-я])/u,
  oatmeal: /овсян\S*|овсян\S*\s+хлопь\S*/u, potatoes: /карто\S*/u,
  onions: /лук(?:а|у|ом)?(?=$|[^а-я])/u, carrots: /морков\S*/u, cabbage: /капуст\S*/u,
  milk: /молок\S*/u, kefir: /кефир\S*/u, vegetables: /овощ\S*/u,
  fruit: /фрукт\S*/u, tomatoes: /томат\S*|помидор\S*/u, bread: /хлеб\S*/u,
  cheese: /сыр(?:а|у|ом|ы|ов|ам|ами|ах)?(?=$|[^а-я])/u, apples: /яблок\S*/u,
  bananas: /банан\S*/u, pelmeni: /пельмен\S*/u, beef_mince: /говяж\S*\s+фарш|фарш\s+говяж\S*/u
});
const VEGETABLES = new Set(["potatoes", "onions", "carrots", "cabbage", "tomatoes"]);
const FRUITS = new Set(["apples", "bananas"]);
const MEAT_TARGETS = new Set(["chicken", "chicken_mince", "beef_mince", "nuggets", "chebureki", "pelmeni"]);
const NEGATIVE_REQUEST = /(?:^|[^а-я])(?:не\s+(?:хочу|нуж(?:ен|н[аоы]?)|ем|люблю|нрав[ия]\S*|подход\S*|переношу|добавляй|клади|включай)|не надо|убери|исключи|надоел\S*|терпеть не могу)/u;
const REFUSAL = /(?:^|[^а-я])(?:не\s+(?:хочу|нуж(?:ен|н[аоы]?)|ем|люблю|нрав[ия]\S*|подход\S*|переношу|добавляй|клади|включай)|не надо|убери|исключи|надоел\S*|терпеть не могу|без\s+)/u;
const CLAUSE_PREDICATE = /хочу|нуж(?:ен|н[аоы])|можно|верни|возьми|добавь|не добавляй|не клади|не включай|не надо|не люблю|не нрав[ия]\S*|не подход\S*|не ем|убери|исключи|надоел\S*|(?:^|\s)(?:оставь|оставить|сохрани)(?=$|[\s,])/u;
const PERMISSION_QUESTION = /(?:^|[\s,])(?:что|как(?:ой|ая|ое|ие|ую|ого|их)?|где|когда|сколько|почему|зачем|чем)\s+(?:\S+\s+){0,3}можно(?=$|[\s,])|(?:^|\s)можно\s+ли(?=$|\s)/u;
const EXPLICIT_COUNT = /(?:^|\s)(?:\d{1,3}|один|одна|одну|два|две|три|четыре|пять|пару)(?=$|\s)/u;
export function shoppingClauses(value) {
  return value.split(/[;!?\n]+|(?<!\d)\.|\.(?!\d)|,?\s+(?:но|зато|хотя)\s+/u).filter(Boolean).flatMap(clause => {
    const output = [];
    let remaining = clause;
    let start = 0;
    for (;;) {
      const comma = remaining.indexOf(",", start);
      if (comma === -1) break;
      if (/\d/u.test(remaining[comma - 1] ?? "") && /\d/u.test(remaining[comma + 1] ?? "")) { start = comma + 1; continue; }
      const left = remaining.slice(0, comma);
      const right = remaining.slice(comma + 1);
      // Keep comma-separated lists under one final predicate; split two complete acts.
      const repeatedTarget = shoppingTargets(right).some(target => shoppingTargets(left).includes(target));
      if (CLAUSE_PREDICATE.test(right) && (CLAUSE_PREDICATE.test(left) || EXPLICIT_COUNT.test(left) || repeatedTarget)) {
        output.push(left); remaining = right; start = 0;
      } else start = comma + 1;
    }
    output.push(remaining);
    return output;
  });
}

export function shoppingTargets(text) {
  const value = normalizeShoppingText(text);
  const targets = Object.entries(TERMS).filter(([, re]) => re.test(value)).map(([key]) => key);
  // Chicken mince is a distinct requested identity, never chicken fillet.
  return targets.includes("chicken_mince") ? targets.filter(key => key !== "chicken") : targets;
}

export function productShoppingTargets(product) {
  const name = normalizeShoppingText(product?.name).replace(/(?:для|к)\s+мяс(?:а|у)(?=$|[\s,.])/gu, "");
  const keys = shoppingTargets(name).filter(key => key !== "meat");
  if (keys.includes("chicken_mince")) keys.push("chicken");
  const category = normalizeShoppingText(product?.category);
  if (!/без\s+мяса/u.test(name) && (TERMS.meat.test(name) || keys.some(key => MEAT_TARGETS.has(key))
    || /говядин|свинин|индейк|бекон|ветчин|колбас|сосиск|баранин|теляти|ягнен|крольчат/u.test(name)
    || /(?:^|[^а-я])(?:утк[ауои]|гусь|гуся|гуси|кролик[а-я]*|перепел(?:а|ку|ки|ок)?)(?=$|[^а-я])/u.test(name)
    || ["мясо", "птица", "мясо и птица"].includes(category))) keys.push("meat");
  if (category === "овощи" || keys.some(key => VEGETABLES.has(key))) keys.push("vegetables");
  if (category === "фрукты" || keys.some(key => FRUITS.has(key))) keys.push("fruit");
  return [...new Set(keys)];
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
export function createShoppingConversation() {
  return deepFreeze({ revision: 0, goal: 0, facts: {}, rejected: {}, exceptions: {}, wishes: {}, hypotheses: [] });
}
const fact = (value, turn, scope = "goal", origin = "explicit", confidence = "high") => ({ value, scope, origin, confidence, evidenceTurn: turn });
const active = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value.scope !== "turn"));
const persistent = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value.scope === "conversation"));

export function extractShoppingDelta(text) {
  const value = normalizeShoppingText(text);
  const delta = { facts: {}, unset: [], reject: [], rejectScopes: {}, allow: [], want: [], reset: false, newGoal: false, undo: false, dissatisfaction: false, directions: null, unresolved: [], clearUnresolved: /отменяю непонят\S* условие|забудь нераспознан\S* условие/u.test(value) };
  if (/^(?:забудь (?:все|мои) предпочтения|сбрось предпочтения|начнем с чистого листа)$/u.test(value)) delta.reset = true;
  if (/^(?:отмени последнее|откат|верни как было)$/u.test(value)) delta.undo = true;
  if (/новая корзина|новая задача|другая корзина|для гостей|на праздник/u.test(value)) delta.newGoal = true;
  const budget = [...value.matchAll(/(?:^|[^\d])(\d{1,6})\s*(?:₽|руб(?:лей|ля|ль)?\.?|р\.?)(?=$|[^а-яa-z0-9])/gu)].at(-1);
  if (budget && Number(budget[1]) >= 10) delta.facts.budgetMinor = { value: Number(budget[1]) * 100, scope: "goal" };
  if (/без лимита|бюджет (?:больше )?не важен|отмени бюджет/u.test(value)) delta.unset.push("budgetMinor");
  if (/магазин (?:любой|не важен)|отмени магазин/u.test(value)) delta.unset.push("retailer");
  if (/забудь (?:про )?готовку/u.test(value)) delta.unset.push("cookingEffort");
  const scope = /сегодня|в этой корзине|на этот раз/u.test(value) ? "goal" : "conversation";
  if (/не\s+(?:особо\s+)?(?:люблю|хочу)\s+готовить|готовить.{0,12}не\s+(?:люблю|хочу)|без готовк|минимум готовк/u.test(value)) delta.facts.cookingEffort = { value: "minimal", scope };
  if (/готовить (?:теперь )?можно|можно готовить|(?<!не )люблю готовить|готовить не против/u.test(value)) delta.facts.cookingEffort = { value: "normal", scope };
  if (/не хочу без готовки/u.test(value)) delta.facts.cookingEffort = { value: "normal", scope };
  if (/конкретн.{0,14}(?:марк|бренд)|(?:марк|бренд)\S* важн/u.test(value)) delta.facts.brandStyle = { value: "specific", scope: /в этом ответе/u.test(value) ? "turn" : scope };
  if (/(?:марк|бренд).{0,16}(?:не важн|без разницы)|любая марка|любой бренд/u.test(value)) delta.facts.brandStyle = { value: "any", scope };
  if (/не хочу.{0,15}конкретн.{0,14}(?:марк|бренд)/u.test(value)) delta.facts.brandStyle = { value: "any", scope };
  if (/получше|разнообразнее|побогаче/u.test(value)) delta.facts.budgetStyle = { value: "better", scope: "goal" };
  else if (/подешевле|дешев(?:ый|ую|ые|ая|ое)|эконом/u.test(value) || /^(?:давай )?дешевле$/u.test(value)) delta.facts.budgetStyle = { value: "cheaper", scope: "goal" };
  const store = value.match(/(?:в |магазин\s*:?\s*|магазине\s+)(чижик\S*|магнит\S*|пятерочк\S*|метро|metro|лента|ленте|окей|ашан\S*|вкусвилл\S*)/u);
  if (store) delta.facts.retailer = { value: store[1].replace(/[^а-яa-z]+$/u, ""), scope: "goal" };
  const location = value.match(/(?:локация|город|район|адрес)\s*:?\s*([^;.!?]{1,80})/u)
    ?? value.match(/(заветы ильича|пушкино|московская область)/u);
  if (location) delta.facts.location = { value: location[1].trim(), scope: "goal" };
  delta.dissatisfaction = /не знаю.{0,20}(?:не нравится|не так)|все не то|случайн\S* набор/u.test(value);
  if (/без готовк|холодн\S* набор/u.test(value)) delta.directions = "cold";
  if (/разогре[вт]|готов\S* блюд/u.test(value)) delta.directions = "heat";
  if (/быстр\S* готовк|один горячий|фарш/u.test(value)) delta.directions = "quick";

  const addTargets = (phrase, kind) => {
    const targets = shoppingTargets(phrase);
    if (targets.length) delta[kind].push(...targets);
    else delta.unresolved.push(phrase.trim().slice(0, 80));
  };
  const clauses = shoppingClauses(value);
  for (let clause of clauses) {
    const askedAsQuestion = value.replace(/\s+\?/gu, "?").includes(`${clause.trim()}?`);
    const permissionQuestion = PERMISSION_QUESTION.test(clause) || askedAsQuestion;
    const replacement = clause.match(/вместо\s+(.+?)\s+(?:хочу|нужен|возьми|давай|добавь)\s+(.+)/u);
    if (replacement) {
      addTargets(replacement[1], "reject");
      for (const target of shoppingTargets(replacement[1])) delta.rejectScopes[target] = /никогда|вообще не ем|всегда без/u.test(clause) ? "conversation" : "goal";
      const [wanted, ...rest] = replacement[2].split(",");
      addTargets(wanted, "want");
      if (rest.length) clauses.push(rest.join(","));
      continue;
    }
    const except = clause.match(/кроме\s+(.+)/u);
    if (except) { addTargets(except[1], "allow"); clause = clause.slice(0, except.index); }
    if (REFUSAL.test(clause)) {
      // "You suggested it; now it doesn't suit the dish?" is a question,
      // not a new dietary refusal. Explicit personal refusals/commands and
      // every other restriction in the clause still take the strict path.
      if (askedAsQuestion && /не\s+подход[а-я]*/u.test(clause)
        && !REFUSAL.test(clause.replace(/не\s+подход[а-я]*/gu, ""))
        && !/(?<![а-я])(?:мне|нам)(?![а-я])|добавь|возьми|купи|верни|исключи/u.test(clause)) continue;
      const without = clause.match(/без\s+(.+)/u);
      const otherRefusal = NEGATIVE_REQUEST.test(clause);
      const phrase = without && !otherRefusal ? without[1] : clause;
      let targets = shoppingTargets(phrase);
      if (targets.includes("meat") && /красн\S*\s+мяс|жирн\S*\s+мяс|переработан\S*\s+мяс|не\s+без\s+мяса/u.test(clause)) {
        targets = targets.filter(key => key !== "meat");
        delta.unresolved.push(clause.trim().slice(0, 80));
      }
      // A final refusal applies to every member of a list. A known member
      // must not silently hide an unsupported neighbour.
      const sharedRefusal = !without && clause.match(/^(.+?)\s+(?:не\s+(?:добавляй|клади|включай)|убери|исключи|не надо)(?:\s+пожалуйста)?$/u);
      const listed = sharedRefusal ? sharedRefusal[1].split(/\s*,\s*|\s+и\s+/u).map(part => part.trim()).filter(Boolean) : [];
      if (listed.length > 1) for (const part of listed) {
        const nonFoodContext = /^(?:на|для|в|по|до|радиус|бюджет|город|адрес|магазин|слушай|пожалуйста)(?=$|[\s.,])/u.test(part);
        if (!shoppingTargets(part).length && !nonFoodContext) delta.unresolved.push(part.slice(0, 80));
      }
      delta.reject.push(...targets);
      for (const target of targets) delta.rejectScopes[target] = /никогда|вообще не ем|всегда без/u.test(clause) ? "conversation" : "goal";
      if (without && !otherRefusal && targets.length) {
        // A known member must not hide an unsupported neighbouring refusal:
        // "без яиц и глютена" still needs clarification about gluten.
        const parts = without[1].split(/\s*,\s*|\s+и\s+/u).map(part => part.trim()).filter(Boolean);
        if (parts.length > 1) for (const part of parts) {
          if (!shoppingTargets(part).length && !/^(?:готовк[аиу]|пожалуйста|пж|плиз|спасибо)$/u.test(part)) {
            delta.unresolved.push(`без ${part.replace(/^без\s+/u, "")}`.slice(0, 80));
          }
        }
      }
      // Do not reinterpret unknown explicit refusals as a recommendation.
      if (!targets.length && !/готов|бренд|марк|самое дешев|не знаю/u.test(clause)) {
        delta.unresolved.push((without && !otherRefusal ? `без ${without[1]}` : clause).trim().slice(0, 80));
      }
    } else if (/верни|передумал|снова хочу/u.test(clause)
      || /можно/u.test(clause) && !permissionQuestion) {
      // Asking what is possible is not permission to reintroduce a refused
      // food, nor an unknown restriction that should block the next question.
      addTargets(clause, "allow");
    } else if (/хочу|добавь|еще|нуж(?:ен|н[аоы])|возьми/u.test(clause)) {
      const targets = shoppingTargets(clause);
      delta.want.push(...targets);
    }
  }
  delta.rejectionScope = /никогда|вообще не ем|всегда без/u.test(value) ? "conversation" : "goal";
  delta.recognized = delta.reset || delta.undo || delta.newGoal || delta.clearUnresolved || delta.dissatisfaction || Boolean(delta.directions)
    || delta.unset.length > 0 || Object.keys(delta.facts).length > 0 || delta.reject.length > 0 || delta.allow.length > 0 || delta.want.length > 0 || delta.unresolved.length > 0;
  return deepFreeze(delta);
}

export function updateShoppingConversation(current, delta) {
  const turn = current.revision + 1;
  if (delta.reset) return { state: deepFreeze({ ...createShoppingConversation(), revision: turn, goal: current.goal + 1 }), overflow: false };
  const next = {
    revision: turn, goal: current.goal + Number(delta.newGoal),
    facts: delta.newGoal ? persistent(current.facts) : active(current.facts),
    rejected: delta.newGoal ? persistent(current.rejected) : active(current.rejected),
    exceptions: delta.newGoal ? persistent(current.exceptions) : active(current.exceptions),
    wishes: delta.newGoal ? persistent(current.wishes) : active(current.wishes), hypotheses: delta.newGoal || delta.directions ? [] : current.hypotheses.filter(entry => entry.value === "structure_mismatch" && turn - entry.evidenceTurn < 4)
  };
  if (next.facts.cookingEffort?.origin === "inferred") delete next.facts.cookingEffort;
  if (delta.clearUnresolved) delete next.facts.unresolvedConstraints;
  if (delta.unresolved.length) next.facts.unresolvedConstraints = fact([...new Set([...(next.facts.unresolvedConstraints?.value ?? []), ...delta.unresolved])], turn);
  for (const [key, entry] of Object.entries(delta.facts)) next.facts[key] = fact(entry.value, turn, entry.scope);
  for (const key of delta.unset ?? []) delete next.facts[key];
  for (const target of delta.reject) {
    next.rejected[target] = fact(true, turn, delta.rejectScopes?.[target] ?? delta.rejectionScope);
    delete next.exceptions[target]; delete next.wishes[target];
  }
  for (const target of delta.allow) {
    delete next.rejected[target];
    next.exceptions[target] = fact(true, turn);
    next.wishes[target] = fact(true, turn);
  }
  for (const target of delta.want) {
    delete next.rejected[target];
    next.exceptions[target] = fact(true, turn);
    next.wishes[target] = fact(true, turn);
  }
  if (delta.directions) next.facts.direction = fact(delta.directions, turn);
  const preparationEvidence = ["eggs", "rice", "pasta", "potatoes", "oatmeal"].map(key => next.rejected[key]).filter(Boolean);
  const preparationTurn = Math.max(0, ...preparationEvidence.map(entry => entry.evidenceTurn));
  const preparationTriggered = current.facts.cookingEffort?.origin === "inferred" || delta.reject.some(key => ["eggs", "rice", "pasta", "potatoes", "oatmeal"].includes(key));
  if (!next.facts.cookingEffort && preparationTriggered && !(delta.unset ?? []).includes("cookingEffort") && preparationEvidence.length >= 3 && turn - preparationTurn < 4) {
    next.facts.cookingEffort = fact("minimal", preparationTurn, "goal", "inferred", "medium");
  }
  const structureTurn = next.rejected.nuggets && next.rejected.chebureki
    ? Math.max(next.rejected.nuggets.evidenceTurn, next.rejected.chebureki.evidenceTurn) : 0;
  if (delta.allow.some(key => key === "nuggets" || key === "chebureki")) next.hypotheses = [];
  if (delta.dissatisfaction || (structureTurn && turn - structureTurn < 4)) {
    next.hypotheses = [fact("structure_mismatch", delta.dissatisfaction ? turn : structureTurn, "goal", "inferred", "medium")];
  }
  if (next.facts.cookingEffort?.origin === "inferred") next.hypotheses.push(fact("minimal_cooking", preparationTurn, "goal", "inferred", "medium"));
  const overflow = ["facts", "rejected", "wishes", "exceptions"].some(key => Object.keys(next[key]).length > CONVERSATION_LIMITS[key])
    || new TextEncoder().encode(JSON.stringify(next)).length > CONVERSATION_LIMITS.bytes;
  return { state: overflow ? current : deepFreeze(next), overflow };
}

export function isShoppingProductRejected(product, state) {
  const targets = productShoppingTargets(product);
  // Wanting cheese/rice never authorises a meat filling. An explicit meat
  // member exception (for example chicken) can narrow the broad refusal.
  const name = normalizeShoppingText(product?.name);
  const unexceptedMeat = /свинин|баранин|ягнен|теляти|индейк|утк[ауи]|гусь|гуся|кролик|крольчат|перепел/u.test(name)
    || targets.includes("beef_mince") && !state.exceptions.beef_mince
    || /говядин|говяж/u.test(name) && !targets.includes("beef_mince");
  const meatException = !unexceptedMeat && targets.some(key => MEAT_TARGETS.has(key) && state.exceptions[key]);
  if (targets.includes("meat") && state.rejected.meat && !meatException) return true;
  const broad = new Set(["vegetables", "fruit", "chicken", "meat"]);
  const specific = targets.filter(key => !broad.has(key));
  if (specific.some(key => state.rejected[key])) return true;
  if (specific.some(key => state.exceptions[key])) return false;
  return targets.some(key => state.rejected[key] && !(key === "meat" && meatException));
}

export function projectMartenConversation(state) {
  // The persona receives only typed, explicit preferences. Hypotheses stay in the shopping layer.
  return Object.fromEntries(["cookingEffort", "brandStyle", "budgetStyle"].filter(key => state.facts[key]?.origin === "explicit").map(key => [key, state.facts[key].value]));
}
