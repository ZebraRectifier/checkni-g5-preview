// Budget basket planner: "корзина на 600 рублей" → a draft basket that
// fits the stated budget, using only the dated web-price snapshot hints
// (region not confirmed). Fully local and deterministic: no AI, no
// invented prices. The draft always goes through the confirm-first UI;
// the authoritative "where is it cheaper" answer still comes from the
// snapshot comparison, never from this planner.

import { planLocalIntentBasket } from "./localIntentPlanner.mjs";

// "600 ₽", "600 руб", "600 рублей", "600р." — the currency marker is
// required: a bare number stays an ordinary quantity/size. A fresh
// RegExp per use avoids shared lastIndex state.
const BUDGET_PATTERN =
  "(?:^|[^\\d])(\\d{1,6})\\s*(?:₽|руб(?:лей|ля|ль)?\\.?|р\\.?)(?=$|[^а-яa-z0-9])";

function budgetRe() {
  return new RegExp(BUDGET_PATTERN, "g");
}

// Words that describe the request itself rather than any product.
const GENERIC_WORDS = new Set([
  "корзина", "корзину", "корзины", "корзинка", "корзинку",
  "собери", "собрать", "соберешь", "собираем", "набери", "набрать",
  "хочу", "хотим", "надо", "нужно", "нужна", "можно",
  "купи", "купить", "закупись", "закупиться", "возьми", "взять",
  "продукты", "продуктов", "еда", "еды", "поесть", "покушать",
  "набор", "бюджет", "бюджета", "уложись", "уложиться",
  "примерно", "около", "максимум", "всего", "где-то", "чтобы",
  "на", "за", "до", "в", "пределах", "рамках", "сумму", "и", "мне",
  "что", "что-нибудь", "чего-нибудь", "какой-нибудь", "пожалуйста"
]);

// Everyday staples in priority order: the first items are what a basket
// on a tight budget should hold. All ids are canonical catalogue ids.
export const BUDGET_STAPLES = Object.freeze([
  "bread-wheat-400",
  "milk-25-900",
  "eggs-c1-10",
  "potatoes-1kg",
  "pasta-450",
  "buckwheat-800",
  "onions-1kg",
  "carrots-1kg",
  "chicken-fillet-600",
  "sunflower-oil-1l",
  "cabbage-1kg",
  "sugar-1kg",
  "black-tea-25",
  "rice-900",
  "apples-1kg",
  "cottage-cheese-5-200",
  "sour-cream-20-300",
  "cheese-semi-hard-200",
  "butter-825-180",
  "bananas-1kg",
  "tomatoes-600",
  "cucumbers-1kg"
]);

export const BUDGET_STYLE = Object.freeze({
  ECONOMY: "economy",
  RICHER: "richer"
});

// "Получше/побогаче": a fuller, more varied everyday basket. No quality
// claims are made — we have no quality data; this is simply a richer
// product mix at the same honest snapshot prices.
export const BUDGET_RICH_STAPLES = Object.freeze([
  "bread-wheat-400",
  "milk-25-900",
  "eggs-c1-10",
  "chicken-fillet-600",
  "cheese-semi-hard-200",
  "butter-825-180",
  "tomatoes-600",
  "cucumbers-1kg",
  "apples-1kg",
  "bananas-1kg",
  "cottage-cheese-5-200",
  "sour-cream-20-300",
  "pork-1kg",
  "buckwheat-800",
  "oat-cookies-300",
  "milk-chocolate-90",
  "black-tea-25",
  "oranges-1kg",
  "pears-1kg"
]);

const RICHER_STYLE_RE =
  /получше|по\s?богаче|побогаче|повкуснее|посытнее|покачественнее|качеств|праздничн/;
const ECONOMY_STYLE_RE = /подешевле|дешевле|эконом|бюджетн|сэконом/;

function detectStyle(normalized) {
  if (RICHER_STYLE_RE.test(normalized)) return BUDGET_STYLE.RICHER;
  if (ECONOMY_STYLE_RE.test(normalized)) return BUDGET_STYLE.ECONOMY;
  return BUDGET_STYLE.ECONOMY;
}

function normalize(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBudgetMinor(normalized) {
  let last = null;
  for (const match of normalized.matchAll(budgetRe())) {
    last = match;
  }
  if (!last) return null;
  const rub = Number.parseInt(last[1], 10);
  if (!Number.isFinite(rub) || rub < 10) return null;
  return rub * 100;
}

function stripBudgetPhrase(normalized) {
  return normalized
    .replace(budgetRe(), " ")
    .split(/[^а-яa-z0-9-]+/)
    .filter((word) => word && !GENERIC_WORDS.has(word))
    .join(" ")
    .trim();
}

function pickWithinBudget(candidateIds, known, hints, budgetMinor) {
  const items = [];
  let totalMinor = 0;
  for (const id of candidateIds) {
    if (!known.has(id)) continue;
    const hint = hints.get(id);
    if (!hint) continue;
    if (totalMinor + hint.minMinor > budgetMinor) continue;
    items.push({ productId: id, quantity: 1 });
    totalMinor += hint.minMinor;
  }
  return { items, totalMinor };
}

function cheapestCandidate(candidateIds, known, hints) {
  let best = null;
  for (const id of candidateIds) {
    if (!known.has(id)) continue;
    const hint = hints.get(id);
    if (!hint) continue;
    if (!best || hint.minMinor < best.minMinor) {
      best = { productId: id, minMinor: hint.minMinor };
    }
  }
  return best;
}

// Returns null when the phrase is not a budget request (no currency
// amount, or it names concrete products — those keep the normal route).
// Otherwise: { budgetMinor, estimateMinor, overBudget, intents, proposal }.
export function planBudgetBasket(text, catalogSnapshot, priceHints, parseSegment) {
  if (!(priceHints instanceof Map) || !Array.isArray(catalogSnapshot)) return null;

  const normalized = normalize(text);
  const budgetMinor = extractBudgetMinor(normalized);
  if (budgetMinor === null) return null;

  const known = new Set(catalogSnapshot.map((product) => product.id));
  const style = detectStyle(normalized);
  const remainder = stripBudgetPhrase(normalized)
    .replace(RICHER_STYLE_RE, " ")
    .replace(ECONOMY_STYLE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  let candidateIds = style === BUDGET_STYLE.RICHER
    ? BUDGET_RICH_STAPLES
    : BUDGET_STAPLES;
  let intents = Object.freeze([]);

  if (remainder) {
    const planned = planLocalIntentBasket(remainder, catalogSnapshot);
    if (planned) {
      candidateIds = planned.proposal.items.map((item) => item.productId);
      intents = planned.intents;
    } else if (typeof parseSegment === "function") {
      // Concrete products next to the budget ("сыр за 200 рублей",
      // "молоко и яйца на 300 руб") keep the ordinary parsing route;
      // the budget planner steps aside.
      const probes = new Set([remainder, ...remainder.split(" ")]);
      for (const probe of probes) {
        if (!probe) continue;
        const parsed = parseSegment(probe);
        if (parsed?.kind === "local") return null;
      }
    }
  }

  const picked = pickWithinBudget(candidateIds, known, priceHints, budgetMinor);

  if (picked.items.length === 0) {
    const cheapest = cheapestCandidate(candidateIds, known, priceHints);
    if (!cheapest) return null;
    return Object.freeze({
      budgetMinor,
      estimateMinor: cheapest.minMinor,
      overBudget: true,
      style,
      intents,
      proposal: Object.freeze({
        items: Object.freeze([
          Object.freeze({ productId: cheapest.productId, quantity: 1 })
        ])
      })
    });
  }

  return Object.freeze({
    budgetMinor,
    estimateMinor: picked.totalMinor,
    overBudget: false,
    style,
    intents,
    proposal: Object.freeze({
      items: Object.freeze(picked.items.map((item) => Object.freeze(item)))
    })
  });
}
