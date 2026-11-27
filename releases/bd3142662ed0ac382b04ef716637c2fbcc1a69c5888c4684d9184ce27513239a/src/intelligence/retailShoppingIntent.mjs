import { parseLocalBasketText, stemRussianToken } from "./localBasketParser.mjs";
import { stripShoppingRequestPrefix } from "./shoppingRequestText.mjs";
import { stripAssistantGreetingPrefix } from "./localAssistantDialogue.mjs";
import { splitShoppingItems, MAX_AI_CATALOG_QUERIES } from "../runtime/catalogQueries.mjs";
import { shoppingTargets } from "./shoppingConversation.mjs";
import { extractShoppingNeedContext } from "./shoppingNeedContext.mjs";

// Linguistic aliases only. These never select a source SKU, package or price.
const aliases = [
  [/кефирчик(?:а|у|ом|и|ов)?/u, "кефир"],
  [/молочко/u, "молоко"],
  [/хлебуш(?:ек|ка|ку|ком)/u, "хлеб"],
  [/яичк(?:о|а|и|у|ами)/u, "яйца"],
  [/макарошк(?:и|а|у|ами)/u, "макароны"],
  [/бутылоч(?:к[ауи]|ек)/u, "бутылки"],
  [/пачеч(?:к[ауи]|ек)/u, "пачки"]
];
const counts = { один: 1, одна: 1, одно: 1, одну: 1, два: 2, две: 2, пара: 2, пару: 2,
  три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10 };
const countPattern = "(?:\\d{1,3}|один|одна|одно|одну|два|две|пара|пару|три|четыре|пять|шесть|семь|восемь|девять|десять)";
const packages = "(?:бутылк[ауи]|упаковк[ауи]|пачк[ауи]|бан(?:ка|ку|ки)|пакет(?:а|ов)?|шт\\.?)";
const leadingCount = new RegExp(`^(${countPattern})\\s+(?:(${packages})\\s+)?(.+)$`, "iu");
const trailingCount = new RegExp(`^(.+?)\\s+(${countPattern})\\s+(${packages})$`, "iu");
const lowFat = /(?:^|\s)(?:нежирн\S*|маложирн\S*|обезжиренн\S*)(?=$|\s)/iu;
const discoveryFamilies = { "kefir-1l": "кефир", "milk-25-900": "молоко", "eggs-c1-10": "яйца", "bread-wheat-400": "хлеб",
  "pasta-450": "макароны", "water-15": "вода", "apples-1kg": "яблоки", "butter-825-180": "сливочное масло",
  "rice-900": "рис", "cheese-semi-hard-200": "сыр" };

const knownNoun = (product, word) => [product?.name, ...(product?.aliases ?? [])].some(name =>
  (String(name ?? "").match(/[а-яё]+/giu) ?? []).some(token => stemRussianToken(token) === stemRussianToken(word)));

const selectionTokens = value => (String(value ?? "").normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е")
  .replace(/(\d),(\d)/gu, "$1.$2").replace(/(\d)\s+%/gu, "$1%")
  .match(/\d+(?:\.\d+)?%|[a-zа-я]+|\d+(?:\.\d+)?/gu) ?? [])
  .map(token => /\d/u.test(token) ? token : stemRussianToken(token));
// Bounded title vocabulary, not SKU or commercial identity. The first product
// noun distinguishes milk from a curd bar or biscuit mentioning milk. A noun
// after an ingredient connector cannot establish the product's main family.
const titleFamilies = new Map([
  "молоко", "кефир", "яйцо", "хлеб", "сыр", "сырок", "йогурт", "сметана", "творог", "ряженка", "сливки", "масло",
  "рис", "макароны", "паста", "лапша", "печенье", "конфета", "шоколад", "мороженое", "пирожное", "бисквит", "торт", "кекс",
  "коктейль", "напиток", "каша", "хлопья", "вода", "яблоко", "банан", "томат", "помидор", "картофель", "лук", "морковь", "капуста",
  "пельмени", "котлета", "наггетсы", "фарш", "филе", "курица", "цыпленок", "колбаса", "сосиска", "сок", "чай", "кофе"
].map(noun => [stemRussianToken(noun), noun]));
const mainTitleFamily = value => selectionTokens(String(value ?? "").split(/\s+(?:с|со)\s+/iu)[0])
  .map(token => titleFamilies.get(token)).find(Boolean) ?? null;

export function retailQueryMatchesProduct(query, product) {
  const wanted = selectionTokens(query), available = new Set(selectionTokens(`${product?.name ?? ""} ${product?.unit ?? ""}`));
  const family = mainTitleFamily(query);
  return wanted.length > 0 && wanted.every(token => available.has(token))
    && (!family || mainTitleFamily(product?.name) === family);
}

export function isRetailSortFollowup(text) {
  return /^(?:а\s+)?(?:(?:тот|что-нибудь)\s*,?\s*(?:что\s+)?)?(?:подешевле|дешевле)$/iu.test(normalizeRetailShoppingText(text));
}

export function normalizeRetailShoppingText(text) {
  let value = String(text ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
  value = stripAssistantGreetingPrefix(value);
  value = value.replace(/^(?:мне|нам)\s+бы\s+/iu, "хочу ")
    .replace(/^(?:можно\s+(?:мне|нам)|давай(?:\s+(?:мне|нам))?)\s+/iu, "хочу ");
  for (const [pattern, replacement] of aliases) {
    value = value.replace(new RegExp(`(^|[\\s,;])(${pattern.source})(?=$|[\\s,;.!?])`, "giu"), `$1${replacement}`);
  }
  return value.replace(/(?:^|\s)бы(?=$|[\s,.!?])/giu, " ")
    .replace(/(?:[,\s]+)(?:пожалуйста|пж|плиз)[.!?]*$/iu, "")
    .replace(/[.!?]+$/u, "").replace(/\s+/gu, " ").trim();
}

export function retailQuantityFollowup(value) {
  const text = normalizeRetailShoppingText(value).toLocaleLowerCase("ru-RU");
  const negative = text.match(new RegExp(`^(?:не\\s+(?:давай|бери|возьми|надо)|(?:нет|не))\\s+(${countPattern})(?:\\s+(${packages}))?$`, "u"));
  if (negative) return { quantity: counts[negative[1]] ?? Number(negative[1]), explicit: false, ambiguous: true };
  const correction = /^(?:(?:нет|не)[,\s]+)?(?:давай|лучше|пусть будет|сделай)\s+/u.test(text);
  const body = text.replace(/^(?:(?:нет|не)[,\s]+)?(?:давай|лучше|пусть будет|сделай)\s+/u, "")
    .replace(/^(?:нет|не)[,\s]+/u, "");
  const match = body.match(new RegExp(`^(${countPattern})(?:\\s+(${packages}))?$`, "u"));
  if (!match) return null;
  if (/^(?:нет|не)[,\s]+/u.test(text) && !correction && !match[2]) return {
    quantity: counts[match[1]] ?? Number(match[1]), explicit: false, ambiguous: true };
  return { quantity: counts[match[1]] ?? Number(match[1]), explicit: correction || Boolean(match[2]) };
}

export function retailFatFollowup(text, focus) {
  if (!focus) return null;
  const value = normalizeRetailShoppingText(text).toLocaleLowerCase("ru-RU");
  const match = value.match(/^(?:(?:а|лучше|давай)\s+)?(?:жирность\s+)?(\d{1,2}(?:[.,]\d{1,2})?)\s*%$/u);
  if (!match || !/кефир|молок|йогурт|сметан|творог/u.test(focus.query)) return null;
  const percent = Number(match[1].replace(",", "."));
  if (!Number.isFinite(percent) || percent < 0 || percent > 99) return null;
  return { query: `${focus.query.replace(/\d+(?:[.,]\d+)?\s*%/gu, "").trim()} ${percent}%`, quantity: focus.quantity };
}

function itemIntent(text, catalog) {
  const cleaned = stripShoppingRequestPrefix(text);
  const leading = cleaned.match(leadingCount), trailing = cleaned.match(trailingCount);
  let query = trailing?.[1] ?? leading?.[3] ?? cleaned;
  let quantity = trailing ? counts[trailing[2]] ?? Number(trailing[2])
    : leading ? counts[leading[1]] ?? Number(leading[1]) : 1;
  const parsed = parseLocalBasketText(text, catalog);
  if (["unit_quantity_ambiguous", "ambiguous_segment", "quantity_out_of_range"].includes(parsed.reason)) return {
    kind: "clarification", message: "Уточни товар и количество упаковок, чтобы я сохранила нужный объём. Например: «две бутылки кефира»." };
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) return {
    kind: "clarification", message: "Сколько упаковок нужно? Можно выбрать от 1 до 99." };
  if (parsed.kind === "local" && parsed.proposal.items.length === 1) {
    quantity = parsed.proposal.items[0].quantity;
    // A locally proven typo/alias may seed discovery, but the source choice
    // still has to pass the original specification and reviewed SKU gates.
    const exact = parseLocalBasketText(query, catalog);
    if (exact.kind === "local" && exact.proposal.items.length === 1 && !/[\d%]/u.test(query)
        && !/\s/u.test(query)) {
      const product = catalog.find(row => row.id === exact.proposal.items[0].productId);
      const family = discoveryFamilies[product?.id];
      if (family && !knownNoun(product, query)) query = family;
    }
  } else if (stripShoppingRequestPrefix(text) === text.trim() && !shoppingTargets(query).length) return null;
  const noun = query.match(/^([а-яё]+)(?=$|\s)/iu);
  if (noun) {
    const first = parseLocalBasketText(noun[1], catalog);
    const family = first.kind === "local" && first.proposal.items.length === 1 ? discoveryFamilies[first.proposal.items[0].productId] : null;
    const product = first.kind === "local" ? catalog.find(row => row.id === first.proposal.items[0].productId) : null;
    if (family && !/\s/u.test(family) && !knownNoun(product, noun[1]) && first.proposal.items[0].quantity === 1) query = family + query.slice(noun[1].length);
  }
  if (!query || query.length > 120) return { kind: "clarification", message: "Напиши название и условия короче; ничего из запроса не буду отбрасывать." };
  return { kind: "item", query, quantity };
}

export function parseRetailShoppingIntent(text, catalog) {
  const need = extractShoppingNeedContext(normalizeRetailShoppingText(text));
  if (need.clarification) return { kind: "clarification", message: need.clarification };
  const value = need.text;
  const framed = stripShoppingRequestPrefix(value) !== value;
  let parts = splitShoppingItems(value);
  const listRequest = framed || parts.length > 1 && parts.some(part => shoppingTargets(part).length
    || parseLocalBasketText(part, catalog).kind === "local");
  const local = parseLocalBasketText(value, catalog);
  if (parts.length === 1 && local.kind === "local" && local.proposal.items.length > 1) {
    if (local.proposal.items.length > MAX_AI_CATALOG_QUERIES) return { kind: "clarification",
      message: `В запросе больше ${MAX_AI_CATALOG_QUERIES} товаров. Раздели список на две части; ничего не добавляю молча.` };
    return { kind: "search", items: local.proposal.items.map(row => ({
      query: discoveryFamilies[row.productId] ?? catalog.find(product => product.id === row.productId)?.name,
      quantity: row.quantity
    })), ...{ query: discoveryFamilies[local.proposal.items[0].productId]
      ?? catalog.find(product => product.id === local.proposal.items[0].productId)?.name,
    quantity: local.proposal.items[0].quantity } };
  }
  // An adjective after a comma can qualify the previous product. It must
  // become a question, never a second missing SKU or an assumed percentage.
  parts = parts.reduce((result, part) => {
    if (lowFat.test(part) && result.length && !/кефир|молок|творог|йогурт|сметан/iu.test(part)) result[result.length - 1] += ` ${part}`;
    else result.push(part);
    return result;
  }, []);
  if (parts.length > MAX_AI_CATALOG_QUERIES) return { kind: "clarification",
    message: `В запросе больше ${MAX_AI_CATALOG_QUERIES} товаров. Раздели список на две части — сохраню все позиции, ничего не добавляя молча.` };
  const items = [];
  for (const part of parts) {
    const low = lowFat.test(part);
    const input = low ? part.replace(lowFat, " ").trim() : part;
    const item = itemIntent(listRequest && stripShoppingRequestPrefix(input) === input ? `хочу ${input}` : input, catalog);
    if (!item) return null;
    if (item.kind === "clarification") return item;
    items.push({ query: item.query, quantity: item.quantity, ...(low ? { needsFat: true } : {}) });
  }
  if (!items.length) return null;
  return { kind: "search", ...items[0], ...(items.length > 1 ? { items } : {}) };
}

export function retailBudgetIntent(text, catalog) {
  const value = normalizeRetailShoppingText(text);
  if (stripShoppingRequestPrefix(value) === value || /цен[ау]|стоим|скидк|акци|налич|доставк|заказ|где|магазин/iu.test(value)) return null;
  const match = value.match(/\s+(?:до|бюджет(?:ом)?|лимит|не больше)\s+(-?\d{1,9}(?:[.,]\d+)?)\s*(?:₽|руб(?:лей|ля|ль)?\.?)(?:\s*)$/iu);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  const budgetMinor = Math.round(amount * 100);
  if (!Number.isSafeInteger(budgetMinor) || budgetMinor < 1000 || budgetMinor > 99999900 || /[.,]\d{3}/u.test(match[1])) return {
    kind: "clarification", message: "Уточни общий лимит в рублях, например «до 700 ₽». Товары пока не добавляю." };
  const request = parseRetailShoppingIntent(value.slice(0, match.index).replace(/[,;]+$/u, "").trim(), catalog);
  return request ? { ...request, budgetMinor } : null;
}
