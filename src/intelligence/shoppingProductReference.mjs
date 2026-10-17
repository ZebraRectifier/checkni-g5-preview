import { normalizeShoppingText, shoppingTargets } from "./shoppingConversation.mjs";
import { stripAssistantGreetingPrefix } from "./localAssistantDialogue.mjs";

// Curated general facts, checked 2026-10-11. This is not SKU composition,
// retailer assortment, a recipe safety guarantee, or a medical reference.
const source = (title, url) => Object.freeze({ title, url });
const CHEESE = source("Tetra Pak · виды сыра", "https://dairyprocessinghandbook.tetrapak.com/chapter/cheese");
const FERMENTED = source("Tetra Pak · кисломолочные продукты", "https://dairyprocessinghandbook.tetrapak.com/chapter/fermented-milk-products");
const HEAT = source("Tetra Pak · тепловая обработка", "https://dairyprocessinghandbook.tetrapak.com/chapter/heat-exchangers");
const LABEL = source("Роспотребнадзор · этикетка и хранение", "https://04.rospotrebnadzor.ru/index.php/information-for-businesses/helpful-information/18632-27072023.html");
const MEAT = source("Роспотребнадзор · мясные продукты", "https://zpp.rospotrebnadzor.ru/news/federal/248504");
const MARKING = source("Роспотребнадзор · как читать этикетку", "https://zpp.rospotrebnadzor.ru/news/federal/576105");
const READY = source("Роспотребнадзор · готовая еда", "https://zpp.rospotrebnadzor.ru/news/federal/323866");
const FROZEN_FISH = source("FDA · выбор свежей и замороженной рыбы", "https://www.fda.gov/food/buy-store-serve-safe-food/selecting-and-serving-fresh-and-frozen-seafood-safely");
const APPLE_MATURITY = source("UMN Extension · спелость яблок", "https://blog-fruit-vegetable-ipm.extension.umn.edu/2018/08/check-apple-ripeness-with-starch-iodine.html");
const APPLE_VARIETIES = source("UMD Extension · сорта яблок", "https://extension.umd.edu/resource/important-apple-cultivars-mid-atlantic-region-eb-2023-0684");
const SOURCES = Object.freeze({
  "milk-kefir": Object.freeze([FERMENTED, HEAT]),
  "milk-treatment": Object.freeze([HEAT, LABEL]),
  "kefir-yoghurt": Object.freeze([FERMENTED, LABEL]),
  "cheese-selection": Object.freeze([CHEESE, LABEL]),
  "cheese-types": Object.freeze([CHEESE]),
  "dairy-storage": Object.freeze([LABEL]),
  "mince-selection": Object.freeze([MEAT, MARKING]),
  "meat-selection": Object.freeze([MEAT, MARKING]),
  "ready-meal-selection": Object.freeze([READY, MARKING]),
  "food-label-storage": Object.freeze([MARKING]),
  "dialogue-fish-frozen-packaging": Object.freeze([FROZEN_FISH]),
  "dialogue-apple-colour": Object.freeze([APPLE_MATURITY, APPLE_VARIETIES])
});

// Match the complete supported question, so an uncovered second product or
// condition cannot disappear into a generic meat/ready-food answer.
const MINCE_SUBJECT = "(?:(?:куриный|говяжий) )?фарш";
const MEAT_SUBJECT = "(?:мясо|куриц[ау]|куриное филе|филе курицы|говядин[ау])";
const READY_SUBJECT = "(?:готовую еду|готовая еда|готовое блюдо|готовые блюда|полуфабрикаты)";
const selection = (subject, purpose = "") => new RegExp("^(?:(?:подскажи|посоветуй|помоги) )?(?:как (?:правильно )?выбрать (?:хороший )?" + subject
  + "|(?:како[йея]|какую|какие) " + subject + " (?:лучше(?: (?:выбрать|взять))?|выбрать|взять))" + purpose + "(?: хочется другой вариант)?$", "u");
const MINCE_SELECTION = selection(MINCE_SUBJECT, "(?: (?:а )?(?:для (?:котлет|соуса|начинки)|на котлеты))?");
const MEAT_SELECTION = selection(MEAT_SUBJECT);
const READY_SELECTION = selection(READY_SUBJECT, "(?: (?:а )?(?:без (?:готовки|разогрева)|только разогреть|разогреть|(?:в )?микроволновк[ае]))?");
const FOOD_STORAGE = new RegExp("^(?:(?:подскажи|помоги) )?(?:как|сколько) (?:его )?хранить (?:" + MINCE_SUBJECT + "|" + MEAT_SUBJECT + "|" + READY_SUBJECT
  + ")(?: после (?:открытия|вскрытия)(?: упаковки)?)?$", "u");
const READY_DIFFERENCE = /^(?:чем готовое блюдо отличается от сырого полуфабриката|в чем разница между готовым блюдом и сырым полуфабрикатом)$/u;
function everydayQuestion(text) {
  const value = normalizeShoppingText(stripAssistantGreetingPrefix(text)).replace(/[?!.,;]+/gu, " ").replace(/\s+/gu, " ").trim().replace(/^а /u, "");
  if (MINCE_SELECTION.test(value)) return { subject: "фарш", key: "mince-selection", value };
  if (MEAT_SELECTION.test(value)) return { subject: "мясо", key: "meat-selection", value };
  if (READY_SELECTION.test(value) || READY_DIFFERENCE.test(value)) return { subject: "готовую еду", key: "ready-meal-selection", value };
  if (FOOD_STORAGE.test(value)) return { subject: /фарш/u.test(value) ? "фарш" : /готов|полуфабрикат/u.test(value) ? "готовую еду" : "мясо", key: "food-label-storage", value };
  return null;
}

// A bounded subject for short selection answers; never a canonical SKU,
// retailer identity, household inventory or persisted transcript.
export function shoppingReferenceSubject(text) {
  return everydayQuestion(text)?.subject ?? null;
}

function everydayReference(question, context) {
  const { key, value } = question;
  let message;
  if (key === "mince-selection") {
    const purpose = /котлет/u.test(value) ? "Для котлет" : /соус/u.test(value) ? "Для соуса" : /начинк/u.test(value) ? "Для начинки" : null;
    message = purpose ? purpose + " сравни вид мяса, состав и жирность по этикетке. Если хочешь сам добавить приправы, ищи вариант без уже добавленных специй."
      : "Сначала посмотри, из какого мяса сделан фарш, затем сравни состав и жирность по этикетке.";
    message += " Проверь дату изготовления, срок годности и условия хранения; упаковка должна быть целой.";
    message += context.cookingEffort === "minimal"
      ? " Если хочется меньше готовить, можно выбрать готовое блюдо, которое по инструкции достаточно разогреть: сырой фарш ещё требует приготовления. Тебе нужен сырой фарш или готовое блюдо?"
      : purpose ? " Приготовление — по выбранному рецепту; по одному названию точный состав не определить."
        : " Для чего выбираешь: котлеты, соус или начинка?";
  } else if (key === "meat-selection") {
    message = "Сначала реши, нужен целый кусок или уже подготовленные порции. Проверь вид мяса, дату изготовления, срок годности и условия хранения. Упаковка должна быть целой; состав маринованного продукта смотри на этикетке. Готовишь сегодня или берёшь в запас?";
  } else if (key === "food-label-storage") {
    message = "Смотри срок годности и условия хранения на этикетке именно этой упаковки. После вскрытия проверь отдельные указания производителя: срок закрытой упаковки нельзя автоматически переносить на открытую. Напиши указания с этикетки — помогу их разобрать.";
  } else {
    message = /без разогрева/u.test(value)
      ? "Ищи готовый продукт, который по инструкции можно есть без разогрева."
      : /разогреть|микроволновк/u.test(value)
        ? "Ищи готовое блюдо с инструкцией по разогреву в микроволновке."
        : "Для минимума готовки выбирай готовое блюдо, которое по инструкции можно съесть сразу или разогреть.";
    message += " Сырые полуфабрикаты ещё нужно приготовить — само слово «полуфабрикат» не означает готовый обед. Проверь дату изготовления, срок годности, условия хранения и способ приготовления на упаковке.";
    if (!/без разогрева|разогреть|микроволновк/u.test(value) && !READY_DIFFERENCE.test(value)) message += " Хочешь совсем без разогрева или микроволновка подходит?";
  }
  return Object.freeze({ key, message });
}

// Only allowlisted source identities can become links. Provider text never
// supplies a URL or selects a source. Unknown keys have no provenance.
export function shoppingReferenceSources(key) {
  return typeof key === "string" && Object.hasOwn(SOURCES, key) ? SOURCES[key] : [];
}

export function matchShoppingProductReference(text, context = {}) {
  const value = normalizeShoppingText(stripAssistantGreetingPrefix(text));
  if (!value || value.length > 300 || /₽|руб|цен[ауы]|стоим|дешев|налич|закаж|добавь|убери|замени|полез|здоров|аллерг|лактоз|леч|диабет|холестерин|ребен|дет[ия]/u.test(value)) return null;
  if (/(?:како[йея]|что).{0,15}(?:состав|ингредиент|бренд|марк)|сколько.{0,20}(?:калор|белк|грамм)/u.test(value)) return null;
  const everyday = everydayQuestion(value);
  if (everyday) return everydayReference(everyday, context);
  const targets = shoppingTargets(value);
  // These subjects are not covered by this small dairy reference. A mixed
  // question must not silently drop its other product or medical condition.
  if (/рыб|мяс|фарш|куриц|говядин|полуфабрикат|готов.{0,10}(?:ед|блюд)|ряжен|сметан|творог|сливки|масло/u.test(value)) return null;
  const difference = /отлич|разниц|сравн/u.test(value);
  let key, message;
  if (difference && targets.length === 2 && targets.includes("milk") && targets.includes("kefir") && !/йогурт/u.test(value)) {
    key = "milk-kefir";
    message = "Кефир делают сквашиванием молока; он обычно кислее и гуще. Пастеризованное и ультрапастеризованное молоко проходит тепловую обработку. У конкретной упаковки смотри вид продукта, состав и жирность на этикетке. Для чего выбираешь: напиток или готовка?";
  } else if (difference && targets.length === 1 && targets.includes("milk") && /(?:^|[^а-я])пастериз/u.test(value) && /ультрапастериз|\buht\b/u.test(value)) {
    key = "milk-treatment";
    message = "Разница — в режиме тепловой обработки. Пастеризация и UHT — оба способы нагревания молока; при UHT используют кратковременный нагрев до более высокой температуры. Срок и условия хранения, особенно после открытия, проверь на конкретной упаковке.";
  } else if (difference && targets.length === 1 && targets.includes("kefir") && /йогурт/u.test(value)) {
    key = "kefir-yoghurt";
    message = "Кефир и йогурт делают сквашиванием, но закваски различаются: в производстве кефира участвуют бактерии и дрожжи, йогурта — определённые молочнокислые бактерии. Йогурт бывает и питьевым, и густым, поэтому сравнивать их только по густоте не стоит. Добавки и состав конкретной упаковки проверь на этикетке.";
  } else if (/хран/u.test(value) && targets.length && targets.every(key => ["cheese", "milk", "kefir"].includes(key))) {
    key = "dairy-storage";
    message = "Ориентируйся на срок годности и условия хранения именно твоей упаковки. После вскрытия смотри отдельные указания производителя; срок для закрытой упаковки нельзя автоматически переносить на открытую. Напиши вид продукта и указания с этикетки — разберём их.";
  } else if (targets.length === 1 && targets.includes("cheese") && difference && /тверд|мягк|сливочн|творожн/u.test(value)) {
    key = "cheese-types";
    message = "Твёрдые, полутвёрдые и мягкие сыры различаются в том числе влагой и текстурой. Мягкий сливочный сыр легко намазывается, а вкус зависит от вида и способа изготовления. Для конкретной упаковки состав нужно проверить по этикетке.";
  } else if (targets.length === 1 && targets.includes("cheese") && /выб|како[йея]/u.test(value)) {
    key = "cheese-selection";
    message = /другой вариант/u.test(value)
      ? "Если хочется другой формат, посмотри на мягкий сливочный сыр: его удобно использовать как намазку. По одному названию вкус и состав конкретной упаковки не определить. Хочешь вариант для холодного перекуса или горячего блюда?"
      : /бутерброд/u.test(value)
        ? "Для бутербродов можно выбрать ломтики или цельный кусок для нарезки; мягкий сливочный сыр удобно использовать как намазку. Состав, массу и срок хранения конкретной упаковки проверь по этикетке. Тебе удобнее намазка или ломтики?"
        : /пицц|запекан|горяч/u.test(value)
          ? "Для горячего блюда посмотри рекомендации производителя по применению сыра и состав на этикетке. По одной надписи «полутвёрдый» не обещаю, как поведёт себя конкретная упаковка при нагреве. Что готовишь: пиццу, запеканку или другое блюдо?"
          : "Для начала выбери формат: ломтики или цельный кусок. Мягкий сливочный сыр — ещё один вариант, если нужен сыр для намазки. У конкретной упаковки проверь состав, массу, срок годности и условия хранения. Для чего выбираешь сыр?";
  }
  return key ? Object.freeze({ key, message }) : null;
}
