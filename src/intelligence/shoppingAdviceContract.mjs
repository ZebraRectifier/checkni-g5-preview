import { shoppingTargetLabel, productShoppingTargets } from "./shoppingConversation.mjs";

export const MAX_ADVICE_MESSAGE_LENGTH = 1000;
export const SHOPPING_ADVICE_SCHEMA = Object.freeze({ name: "checkni_shopping_advice", strict: true,
  schema: { type: "object", additionalProperties: false, required: ["message"],
    properties: { message: { type: "string", minLength: 1, maxLength: MAX_ADVICE_MESSAGE_LENGTH } } } });
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const boundedString = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
const targetList = (value, max) => Array.isArray(value) && value.length <= max && new Set(value).size === value.length
  && value.every(key => boundedString(key, 40) && shoppingTargetLabel(key) !== key);

export function normalizeShoppingAdviceRequest(input) {
  if (!exactKeys(input, ["mode", "text", "catalog", "context"]) || input.mode !== "advice"
    || !boundedString(input.text, 300) || !Array.isArray(input.catalog) || input.catalog.length < 1 || input.catalog.length > 20) return null;
  const ids = new Set();
  const catalog = [];
  for (const row of input.catalog) {
    if (!exactKeys(row, ["id", "name", "unit"]) || !boundedString(row.id, 100)
      || !boundedString(row.name, 150) || !boundedString(row.unit, 80) || ids.has(row.id)) return null;
    ids.add(row.id); catalog.push({ id: row.id, name: row.name, unit: row.unit });
  }
  const context = input.context;
  if (!exactKeys(context, ["budgetMinor", "cookingEffort", "excluded", "wishes", "selectedProductIds"])
    || !(context.budgetMinor === null || (Number.isSafeInteger(context.budgetMinor) && context.budgetMinor >= 1000 && context.budgetMinor <= 99999900))
    || ![null, "minimal", "normal"].includes(context.cookingEffort)
    || !targetList(context.excluded, 32) || !targetList(context.wishes, 16)
    || !Array.isArray(context.selectedProductIds) || context.selectedProductIds.length > 8
    || new Set(context.selectedProductIds).size !== context.selectedProductIds.length
    || context.selectedProductIds.some(id => !ids.has(id))) return null;
  return { mode: "advice", text: input.text, catalog, context: { budgetMinor: context.budgetMinor,
    cookingEffort: context.cookingEffort, excluded: [...context.excluded], wishes: [...context.wishes], selectedProductIds: [...context.selectedProductIds] } };
}

// Advice is a separate read-only surface. Commercial answers belong to Core/tools.
// Only defect-associated presence loses its ambiguous token for this one check.
// Stock wording and every other guard still inspect the complete original text.
const QUALITY_PRESENCE = /(?<![а-яё])наличи[ея](?=\s+(?:(?:т[её]мных|мягких|грубых|видимых)\s+)?(?:вмятин|пятен|повреждений)(?![а-яё]))/giu;
const COMMERCIAL = /₽|[$€]|\b(?:rub|rur|usd|eur)\b|(?<!\p{L})руб(?:л|ль|ля|лю|ли|лей|ле|л[её]м|лями|лях|лям|л[её]в[а-яё]*)?(?!\p{L})|\d\s*р\.(?:$|\s)|(?:^|[^а-я])цен[а-я]*|стоимост|стоит\s*(?:всего\s*|от\s*|около\s*)?\d|скидк|акци[яию]|налич[а-я]*|(?<![а-яё])(?:в\s+продаже|на\s+складе)(?![а-яё])|эконом|деш[её]в|выгод|сбереж|куп(?:и|ить).{0,40}за\s*\d|https?:\/\/|магнит|глобус|вкусвилл|пят[её]рочк|перекр[её]сток|чижик|(?:^|[^а-я])метро(?:$|[^а-я])/iu;
const MEDICAL = /пр[ое]биотик|иммунитет|усваива|пищевар|(?:^|[^а-я])леч(?:ит|ени|ебн)|диабет|холестерин|(?:полез|польз|вред|безопас|улучш|укрепл|восстанавл).{0,40}(?:здоров|кишеч|желуд|микрофлор|бактери|культур)|(?:кишеч|желуд|микрофлор).{0,40}(?:полез|польз|вред|улучш|укрепл|восстанавл)/iu;
const INVENTORY = /(?:у тебя|у вас)\s+(?:уже\s+)?(?:есть|имеется)|(?:продукты|товары)\s+уже\s+(?:дома|куплены|в корзине)/iu;
const COMPOSITION = /содерж(?:ит|ат)|вход(?:ит|ят)\s+в\s+состав|(?:состав|ингредиенты)\s*[:—-]|\d+(?:[.,]\d+)?\s*(?:ккал|г\s+белк)/iu;
const BASKET_CHANGE = /(?:добавил[а]?|убрал[а]?|удалил[а]?|заменил[а]?|поменял[а]?|изменил[а]?|собрал[а]?|оформил[а]?).{0,50}(?:корзин|заказ)|(?:^|\s)я\s+(?:уже\s+)?(?:добавила|убрала|заменила|удалила)/iu;
const ASSORTMENT = /(?:каталог|ассортимент|магазин|спис(?:ок|к)|подсказк).{0,60}(?:только|лишь|единствен|(?<![а-я])нет(?![а-я])|отсутств|доступ|представлен|прода[её]т)|(?<![а-я])(?:нет(?![а-я])|отсутств[а-я]*).{0,45}(?:в|из)\s+(?:эт(?:ом|ого)\s+)?(?:спис(?:ок|к)|подсказк)|(?:доступ|представлен|прода[её]т|есть)\S*.{0,15}(?:только|лишь|единствен)/iu;
// Reject untranslated phrases in provider prose, while leaving single brand
// names/technical acronyms available. Card facts and source labels use their
// separate local evidence path; this is not a general language classifier.
const FOREIGN_PHRASE = /\b[a-z]{3,}(?:[ -]+[a-z]{3,})+\b/iu;
const UNVERIFIED_RULE = /(?:выдержк|созреван).{0,35}(?:\d|двух|тр[её]х|четыр[её]х)|хран(?:и|ить|ится|ятся).{0,35}(?:\d+|два|две|три|четыре|пять).{0,12}(?:час|дн|дне|сут|недел|месяц)/iu;
export function shoppingAdviceResponseIssue(value, context = {}) {
  if (!exactKeys(value, ["kind", "message"]) || value.kind !== "advice") return "invalid_provider_advice";
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!message || message.length > MAX_ADVICE_MESSAGE_LENGTH || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(message)) return "provider_advice_invalid_text";
  if (COMMERCIAL.test(message.replace(QUALITY_PRESENCE, ""))) return "provider_advice_commercial_claim";
  if (MEDICAL.test(message)) return "provider_advice_medical_claim";
  if (BASKET_CHANGE.test(message)) return "provider_advice_basket_claim";
  if (ASSORTMENT.test(message)) return "provider_advice_assortment_claim";
  if (FOREIGN_PHRASE.test(message)) return "provider_advice_foreign_phrase";
  if (UNVERIFIED_RULE.test(message)) return "provider_advice_unverified_rule";
  if (message.split(/(?<=[.!?])\s+/u).some(sentence => COMPOSITION.test(sentence)
    && !/^(?:проверь|посмотри|уточни).{0,40}содержит ли/iu.test(sentence)
    && !/^(?:содержит ли|что содержит|какие ингредиенты)/iu.test(sentence) && !sentence.endsWith("?"))) return "provider_advice_unverified_composition";
  if (message.split(/(?<=[.!?])\s+/u).some(sentence => !sentence.endsWith("?") && INVENTORY.test(sentence)
    && !/(?:если|есть ли)\s+(?:у тебя|у вас)/iu.test(sentence))) return "provider_advice_inventory_claim";
  if (productShoppingTargets({ name: message }).some(key => context.excluded?.includes(key))) return "provider_advice_excluded_target";
  return null;
}

export function normalizeShoppingAdviceResponse(value, context = {}) {
  if (shoppingAdviceResponseIssue(value, context) !== null) return null;
  return Object.freeze({ kind: "advice", message: value.message.trim() });
}
