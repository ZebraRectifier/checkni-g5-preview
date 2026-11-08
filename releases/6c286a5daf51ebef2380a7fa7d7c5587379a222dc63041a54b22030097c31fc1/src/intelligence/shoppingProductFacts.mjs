import { normalizeShoppingText, shoppingTargets, productShoppingTargets, isShoppingProductRejected } from "./shoppingConversation.mjs";
import { stripAssistantGreetingPrefix } from "./localAssistantDialogue.mjs";

const clean = value => normalizeShoppingText(stripAssistantGreetingPrefix(value));
const COMMERCIAL = /₽|руб|цен[ауы]|стоим|скидк|акци|дешев|налич|закаж|купить/u;
const ATTRIBUTES = /состав|ингредиент|аллерген|калори|бжу|белк|жирност|фасовк|упаковк|весит|объем|бренд|марк/u;
const STOP = /^(?:а|и|у|о|об|от|из|для|в|на|по|с|со|про|ли|это|этот|этого|этой|какой|какая|какое|какие|каков|какова|сколько|что|ты|мне|указан|указано|есть|тут|здесь|экране|текущем|каталоге|покажи|расскажи|товар\S*|карточк\S*|состав\S*|ингредиент\S*|аллерген\S*|калори\S*|бжу|белк\S*|жирност\S*|фасовк\S*|упаковк\S*|весит|объем\S*|бренд\S*|марк\S*)$/u;
const safe = (value, max) => typeof value === "string" && value.trim() && value.length <= max && !/[<>\u0000-\u001f]/u.test(value);
const tokens = value => clean(value).match(/[а-яa-z0-9]+/gu) ?? [];

export function isShoppingProductFactsQuestion(text) {
  const value = clean(text);
  return !COMMERCIAL.test(value) && (
    /^(?:а )?(?:како[йе]|какая|какие|каков[а]?|сколько|что|расскажи|покажи)/u.test(value) && ATTRIBUTES.test(value)
    || /^(?:а )?расскажи (?:мне )?(?:про|о) /u.test(value) && shoppingTargets(value).length > 0
  );
}

// Only the current screen's admitted card fields. This is neither a product
// identity confirmation nor a composition/price/inventory inference.
export function localShoppingProductFacts(text, catalog, memory) {
  if (!isShoppingProductFactsQuestion(text)) return null;
  const question = clean(text);
  const targets = shoppingTargets(question);
  const qualifiers = tokens(question).filter(word => !STOP.test(word) && !shoppingTargets(word).length);
  const rows = Array.isArray(catalog) ? catalog.slice(0, 500).filter(row => (
    safe(row?.id, 180) && safe(row.name, 150) && safe(row.unit, 80)
    && !isShoppingProductRejected(row, memory)
    && (!targets.length || targets.every(target => productShoppingTargets(row).includes(target)))
    && qualifiers.every(word => tokens(row.name + " " + row.unit).some(token => (
      word.length >= 6 && token.length >= 6 ? token.slice(0, 6) === word.slice(0, 6) : token === word
    )))
  )) : [];
  const unique = [...new Map(rows.map(row => [row.id, row])).values()];
  if (!unique.length) return { kind: "advice", message: "В текущих карточках не нашла подходящий товар. Открой нужный раздел или найди товар, затем спроси о нём. Для состава и пищевой ценности нужна этикетка." };
  const names = unique.slice(0, 3).map(row => `${row.name} · ${row.unit}`).join("; ");
  return { kind: "advice", message: `Из карточек на этом экране: ${names}. ${unique.length > 1 ? "Уточни, какую упаковку разбираем. " : ""}Состав и пищевая ценность в доступных полях не указаны — для них нужна этикетка.` };
}
