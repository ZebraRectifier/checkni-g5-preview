import { normalizeShoppingText, shoppingTargets } from "./shoppingConversation.mjs";
import { stripAssistantGreetingPrefix } from "./localAssistantDialogue.mjs";

// Curated general facts, checked 2026-10-11. This is not SKU composition,
// retailer assortment, a recipe safety guarantee, or a medical reference.
const source = (title, url) => Object.freeze({ title, url });
const CHEESE = source("Tetra Pak · виды сыра", "https://dairyprocessinghandbook.tetrapak.com/chapter/cheese");
const FERMENTED = source("Tetra Pak · кисломолочные продукты", "https://dairyprocessinghandbook.tetrapak.com/chapter/fermented-milk-products");
const HEAT = source("Tetra Pak · тепловая обработка", "https://dairyprocessinghandbook.tetrapak.com/chapter/heat-exchangers");
const LABEL = source("Роспотребнадзор · этикетка и хранение", "https://04.rospotrebnadzor.ru/index.php/information-for-businesses/helpful-information/18632-27072023.html");
const SOURCES = Object.freeze({
  "milk-kefir": Object.freeze([FERMENTED, HEAT]),
  "milk-treatment": Object.freeze([HEAT, LABEL]),
  "kefir-yoghurt": Object.freeze([FERMENTED, LABEL]),
  "cheese-selection": Object.freeze([CHEESE, LABEL]),
  "cheese-types": Object.freeze([CHEESE]),
  "dairy-storage": Object.freeze([LABEL])
});

// Only allowlisted source identities can become links. Provider text never
// supplies a URL or selects a source. Unknown keys have no provenance.
export function shoppingReferenceSources(key) {
  return typeof key === "string" && Object.hasOwn(SOURCES, key) ? SOURCES[key] : [];
}

export function matchShoppingProductReference(text) {
  const value = normalizeShoppingText(stripAssistantGreetingPrefix(text));
  if (!value || value.length > 300 || /₽|руб|цен[ауы]|стоим|дешев|налич|закаж|добавь|убери|замени|полез|здоров|аллерг|лактоз|леч|диабет|холестерин|ребен|дет[ия]/u.test(value)) return null;
  if (/(?:како[йея]|что).{0,15}(?:состав|ингредиент|бренд|марк)|сколько.{0,20}(?:калор|белк|грамм)/u.test(value)) return null;
  const targets = shoppingTargets(value);
  // These subjects are not covered by this small dairy reference. A mixed
  // question must not silently drop its other product or medical condition.
  if (/рыб|мяс|ряжен|сметан|творог|сливки|масло/u.test(value)) return null;
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
