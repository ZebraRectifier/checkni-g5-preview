import { parseLocalBasketText, stemRussianToken } from "./localBasketParser.mjs";
import { stripShoppingRequestPrefix } from "./shoppingRequestText.mjs";
import { extractCatalogQueries } from "../runtime/catalogQueries.mjs";
import { getReviewedRetailBasketProduct } from "../catalog/reviewedRetailBasket.mjs";
import { getRetailCatalogDefinition } from "../ports/retailCatalogPort.mjs";

export function currentRetailSelectionScope(readCatalog, localCatalog) {
  if (typeof readCatalog !== "function") return null;
  try {
    const products = readCatalog();
    if (!Array.isArray(products) || products === localCatalog) return null;
    const retail = products.filter(product => product?.catalogDisplayOnly === true && typeof product.retailerId === "string");
    if (!retail.length && products.length) return null;
    return retail.length ? JSON.stringify([...new Set(retail.map(product => `${product.retailerId}:${product.storeName ?? ""}`))].sort()) : "retail:loading";
  } catch { return "retail:unavailable"; }
}

export function retailSelectionRequest(text, catalog, delta, focus = null) {
  const value = text.trim().toLocaleLowerCase("ru-RU");
  if (focus) {
    const chosen = value.match(/^(?:выбираю\s+(?:вариант\s+)?|вариант\s+)([1-5])$/u);
    const ordinal = { первый: 1, второй: 2, третий: 3, четвертый: 4, "четвёртый": 4, пятый: 5 }[value];
    if (chosen || ordinal) return { kind: "choice", index: Number(chosen?.[1] ?? ordinal) - 1 };
    const count = value.match(/^(?:(?:нет,?\s+)?лучше\s+)?(один|одну|одна|две|два|три|четыре|пять|\d{1,3})(?:\s+(?:бутылк[ауи]|упаковк[ауи]|пачк[ауи]))?$/u);
    if (count) {
      if (!/бутыл|упаков|пачк/u.test(value) && focus.cards.length !== 1) return { kind: "clarification", message: "Это количество упаковок или номер варианта? Например: «две бутылки» или «вариант 2»." };
      const quantity = Number(count[1]) || { один: 1, одну: 1, одна: 1, две: 2, два: 2, три: 3, четыре: 4, пять: 5 }[count[1]];
      return { kind: "quantity", quantity };
    }
    if (/^(?:\d{1,3}|один|два|две|три)$/u.test(value)) return { kind: "clarification", message: "Это количество упаковок или номер варианта? Например: «две бутылки» или «вариант 2»." };
    if (/^(?:(?:тот|что-нибудь)\s+)?(?:подешевле|дешевле)$/u.test(value)) return { kind: "sort" };
    if (/^(?:другой бренд|другая марка)$/u.test(value)) return { kind: "clarification", message: "Какую марку предпочитаешь? Напиши товар и марку в одном запросе, например «хочу кефир Простоквашино» — проверю подходящие карточки." };
  }
  if (delta.reset || delta.undo || delta.newGoal || delta.reject.length || delta.allow.length || delta.unresolved.length || Object.keys(delta.facts).length) return null;
  const parsed = parseLocalBasketText(text, catalog);
  const terms = extractCatalogQueries(text);
  if (terms.length !== 1) return null;
  if (parsed.kind === "local" && parsed.proposal.items.length === 1) return { kind: "search", query: terms[0], quantity: parsed.proposal.items[0].quantity };
  if (parsed.kind === "fallback" && ["unresolved_segment", "identity_specification"].includes(parsed.reason)
      && stripShoppingRequestPrefix(text) !== text.trim()) return { kind: "search", query: terms[0], quantity: 1 };
  return null;
}

export function retailSelectionUrl(raw, retailerId, field = "sourceUrlRules") {
  const definition = getRetailCatalogDefinition(retailerId);
  if (!definition || typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !definition[field]?.some(rule => url.hostname === rule.host && url.pathname.startsWith(rule.prefix))) return null;
    return url.href;
  } catch { return null; }
}

function sameMagnitScope(product, context) {
  if (!context.shopCode) return true;
  const raw = retailSelectionUrl(product.productUrl, product.retailerId, "productUrlRules") ?? retailSelectionUrl(product.sourceUrl, product.retailerId);
  try { return new URL(raw).searchParams.get("shopCode") === context.shopCode; }
  catch { return false; }
}

function queryMatchesCard(query, card) {
  const tokens = value => (String(value ?? "").normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/(\d),(\d)/gu, "$1.$2").replace(/(\d)\s+%/gu, "$1%")
    .match(/\d+(?:\.\d+)?%|[a-zа-я]+|\d+(?:\.\d+)?/gu) ?? []).map(token => /\d/u.test(token) ? token : stemRussianToken(token));
  const wanted = tokens(query), available = new Set(tokens(`${card.name} ${card.unit ?? ""}`));
  return wanted.length > 0 && wanted.every(token => available.has(token));
}

export function admittedRetailSelectionCards(result, query) {
  if (result?.kind !== "commercial-assistant-result" || !result.retailerContext?.storeId || !Array.isArray(result.retailProducts)) return [];
  const counts = new Map();
  for (const product of result.retailProducts) if (typeof product?.id === "string") counts.set(product.id, (counts.get(product.id) ?? 0) + 1);
  return result.retailProducts.filter(product => product?.retailerId === result.retailerId && typeof product.name === "string" && product.name
      && typeof product.id === "string" && product.id && counts.get(product.id) === 1
      && Number.isSafeInteger(product.priceMinor) && product.priceMinor > 0 && product.currency === "RUB" && product.availability === "unknown"
      && Number.isFinite(Date.parse(product.observedAt)) && Date.parse(product.observedAt) <= Date.now() + 300000
      && retailSelectionUrl(product.sourceUrl, product.retailerId)
      && sameMagnitScope(product, result.retailerContext) && queryMatchesCard(query, product))
    .slice(0, 5).map(product => Object.freeze({ ...product, sourceUrl: retailSelectionUrl(product.sourceUrl, product.retailerId),
      imageUrl: retailSelectionUrl(product.imageUrl, product.retailerId, "imageUrlRules"), storeId: result.retailerContext.storeId,
      productUrl: retailSelectionUrl(product.productUrl, product.retailerId, "productUrlRules") }));
}

export function retailSelectionView(focus, extra = "") {
  return { status: "clarification", result: { kind: "clarification", triggerReason: "smalltalk" }, presentation: {
    headline: focus.cards.length ? "Посмотрим реальные варианты." : "Товар поняла, но карточки пока не получила.",
    message: focus.cards.length ? `${extra ? extra + " " : ""}Количество: ${focus.quantity} уп. Выбери вариант или уточни упаковку. Наличие неизвестно; цены показаны на дату наблюдения.`
      : "Поиск не подтвердил варианты в выбранном каталоге. Это не означает, что товара нет в магазине. Можно уточнить марку или воспользоваться ручным поиском.",
    items: [], primaryAction: "Уточнить выбор", mascotState: "curious", selectionCards: focus.cards, selectionQuantity: focus.quantity
  } };
}

export function reviewedRetailSelection(card) { return getReviewedRetailBasketProduct(card); }
