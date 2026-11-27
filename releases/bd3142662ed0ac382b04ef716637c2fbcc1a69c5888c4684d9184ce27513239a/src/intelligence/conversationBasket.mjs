import { BUDGET_STAPLES, BUDGET_RICH_STAPLES } from "./budgetBasketPlanner.mjs";
import { isShoppingProductRejected, productShoppingTargets, shoppingTargetLabel } from "./shoppingConversation.mjs";
import { formatRubMinor } from "../components/ComparisonResult.mjs";

// Identity-only seed knowledge: preparation effort is not stock or a retailer offer.
// Unknown products never acquire a preparation claim from their category alone.
const COLD_IDS = new Set(["bread-wheat-400", "cheese-semi-hard-200", "cottage-cheese-5-200", "apples-1kg", "bananas-1kg", "oranges-1kg", "pears-1kg", "mandarins-1kg", "doctor-sausage-400"]);
const HEAT_IDS = new Set(["beef-stew-325"]);
const PREPARATION_IDS = new Set(["chicken-fillet-600", "whole-chicken-1kg", "ground-beef-400", "pelmeni-800", "potatoes-1kg", "rice-900", "pasta-450", "buckwheat-800", "oat-flakes-400"]);
const MINIMAL_ORDER = ["bread-wheat-400", "cheese-semi-hard-200", "cottage-cheese-5-200", "apples-1kg", "doctor-sausage-400", "bananas-1kg", "beef-stew-325"];
const PREPARATION = new Set(["none", "heat", "quick", "cook"]);
export function knownPreparation(product) {
  if (COLD_IDS.has(product.id)) return "none";
  if (HEAT_IDS.has(product.id)) return "heat";
  if (PREPARATION_IDS.has(product.id)) return "cook";
  return null;
}
function hintMinor(hints, id) {
  const amount = hints?.get(id)?.minMinor;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
function allowedPreparation(product, state, explicitWish) {
  const effort = state.facts.cookingEffort?.value;
  if (effort !== "minimal" || explicitWish) return true;
  const prep = knownPreparation(product);
  const direction = state.facts.direction?.value;
  return prep === "none" || (prep === "heat" && direction !== "cold");
}

export function planConversationBasket(state, catalog, hints, previous = []) {
  const byId = new Map(catalog.map(product => [product.id, product]));
  const wishes = Object.keys(state.wishes);
  const unresolved = [];
  const selected = new Map();
  const budget = state.facts.budgetMinor?.value ?? null;
  let estimate = 0;
  const warnings = [];
  const add = (product, required = false, quantity = 1) => {
    if (!product || isShoppingProductRejected(product, state)) return false;
    if (!allowedPreparation(product, state, required)) return false;
    const amount = hintMinor(hints, product.id);
    if (!required && budget !== null && amount !== null && estimate + amount * quantity > budget) return false;
    if (selected.has(product.id)) return true;
    selected.set(product.id, { productId: product.id, quantity });
    if (amount !== null) estimate += amount * quantity;
    if (required && state.facts.cookingEffort?.value === "minimal" && PREPARATION.has(knownPreparation(product)) && !["none", "heat"].includes(knownPreparation(product))) {
      warnings.push(`${product.name} потребует готовки; оставила по твоему прямому пожеланию.`);
    }
    return true;
  };
  // Required wishes outrank optional staples, but never outrank an explicit refusal.
  for (const target of wishes) {
    const matches = catalog.filter(product => productShoppingTargets(product).includes(target) && !isShoppingProductRejected(product, state));
    // Deterministic historical preference; no claim that it is cheapest now or at a requested address.
    matches.sort((left, right) => (hintMinor(hints, left.id) ?? Infinity) - (hintMinor(hints, right.id) ?? Infinity));
    const prior = previous.find(row => row.productId === matches[0]?.id);
    if (!matches.length || !add(matches[0], true, prior?.quantity ?? 1)) unresolved.push(target);
  }
  const minimal = state.facts.cookingEffort?.value === "minimal";
  const reframe = state.hypotheses.some(entry => entry.value === "structure_mismatch");
  if (budget !== null || minimal || reframe) {
    const direction = state.facts.direction?.value;
    const order = reframe ? ["bread-wheat-400", "cheese-semi-hard-200", "apples-1kg", "beef-stew-325", "bananas-1kg"]
      : minimal && direction === "heat" ? ["beef-stew-325", ...MINIMAL_ORDER]
      : minimal ? MINIMAL_ORDER : state.facts.budgetStyle?.value === "better" ? BUDGET_RICH_STAPLES : BUDGET_STAPLES;
    for (const id of order) {
      if (selected.size >= (reframe ? 5 : 7)) break;
      add(byId.get(id));
    }
    if (!selected.size && budget !== null) {
      const cheapest = order.map(id => byId.get(id)).filter(product => product && !isShoppingProductRejected(product, state) && allowedPreparation(product, state, false) && hintMinor(hints, product.id) !== null)
        .sort((a, b) => hintMinor(hints, a.id) - hintMinor(hints, b.id))[0];
      if (cheapest) add(cheapest, true);
    }
  } else {
    for (const row of previous) add(byId.get(row.productId), false, row.quantity);
  }
  return Object.freeze({ items: [...selected.values()], unresolved, warnings });
}

export function conversationPriceSummary(rows, hints) {
  let knownSubtotalMinor = 0;
  let unknownCount = 0;
  const dates = new Set();
  for (const row of rows) {
    const id = row.productId ?? row.id;
    const amount = hintMinor(hints, id);
    if (amount === null) unknownCount += 1;
    else {
      knownSubtotalMinor += amount * row.quantity;
      dates.add(hints.get(id).observedDateLabel || "дата неизвестна");
    }
  }
  return { kind: !rows.length || unknownCount === rows.length ? "unknown" : unknownCount ? "incomplete_historical" : "historical", knownSubtotalMinor, unknownCount, dates: [...dates] };
}

export function presentConversationBasket(state, plan, catalog, hints, nextBasket, diff) {
  const byId = new Map(catalog.map(product => [product.id, product]));
  const specific = state.facts.brandStyle?.value === "specific";
  const items = plan.items.map(row => {
    const product = byId.get(row.productId);
    const amount = hintMinor(hints, row.productId);
    const brand = typeof product?.brand === "string" && product.brand.trim() ? product.brand.trim() : "марка не подтверждена";
    const unit = product?.unit || "вес не указан";
    const price = amount === null ? "цена неизвестна" : `${formatRubMinor(amount)} — историческая оценка (${hints.get(row.productId).observedDateLabel || "дата неизвестна"})`;
    return { productId: row.productId, name: product.name, unit, quantity: row.quantity,
      displayLabel: specific ? `${brand} → ${product.name} → ${unit} → ${price} ×${row.quantity}` : `${product.name} · ${unit} ×${row.quantity}` };
  });
  const summary = conversationPriceSummary(nextBasket, hints);
  const messages = [];
  const recommendation = (state.facts.cookingEffort?.value === "minimal"
    ? items.filter(row => ["none", "heat"].includes(knownPreparation(byId.get(row.productId)))) : items).slice(0, 3).map(row => row.name).join(", ");
  const inferred = state.facts.cookingEffort?.origin === "inferred";
  if (inferred) messages.push("Предположу, что тебе нужна еда с минимумом готовки. Если ошиблась — поправь.");
  if (state.hypotheses.some(entry => entry.value === "structure_mismatch")) {
    messages.push("Похоже, дело в структуре корзины: набор мог получиться случайным или слишком однотипным. Перестрою вокруг способов поесть.");
  }
  if (plan.explicit) {
    messages.push("Проверь товары и количество. Применю показанные изменения после подтверждения.");
  } else if (state.facts.cookingEffort?.value === "minimal") {
    messages.push(recommendation
      ? `Я бы выбрала ${recommendation}: можно поесть без долгой готовки. Ещё два направления — холодный набор или продукт для разогрева; конкретные варианты зависят от каталога.`
      : "Я бы начала с еды без долгой готовки, потому что это соответствует твоему пожеланию. Подходящие конкретные товары пока не подтверждены.");
  } else messages.push(recommendation
    ? `Я бы начала с ${recommendation}, потому что так проще собрать связный набор. Можно сделать дешевле или добавить разнообразия.`
    : "Я бы сначала выбрала структуру питания, потому что подходящих конкретных товаров пока нет. Можно уточнить товар или поискать вручную.");
  if (state.facts.budgetMinor) messages.push(`Лимит сохраняю: ${formatRubMinor(state.facts.budgetMinor.value)}.`);
  if (summary.kind !== "unknown") messages.push(`Историческая оценка ${summary.unknownCount ? "известной части" : "набора"}: ${formatRubMinor(summary.knownSubtotalMinor)} (${summary.dates.join(", ")}). Это минимумы из разных магазинов, регион не подтверждён.`);
  if (summary.unknownCount) messages.push(`Без цены: ${summary.unknownCount} поз. Полную сумму и попадание в бюджет подтвердить не могу.`);
  if (state.facts.budgetMinor && summary.knownSubtotalMinor > state.facts.budgetMinor.value) messages.push("Даже историческая оценка известной части выше лимита. Нужно сократить набор; попадание в бюджет не подтверждено.");
  if (state.facts.retailer || state.facts.location) messages.push(`Учла пожелание: ${[state.facts.retailer?.value, state.facts.location?.value].filter(Boolean).join(" · ")}. Наличие и адресные цены здесь не подтверждены.`);
  if (plan.unresolved.length) messages.push(`Не сопоставила с каталогом: ${plan.unresolved.map(shoppingTargetLabel).join(", ")}. Показываю только найденную часть; похожим товаром не заменяю.`);
  messages.push(...plan.warnings);
  if (specific) messages.push("Марки показываю только из данных товара. У общей позиции каталога конкретная марка может быть не подтверждена.");
  if (diff.length) messages.push(`Изменения после подтверждения: ${diff.map(row => `${row.name}: ${row.before} → ${row.after}`).join("; ")}.`);
  messages.push("Актуальную стоимость и покрытие проверит «Где дешевле?» после подтверждения корзины.");
  return { mascotState: plan.unresolved.length ? "partial" : "checking", headline: plan.explicit ? "Обновила черновик покупок." : "Перестроила черновик с учётом разговора.", message: messages.join(" "), items,
    primaryAction: plan.unresolved.length ? "Применить найденную часть" : "Применить изменения", secondaryAction: "Уточнить запрос", focusClarification: true };
}
