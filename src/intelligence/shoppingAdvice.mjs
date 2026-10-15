import { shoppingTargetLabel, shoppingTargets, productShoppingTargets } from "./shoppingConversation.mjs";
import { stripAssistantGreetingPrefix } from "./localAssistantDialogue.mjs";
import { normalizeShoppingAdviceRequest, normalizeShoppingAdviceResponse } from "./shoppingAdviceContract.mjs";
import { formatRubMinor } from "../components/ComparisonResult.mjs";
import { matchShoppingProductReference } from "./shoppingProductReference.mjs";
import { shoppingDaysText } from "./shoppingNeedContext.mjs";

export function shoppingAdviceTopic(text) {
  const value = stripAssistantGreetingPrefix(String(text)).normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
  if (/^(?:а )?(?:почему|зачем|объясни).*(?:выбр|так|это|эти|именно|набор|корзин|подбор)/u.test(value)) return "explanation";
  if (/^(?:а )?(?:что ты помнишь|какие (?:мои )?пожелания|что мы решили)/u.test(value)) return "preferences";
  return !/₽|руб|цен[ауы]|стоим|скидк|акци|дешев|налич/u.test(value)
    && (/^(?:а )?(?:как|како[йея]|какие|(?:в )?чем|расскажи|сколько.{0,30}хран|можно ли хран|что (?:можно|скажешь|посоветуешь|приготовить|съесть|выбрать))/u.test(value)
      || /^(?:а )?(?:подскажи|посоветуй|помоги)[,\s]+(?:как|како[йея]|какие|(?:в )?чем|что|выбрать|приготовить|съесть)(?=\s|$)/u.test(value))
    && (shoppingTargets(value).length || /продукт|покуп|корзин|готов|хран|поесть|перекус|круп|ужин|завтрак|кофе|ча[йяю]|мяс|фарш|рыб/u.test(value)) ? "advice" : null;
}

export function shoppingAdviceInput(text, memory, catalog, plan) {
  const selected = plan.map(row => row.productId).slice(0, 8);
  const preferred = new Set(selected);
  const hints = [...catalog.filter(row => preferred.has(row.id)), ...catalog.filter(row => !preferred.has(row.id))]
    .slice(0, 20).map(({ id, name, unit }) => ({ id, name, unit }));
  return { mode: "advice", text, catalog: hints, context: {
    budgetMinor: memory.facts.budgetMinor?.value ?? null,
    cookingEffort: memory.facts.cookingEffort?.origin === "explicit" ? memory.facts.cookingEffort.value : null,
    excluded: Object.keys(memory.rejected), wishes: Object.keys(memory.wishes), selectedProductIds: selected.filter(id => hints.some(row => row.id === id))
  } };
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
  if (/готов|поесть|перекус|ужин|завтрак/u.test(value) && !targets.length) {
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

export function localShoppingExplanation(topic, memory, catalog, plan) {
  const names = plan.slice(0, 3).map(row => catalog.find(product => product.id === row.productId)?.name).filter(Boolean);
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
  return names.length ? `Начала с ${names.join(", ")}${reasons.length ? `, потому что ${reasons.join("; ")}` : ": это простой стартовый набор, который можно изменить"}. Это предложение — конкретные товары и стоимость проверяем по каталогу и сравнению.`
    : "Пока набора нет. Скажи бюджет и хочется ли готовить — тогда предложу варианты и объясню выбор.";
}
