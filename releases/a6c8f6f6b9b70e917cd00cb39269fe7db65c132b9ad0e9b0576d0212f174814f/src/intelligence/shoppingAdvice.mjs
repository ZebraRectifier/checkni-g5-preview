import { shoppingTargetLabel, shoppingTargets, productShoppingTargets } from "./shoppingConversation.mjs";
import { stripAssistantGreetingPrefix } from "./localAssistantDialogue.mjs";
import { normalizeShoppingAdviceRequest, normalizeShoppingAdviceResponse } from "./shoppingAdviceContract.mjs";
import { formatRubMinor } from "../components/ComparisonResult.mjs";
import { matchShoppingProductReference } from "./shoppingProductReference.mjs";
import { shoppingDaysText } from "./shoppingNeedContext.mjs";
import { detectRetailerId } from "./shoppingAssistantOrchestrator.mjs";

export function shoppingAdviceTopic(text) {
  const value = stripAssistantGreetingPrefix(String(text)).normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е")
    .replace(/\s+/gu, " ").trim().replace(/^(?:(?:ну|короче|блин|бля(?:ть)?)\s*[,—-]?\s+)+/u, "");
  if (/^(?:а )?(?:почему|зачем|объясни).*(?:выбр|так|это|эти|именно|набор|корзин|подбор|дешев|побед|сравнен|магазин|адрес|выгод|итог|сумм|стоим)/u.test(value)) return "explanation";
  if (/^(?:а )?(?:что ты помнишь|какие (?:мои )?пожелания|что мы решили)/u.test(value)) return "preferences";
  // A question can be conversational without becoming permission to change a
  // basket. Mixed commands and commercial questions keep their existing tools.
  if (/₽|руб|цен[ауы]|стоим|скидк|акци|дешев|налич/u.test(value)
    || /(?:^|[.!?;,]\s*|\sи\s)(?:а\s+)?(?:добавь|положи|убери|удали|замени|собери|составь|закажи|купи)(?=\s|$)/u.test(value)) return null;
  const subject = shoppingTargets(value).length || /продукт|покуп|корзин|готов|хран|поесть|перекус|круп|ужин|завтрак|обед|кофе|ча[йяю]|мяс|фарш|рыб/u.test(value);
  const question = /^(?:а )?(?:как|како[йея]|какую|какие|(?:в )?чем|расскажи|сколько.{0,30}хран|можно ли хран|что (?:можно|скажешь|посоветуешь|приготовить|съесть|выбрать))/u.test(value)
    || /^(?:а )?(?:(?:можешь|могла бы)\s+)?(?:подскажи|подсказать|посоветуй|посоветовать|помоги)[,\s]+(?:как|како[йея]|какую|какие|(?:в )?чем|что(?:-нибудь|-то)?|выбрать|приготовить|съесть)(?=[,\s]|$)/u.test(value)
    || /^(?:а )?(?:я )?хочу (?:понять|разобраться|узнать)[,:\s]+(?:как|како[йея]|какую|какие|что|(?:в )?чем)(?=\s|$)/u.test(value)
    || /^(?:а )?можно (?:мне |нам )?(?:что(?:-нибудь|-то)?|чего-нибудь)(?=\s|$)/u.test(value)
    || /(?:^|[,;.!?]\s*|\s)(?:что (?:скажешь|думаешь|посоветуешь)|как думаешь)[?!\.]*$/u.test(value);
  return subject && question ? "advice" : null;
}

export function shoppingAdviceInput(text, memory, catalog, plan, confirmedBasket, history = []) {
  // Confirmed rows carry the shopper's chosen identity/name/package. Project
  // only those fields; prices, addresses and stock never enter provider advice.
  const actual = Array.isArray(confirmedBasket) ? confirmedBasket : null;
  const products = actual?.map(({ id, name, unit }) => ({ id, name, unit })) ?? [];
  const actualIds = new Set(products.map(row => row.id));
  const source = actual ? [...products, ...catalog.filter(row => !actualIds.has(row.id))] : catalog;
  const selected = [...new Set(actual ? actual.map(row => row.id) : plan.map(row => row.productId))].slice(0, 8);
  const preferred = new Set(selected);
  // "From my basket" must not quietly acquire unrelated seed ingredients.
  // The basket records intended purchases, never groceries already at home.
  const basketScoped = actual !== null && /из\s+(?:(?:моей|этой|текущей|подтвержд[её]нной)\s+)?корзины/iu.test(text);
  const choices = basketScoped ? products : source;
  const hints = [...choices.filter(row => preferred.has(row.id)), ...choices.filter(row => !preferred.has(row.id))]
    .slice(0, 20).map(({ id, name, unit }) => ({ id, name, unit }));
  const request = { mode: "advice", text, catalog: hints, context: {
    budgetMinor: memory.facts.budgetMinor?.value ?? null,
    cookingEffort: memory.facts.cookingEffort?.origin === "explicit" ? memory.facts.cookingEffort.value : null,
    excluded: Object.keys(memory.rejected), wishes: Object.keys(memory.wishes), selectedProductIds: selected.filter(id => hints.some(row => row.id === id)),
    peopleCount: memory.facts.peopleCount?.value ?? null,
    shoppingDays: memory.facts.shoppingDays?.value ?? null
  }, ...(history.length ? { history: history.map(({ role, text }) => ({ role, text })) } : {}) };
  // Preserve active facts and selected identities. Evict complete oldest
  // exchanges first, then optional hints, to fit the existing Edge byte limit.
  const bytes = () => new TextEncoder().encode(JSON.stringify(request)).length;
  while (bytes() > 8192 && request.history?.length) request.history.splice(0, 2);
  if (request.history?.length === 0) delete request.history;
  while (bytes() > 8192) {
    const index = request.catalog.findLastIndex(row => !request.context.selectedProductIds.includes(row.id));
    if (index < 0 || request.catalog.length <= 1) break;
    request.catalog.splice(index, 1);
  }
  return request;
}

export function localShoppingComparisonExplanation(text, confirmedBasket) {
  const value = stripAssistantGreetingPrefix(String(text)).normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  if (!/^(?:а )?(?:почему|зачем|объясни)/u.test(value)
    || !/магазин|адрес|дешев|выгод|побед|сравнен|итог|сумм|стоим/u.test(value) && !detectRetailerId(value)) return null;
  // This flow has no address/freshness-bound Core receipt. An old draft or
  // provider prose cannot explain a current winner. Keep that limit explicit.
  return confirmedBasket.length
    ? "Чтобы объяснить выбор магазина, нужен актуальный результат для текущей корзины и выбранных адресов. Нажми «Где дешевле?» ещё раз: сравнение проверит суммы и покрытие. Товары в корзине сохранены."
    : "Сначала добавь товары в корзину и нажми «Где дешевле?». Выбор магазина можно объяснить только по актуальному сравнению выбранных адресов.";
}

// References run before the provider, share the same prose/exclusion guards,
// and expose provenance only through an internal, allowlisted identity.
export function localShoppingReference(input) {
  const request = normalizeShoppingAdviceRequest(input);
  if (!request || shoppingAdviceTopic(request.text) !== "advice") return null;
  if (productShoppingTargets({ name: request.text }).some(key => request.context.excluded.includes(key))) return null;
  const match = matchShoppingProductReference(request.text, request.context);
  if (!match) return null;
  const reply = normalizeShoppingAdviceResponse({ kind: "advice", message: match.message }, request.context);
  return reply ? Object.freeze({ reply, referenceKey: match.key }) : null;
}

export function localShoppingProductReference(input) {
  return localShoppingReference(input)?.reply ?? null;
}

// A small read-only recovery for everyday questions. Catalog hints are possible
// choices, never proof of groceries at home or of a store's stock/composition.
export function localShoppingAdvice(input) {
  const request = normalizeShoppingAdviceRequest(input);
  if (!request || shoppingAdviceTopic(request.text) !== "advice") return null;
  const reference = localShoppingProductReference(request);
  if (reference) return reference;
  const value = stripAssistantGreetingPrefix(request.text).normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  const targets = shoppingTargets(value).filter(key => !request.context.excluded.includes(key));
  const allowed = request.catalog.filter(product => !productShoppingTargets(product).some(key => request.context.excluded.includes(key)));
  const find = target => allowed.find(product => productShoppingTargets(product).includes(target));
  let message;
  // Narrow outage recovery for a reproduced apple-selection error. Colour and
  // firmness are variety-dependent, not universal tests of ripeness:
  // https://blog-fruit-vegetable-ipm.extension.umn.edu/2018/08/check-apple-ripeness-with-starch-iodine.html
  // Undamaged produce selection:
  // https://www.fda.gov/food/buy-store-serve-safe-food/selecting-and-serving-produce-safely
  // Match the whole supported question so a second product, medical condition
  // or cooking purpose cannot disappear into this general selection answer.
  const appleSelection = /^(?:(?:а|подскажи|посоветуй|помоги)[,\s]+)?(?:как (?:правильно )?выбрать (?:спелые |хорошие )?яблоки|какие яблоки (?:лучше (?:взять|выбрать)|выбрать|взять))[?!\.]*$/u.test(value);
  if (appleSelection && !request.context.excluded.includes("apples") && !request.context.excluded.includes("fruit")) {
    message = "Выбирай яблоки без вмятин и повреждений кожуры. Цвет и плотность зависят от сорта: зелёная кожура сама по себе не означает, что яблоко неспелое, а мягкость не обязательна. Если можно попробовать, оцени вкус и текстуру; спелое яблоко тоже может быть кислым. Для чего выбираешь: съесть свежими или для блюда?";
  } else if (/готов|поесть|перекус|ужин|завтрак/u.test(value) && !targets.length) {
    const bread = find("bread"), cheese = find("cheese");
    const fruit = find("apples") ?? find("bananas");
    if (bread && cheese) {
      message = `Можно сделать простой перекус: «${bread.name}» и «${cheese.name}». Нарежь хлеб и положи сверху сыр — плита не нужна.`;
      if (fruit && request.context.wishes.includes("fruit")) message += ` Рядом можно подать «${fruit.name}».`;
      message += " Что из этого уже дома?";
    } else if (fruit) {
      message = `Для перекуса без плиты можно выбрать «${fruit.name}». Это лёгкий вариант; для полноценного ужина нужно подобрать что-то ещё. Какие продукты ты хочешь использовать?`;
    } else message = "Подберу вариант с минимумом готовки. Какие продукты ты хочешь использовать и есть ли микроволновка?";
  } else if (/как.{0,20}выб|како[йея].{0,20}(?:сыр|выб)/u.test(value) && targets.includes("cheese") && !request.context.excluded.includes("cheese")) {
    message = /бутерброд/u.test(value)
      ? "Для бутербродов удобны готовые ломтики: не придётся нарезать сыр. Если берёшь цельный кусок, выбери размер упаковки под свой расход. Состав и срок хранения проверь на этикетке."
      : /другой вариант/u.test(value)
        ? "Какой вариант сыра хочется: готовые ломтики или цельный кусок? Подберём формат под твой перекус; состав конкретной упаковки нужно проверить по этикетке."
        : "Для простого перекуса удобны ломтики: меньше подготовки. Цельный кусок подойдёт, если хочешь нарезать сам. Сравни состав, массу упаковки и срок хранения на этикетке. По одному названию конкретный состав не определить.";
  } else message = "Уточни, что важнее: вкус, размер упаковки или минимум готовки? Для точного совета о конкретном товаре нужен его состав с этикетки.";
  return normalizeShoppingAdviceResponse({ kind: "advice", message }, request.context);
}

export function localShoppingExplanation(topic, memory, catalog, plan, confirmedBasket) {
  const actual = Array.isArray(confirmedBasket) ? confirmedBasket : null;
  const names = actual ? actual.slice(0, 3).map(row => `${row.name} ×${row.quantity}`)
    : plan.slice(0, 3).map(row => catalog.find(product => product.id === row.productId)?.name).filter(Boolean);
  const reasons = [];
  if (memory.facts.peopleCount) reasons.push(`покупки для ${memory.facts.peopleCount.value} чел.`);
  if (memory.facts.shoppingDays) reasons.push(`покупки на ${shoppingDaysText(memory.facts.shoppingDays.value)}`);
  if (memory.facts.cookingEffort?.value === "minimal") reasons.push(memory.facts.cookingEffort.origin === "explicit"
    ? "ты просил минимум готовки" : "предположила, что сейчас удобнее минимум готовки; поправь, если ошиблась");
  if (Object.keys(memory.wishes).length) reasons.push(`учла пожелания: ${Object.keys(memory.wishes).map(shoppingTargetLabel).join(", ")}`);
  if (Object.keys(memory.rejected).length) reasons.push(`исключила: ${Object.keys(memory.rejected).map(shoppingTargetLabel).join(", ")}`);
  const budget = formatRubMinor(memory.facts.budgetMinor?.value);
  if (budget) reasons.push(`твой бюджет — ${budget}; текущую сумму ещё нужно проверить`);
  if (memory.facts.brandStyle?.value === "specific") reasons.push("марки показываю только там, где они указаны в данных товара");
  if (memory.facts.unresolvedConstraints) reasons.push(`ещё нужно уточнить условие: ${memory.facts.unresolvedConstraints.value.join("; ")}`);
  if (topic === "preferences") return reasons.length ? `Помню твои условия: ${reasons.join("; ")}. Можно изменить любое из них или сказать «сбрось предпочтения».` : "Пока предпочтений нет. Скажи бюджет, что любишь есть и сколько готовки тебе подходит.";
  if (actual?.length) return `В подтверждённой корзине сейчас: ${names.join(", ")}${actual.length > names.length ? ` и ещё ${actual.length - names.length} позиций` : ""}. `
    + (reasons.length ? `Сохранённые условия: ${reasons.join("; ")}. ` : "")
    + "Это твой текущий выбор. Актуальную стоимость и покрытие проверяем через «Где дешевле?»; по составу корзины нельзя объяснить победителя среди магазинов.";
  return names.length ? `Начала с ${names.join(", ")}${reasons.length ? `, потому что ${reasons.join("; ")}` : ": это простой стартовый набор, который можно изменить"}. Это предложение — конкретные товары и стоимость проверяем по каталогу и сравнению.`
    : "Пока набора нет. Скажи бюджет и хочется ли готовить — тогда предложу варианты и объясню выбор.";
}
