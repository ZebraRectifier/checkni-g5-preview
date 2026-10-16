import { parseLocalBasketText } from "./localBasketParser.mjs";
import { planLocalSegments } from "./localIntentPlanner.mjs";
import { extractShoppingDelta, normalizeShoppingText, shoppingClauses, shoppingTargets, shoppingTargetLabel } from "./shoppingConversation.mjs";
import { stripAssistantGreetingPrefix } from "./localAssistantDialogue.mjs";
import { shoppingReferenceSubject } from "./shoppingProductReference.mjs";

// A subject is a conversational reference, never an admitted basket identity.
// The separate volatile advice history retains the actual displayed exchange.
export function shoppingAdviceFocus(text) {
  const value = normalizeShoppingText(stripAssistantGreetingPrefix(text));
  const targets = shoppingTargets(value).slice(0, 2);
  const genericSubject = /^(?:а\s+)?(?:как\s+(?:правильно\s+)?выбрать|како[йея]\s+выбрать|какие\s+выбрать)\s+([^?!.;]{1,80})/u.exec(value)?.[1]
    ?.replace(/\s+(?:для|на|к)\s+.+$/u, "").trim();
  const subject = shoppingReferenceSubject(value) ?? (!targets.length ? genericSubject : null) ?? null;
  const topic = /состав|бренд|марк|вес|объем|упаковк/u.test(value) ? "facts"
    : /отлич|разниц|сравн/u.test(value) ? "comparison"
    : /выб|како[йея]|какие/u.test(value) && (targets.length || subject) ? "selection"
    : /готов|поесть|перекус|ужин|завтрак|обед/u.test(value) ? "meal" : "general";
  return Object.freeze({ topic, targets: Object.freeze(targets), subject });
}

export function resolveShoppingAdviceFollowup(text, focus) {
  const value = normalizeShoppingText(stripAssistantGreetingPrefix(text)).replace(/[.!?]+$/u, "");
  const purpose = /^(?:а\s+)?(?:для|на|к|в)\s+.{1,100}$/u.test(value);
  const another = /^(?:а\s+)?(?:другой|другая|другое|другие|еще вариант|что еще)(?:\s+вариант)?$/u.test(value);
  const attribute = /^(?:а\s+)?(?:что (?:с|насчет) (?:состава|составом|бренда|веса)|како[йея] (?:у него |у нее |там )?(?:состав|бренд|марка|вес)|сколько (?:там )?грамм)$/u.test(value);
  const difference = /^(?:а\s+)?(?:чем (?:они|эти) отличаются|в чем (?:их )?разница)$/u.test(value);
  const storage = /^(?:а\s+)?(?:(?:как|сколько) (?:его |ее |их |это )?хранить(?: после (?:открытия|вскрытия))?|хранить (?:его |ее |их |это )?(?:как|сколько)|(?:как|сколько) (?:он|она|они|оно) хран(?:ится|ятся)|после (?:открытия|вскрытия))$/u.test(value);
  const exclusion = /^без\s+.{1,80}$/u.test(value);
  const ambiguousExclusion = /^(?:а\s+)?(?:(?:если|можно)\s+)?без\s+(?:этого|него|нее|них|такого|такой|всего этого)$/u.test(value);
  if (ambiguousExclusion) return { kind: "clarification", exclusion: true, message: "Какой именно продукт исключаем? Назови его, чтобы я не убрала что-то другое." };
  // Contextual language stays read-only. Explicit edits, commands and commercial
  // questions keep their existing deterministic routes before this resolver.
  const conversational = /^(?:а\s+)?(?:если|можно ли|можно|у меня|у нас|дома\s+(?:есть|только)|с ним|с ней|с ними|это\s+(?:для|на)|нет[,\s]+я\s+(?:имел|имела|имею)\s+в\s+виду|давай\s+лучше\s+про)(?=$|[\s,])/u.test(value)
    || /^(?:а\s+)?(?:суп|котлеты|начинка|жарить|запекать|варить|тушить|разогреть|свежая|замороженная|свежую|замороженную|ломтики|намазка|цельный кусок)$/u.test(value)
    || /^(?:а\s+)?(?:како[йея]|какие)\s+(?:из них\s+)?(?:лучше|подойдут)\s+(?:для|на|в)\s+.{1,80}$/u.test(value);
  // A plural adjective can omit the product already under discussion:
  // "зелёные можно?", "чем красные отличаются от зелёных?". Require an
  // actual question and no newly named food, rather than interpreting a
  // permission statement or a different product as the old advice subject.
  const descriptiveQuestion = /\?\s*$/u.test(text) && !shoppingTargets(value).length
    && /^(?:а\s+)?(?:[а-я]+(?:ые|ие)\s+(?:тоже\s+)?можно|чем\s+[а-я]+(?:ые|ие)\s+отличаются\s+от\s+[а-я]+(?:ых|их))$/u.test(value);
  const commercial = /цен[ауы]|стоим|сто[ия]т|скидк|акци|дешев|налич|доставк|заказ|где|магнит|глобус|метро|пятерочк|перекресток/iu.test(value);
  const command = /новая\s+(?:корзина|задача)|другая\s+корзина|сбрось|забудь|отмени|откат|верни\s+как|перестрой|пересобери|обнови\s+корзину|(?:^|[,;.!?]\s*|\sи\s)(?:а\s+)?(?:добавь|положи|убери|удали|замени|возьми|купи|собери|закажи)(?=$|\s)/iu.test(value);
  const adviceExplanation = /^(?:а\s+)?(?:почему|зачем)(?=$|\s)/u.test(value)
    && !/корзин|набор|магазин|адрес|побед|сравнен|итог|сумм|стоим|дешев|выгод/u.test(value);
  const mincePurpose = focus?.topic === "selection" && focus.subject === "фарш" && /^(?:котлеты|соус|начинка)$/u.test(value);
  const heating = focus?.topic === "selection" && focus.subject === "готовую еду" && /^(?:без (?:разогрева|готовки)|(?:только )?разогреть|(?:в )?микроволновк[ае])$/u.test(value);
  if (focus && (conversational || descriptiveQuestion || adviceExplanation) && !commercial && !command && !mincePurpose && !heating) {
    const correction = /^(?:нет[,\s]+я\s+(?:имел|имела|имею)\s+в\s+виду|давай\s+лучше\s+про)\s+(.+)$/u.exec(value);
    const nextFocus = correction ? shoppingAdviceFocus(`Как выбрать ${correction[1]}?`) : focus;
    const subject = nextFocus.targets.map(shoppingTargetLabel).join(" и ") || nextFocus.subject;
    const anchored = subject ? `Про ${subject}: ${text}` : text;
    return { kind: "question", text: anchored.length <= 300 ? anchored : text, readOnly: true,
      ...(adviceExplanation ? { adviceExplanation: true } : {}),
      ...(correction ? { focus: nextFocus } : {}) };
  }
  if (commercial || command) return null;
  if (!purpose && !another && !attribute && !difference && !storage && !exclusion && !mincePurpose && !heating) return null;
  if (!focus) return purpose || exclusion ? null : { kind: "clarification", message: "О каком продукте или блюде речь?" };
  const names = focus.targets.map(shoppingTargetLabel).join(" и ") || focus.subject || "";
  if (storage && names) return { kind: "question", text: `Как хранить ${names}${/после/u.test(value) ? " после вскрытия упаковки" : ""}?` };
  if (attribute && (focus.targets.length === 1 || !focus.targets.length && focus.subject)) {
    const field = /состав/u.test(value) ? "состав" : /бренд|марк/u.test(value) ? "марка" : "вес";
    return { kind: "question", text: `Какой ${field} у товара: ${names}?` };
  }
  if (difference && focus.targets.length === 2) return { kind: "question", text: `Чем отличаются ${names}?` };
  if ((purpose || another || mincePurpose || heating) && (focus.targets.length === 1 || focus.subject) && focus.topic === "selection") {
    const answer = mincePurpose ? { котлеты: "для котлет", соус: "для соуса", начинка: "для начинки" }[value] : value;
    return { kind: "question", text: `Как выбрать ${names}? ${another ? "Хочется другой вариант." : answer + "."}`, readOnly: true,
      ...(heating ? { referenceOnly: true } : {}) };
  }
  if ((purpose || exclusion || another) && focus.topic === "meal") {
    return { kind: "question", text, readOnly: true };
  }
  if (focus && (purpose || exclusion || another) && !commercial && !command) return { kind: "question", text, readOnly: true };
  return { kind: "clarification", message: names ? `Что хочешь уточнить про ${names}: выбор, состав или применение?` : "Какой продукт или блюдо уточняем?" };
}

export function resolveShoppingPriceFollowup(text, focus, rows, catalog) {
  const value = normalizeShoppingText(stripAssistantGreetingPrefix(text)).replace(/[.!?]+$/u, "");
  if (!/^(?:а\s+)?(?:если\s+)?(?:подешевле|дешевле|сколько\s+(?:(?:это|он|она|они|оно|этот|эта|эти)\s+)?сто[ия]т|почем(?:\s+(?:это|он|она|они|оно))?|какая\s+(?:(?:у него|у нее|у них)\s+)?цена|цена)$/u.test(value)) return null;
  const targets = focus?.targets ?? (rows.length === 1 ? shoppingTargets(catalog.find(product => product.id === rows[0].productId)?.name) : []);
  const subject = targets.length === 1 ? shoppingTargetLabel(targets[0]) : targets.length === 0 ? focus?.subject : null;
  return subject ? { kind: "question", text: `где дешевле ${subject}` }
    : { kind: "clarification", message: "Цену какого товара сравнить?" };
}

const COUNTS = new Map([
  ["один", 1], ["одна", 1], ["одно", 1], ["одну", 1], ["два", 2], ["две", 2], ["пару", 2], ["пара", 2],
  ["три", 3], ["четыре", 4], ["пять", 5], ["шесть", 6], ["семь", 7], ["восемь", 8], ["девять", 9], ["десять", 10],
  ["одиннадцать", 11], ["двенадцать", 12], ["тринадцать", 13], ["четырнадцать", 14], ["пятнадцать", 15],
  ["шестнадцать", 16], ["семнадцать", 17], ["восемнадцать", 18], ["девятнадцать", 19], ["двадцать", 20]
]);
const COUNT_WORDS = [...COUNTS.keys()].join("|");
const COUNT = new RegExp(`^(\\d{1,3}|${COUNT_WORDS})(?:\\s+(упаковк[аиу]|упаковок|пачк[аиу]|пачек|бутылк[аиу]|бутылок|пакет(?:а|ов)?|шт\\.?|штук[аи]?))?$`, "u");
const EXPLICIT_COUNT = new RegExp(`(?:^|\\s)(?:\\d{1,3}|${COUNT_WORDS})(?=$|\\s)`, "u");

function identity(text, catalog) {
  const parsed = parseLocalBasketText(text, catalog);
  return parsed.kind === "local" && parsed.proposal.items.length === 1 ? parsed.proposal.items[0] : null;
}

function clarification(rows, catalog, action = null) {
  const names = rows.map(row => catalog.find(product => product.id === row.productId)?.name).filter(Boolean).slice(0, 3);
  return { kind: "clarification", action, message: names.length > 1
    ? `Какой товар ${action?.operation === "remove" ? "убираем" : "меняем"}: ${names.join(", ")}?`
    : "Какой товар меняем? Напиши его название и нужное количество или замену." };
}

export function resolveShoppingBasketFollowup(text, rows, catalog, intent = null) {
  const value = normalizeShoppingText(stripAssistantGreetingPrefix(text)).replace(/[.!?]+$/u, "").replace(/^а\s+/u, "");
  const selected = intent ? identity(value, catalog) : null;
  if (intent && !selected) intent = null;
  let countText = value.replace(/^(?:(?:нет|стоп)[,\s]+)?(?:лучше|тогда|давай|сделай|поставь)\s+/u, "")
    .replace(/^(?:нет|стоп)[,\s]+/u, "").replace(/^(?:его|ее|их|этого|этой)\s+/u, "");
  const namedCountCandidate = /^(?:нет[,\s]+)(.+?)\s+(\S+(?:\s+\S+)?)$/u.exec(value)
    ?? /^(.+?)\s+(?:оставь|пусть будет|сделай|давай)\s+(.+)$/u.exec(value);
  const namedCount = namedCountCandidate && !/^(?:лучше|тогда|давай|сделай|поставь)$/u.test(namedCountCandidate[1]) ? namedCountCandidate : null;
  const namedCountTarget = namedCount && COUNT.test(namedCount[2]) ? identity(namedCount[1], catalog) : null;
  if (namedCount && COUNT.test(namedCount[2])) countText = namedCount[2];
  const count = COUNT.exec(intent?.operation === "count" ? intent.countText : countText);
  const remove = intent?.operation === "remove" || /^(?:убери|удали|отмени)\s+(?:его|ее|это|этот|эту|их)$/u.test(value);
  const inline = /^не\s+(.+?)\s*,?\s+а\s+(.+)$/u.exec(value);
  const implicitReplacement = /^(?:замени|заменить|поменяй)\s+на\s+(.+)$/u.exec(value);
  const replacement = intent?.operation === "replace" ? ["", "его", intent.requested] : inline ?? /^(?:замени|заменить|поменяй)\s+(.+?)\s+на\s+(.+)$/u.exec(value)
    ?? (implicitReplacement ? ["", "его", implicitReplacement[1]] : null)
    ?? /^(?:нет[,\s]+)?лучше\s+(.+)$/u.exec(value);
  if (!count && !remove && !replacement) return null;
  const action = count ? { operation: "count", countText: intent?.countText ?? countText }
    : remove ? { operation: "remove" } : { operation: "replace", requested: replacement.at(-1) };
  if (!rows.length && !inline) return clarification(rows, catalog);
  if (namedCount && COUNT.test(namedCount[2]) && !rows.some(row => row.productId === namedCountTarget?.productId)) return clarification(rows, catalog, action);
  let old = namedCountTarget ? rows.find(row => row.productId === namedCountTarget.productId)
    : intent && selected ? rows.find(row => row.productId === selected.productId) : null;
  if (!old && replacement?.length === 3 && !/^(?:его|ее|это|этот|эту|их)$/u.test(replacement[1])) {
    const named = identity(replacement[1], catalog);
    old = rows.find(row => row.productId === named?.productId) ?? (inline && named ? named : null);
  } else if (!old && rows.length === 1) old = rows[0];
  if (!old) return clarification(rows, catalog, action);
  const product = catalog.find(row => row.id === old.productId);
  if (!product) return clarification([], catalog);
  let next = rows.filter(row => row.productId !== old.productId);
  let memoryText = "";
  if (count) {
    const quantity = COUNTS.get(count[1]) ?? Number(count[1]);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) return { kind: "clarification", message: "Сколько упаковок нужно? Можно указать число от 1 до 99." };
    if (/^\d+\s*шт\.?$/u.test(product.unit) && Number.parseInt(product.unit, 10) > 1 && !/упаков|пач|бутыл|пакет/u.test(count[2] ?? "")) {
      return { kind: "clarification", message: `Считаем упаковки «${product.name}» (${product.unit}) или отдельные штуки?` };
    }
    next.push({ productId: old.productId, quantity });
  } else if (remove) {
    memoryText = `убери ${product.name}`;
  } else {
    const requested = replacement.at(-1);
    const target = identity(requested, catalog);
    if (!target) return { kind: "clarification", message: `На какой конкретно товар заменить «${product.name}»? Не удалось однозначно сопоставить «${requested}» с каталогом.` };
    const existing = next.find(row => row.productId === target.productId);
    const quantity = EXPLICIT_COUNT.test(requested) ? target.quantity : old.quantity;
    next = next.filter(row => row.productId !== target.productId);
    next.push({ productId: target.productId, quantity: quantity + (existing?.quantity ?? 0) });
    memoryText = `вместо ${product.name} хочу ${catalog.find(row => row.id === target.productId).name}`;
  }
  return { kind: "edit", items: next, memoryText };
}

// Preserve exact rows in a mixed list instead of replacing explicit quantities
// with preference-planner defaults. Unknown positive clauses remain unresolved.
export function explicitShoppingItems(text, catalog, previous = []) {
  const clauses = shoppingClauses(normalizeShoppingText(stripAssistantGreetingPrefix(text)));
  const totals = new Map();
  const unresolved = [];
  for (const clause of clauses) {
    const delta = extractShoppingDelta(clause);
    if (delta.reject.length || delta.unresolved.length || Object.keys(delta.facts).length || delta.reset || delta.undo || delta.newGoal) continue;
    const keep = /^(?:оставь|оставить)\s+(.+)$/u.exec(clause.trim()) ?? /^(.+?)\s+(?:оставь|оставить)$/u.exec(clause.trim());
    if (keep) {
      const retained = parseLocalBasketText(keep[1], catalog);
      const kept = retained.kind === "local" ? retained.proposal.items.map(row => previous.find(old => old.productId === row.productId)) : [];
      if (kept.length && kept.every(Boolean)) {
        for (const row of kept) totals.set(row.productId, row.quantity);
      } else unresolved.push(clause.trim());
      continue;
    }
    const parsed = parseLocalBasketText(clause, catalog);
    const partial = parsed.kind === "local" ? null : planLocalSegments(clause, catalog, segment => parseLocalBasketText(segment, catalog));
    // Category wishes and menu requests belong to the preference planner;
    // they are not an unrecognised concrete product in an explicit list.
    if (partial?.intents?.length || delta.want.some(target => target === "fruit" || target === "vegetables")) continue;
    const items = parsed.kind === "local" ? parsed.proposal.items : partial && !partial.needsAi && !partial.intents.length && !partial.ambiguous.length && !partial.packNotes.length ? partial.proposal.items : [];
    for (const row of items) totals.set(row.productId, (totals.get(row.productId) ?? 0) + row.quantity);
    if (parsed.kind !== "local") unresolved.push(...(partial?.unresolvedTerms?.length ? partial.unresolvedTerms : [clause.trim()]));
  }
  return totals.size || unresolved.length ? { items: [...totals].map(([productId, quantity]) => ({ productId, quantity })), unresolved: [...new Set(unresolved)], warnings: [], explicit: true } : null;
}
