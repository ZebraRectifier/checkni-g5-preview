import { shoppingTargetLabel, shoppingTargets } from "./shoppingConversation.mjs";
import { stripAssistantGreetingPrefix } from "./localAssistantDialogue.mjs";

export function shoppingAdviceTopic(text) {
  const value = stripAssistantGreetingPrefix(String(text)).normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
  if (/^(?:а )?(?:почему|зачем|объясни).*(?:выбр|так|это|эти|именно|набор|корзин|подбор)/u.test(value)) return "explanation";
  if (/^(?:а )?(?:что ты помнишь|какие (?:мои )?пожелания|что мы решили)/u.test(value)) return "preferences";
  return !/₽|руб|цен[ауы]|стоим|скидк|акци|дешев|налич/u.test(value)
    && /^(?:а )?(?:как|како[йея]|какие|чем|расскажи|что (?:можно|скажешь|посоветуешь))/u.test(value)
    && (shoppingTargets(value).length || /продукт|покуп|корзин|готов|хран|поесть|перекус|круп|ужин|завтрак|кофе|ча[йяю]|мяс|рыб/u.test(value)) ? "advice" : null;
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

export function localShoppingExplanation(topic, memory, catalog, plan) {
  const names = plan.slice(0, 3).map(row => catalog.find(product => product.id === row.productId)?.name).filter(Boolean);
  const reasons = [];
  if (memory.facts.cookingEffort?.value === "minimal") reasons.push(memory.facts.cookingEffort.origin === "explicit"
    ? "ты просил минимум готовки" : "предположила, что сейчас удобнее минимум готовки; поправь, если ошиблась");
  if (Object.keys(memory.wishes).length) reasons.push(`учла пожелания: ${Object.keys(memory.wishes).map(shoppingTargetLabel).join(", ")}`);
  if (Object.keys(memory.rejected).length) reasons.push(`исключила: ${Object.keys(memory.rejected).map(shoppingTargetLabel).join(", ")}`);
  if (memory.facts.budgetMinor) reasons.push("сохраняю заданный бюджет; текущую сумму ещё нужно проверить");
  if (memory.facts.brandStyle?.value === "specific") reasons.push("марки показываю только там, где они указаны в данных товара");
  if (memory.facts.unresolvedConstraints) reasons.push(`ещё нужно уточнить условие: ${memory.facts.unresolvedConstraints.value.join("; ")}`);
  if (topic === "preferences") return reasons.length ? `Помню твои условия: ${reasons.join("; ")}. Можно изменить любое из них или сказать «сбрось предпочтения».` : "Пока предпочтений нет. Скажи бюджет, что любишь есть и сколько готовки тебе подходит.";
  return names.length ? `Начала с ${names.join(", ")}${reasons.length ? `, потому что ${reasons.join("; ")}` : ": это простой стартовый набор, который можно изменить"}. Это предложение — конкретные товары и стоимость проверяем по каталогу и сравнению.`
    : "Пока набора нет. Скажи бюджет и хочется ли готовить — тогда предложу варианты и объясню выбор.";
}
