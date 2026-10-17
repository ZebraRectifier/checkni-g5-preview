import { normalizeShoppingAdviceRequest, normalizeShoppingAdviceResponse } from "./shoppingAdviceContract.mjs";
import { shoppingTargets, shoppingTargetLabel } from "./shoppingConversation.mjs";

const normalize = text => text.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е")
  .replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, "");
const fish = /(?<![а-я])рыб[а-я]*(?![а-я])/u;
const apples = /(?<![а-я])яблок[а-я]*(?![а-я])/u;
const fishScope = value => /^(?:рыба|рыбу|рыбы|рыбе)$/u.test(value);
const appleScope = value => /^(?:яблоки|яблоках|яблок)$/u.test(value);
const people = new Map([
  ["одного", 1], ["одну", 1], ["один", 1], ["одна", 1], ["одной", 1],
  ["двоих", 2], ["двух", 2], ["двое", 2], ["два", 2], ["две", 2],
  ["троих", 3], ["трех", 3], ["трое", 3], ["три", 3],
  ["четверых", 4], ["четырех", 4], ["четверо", 4], ["четыре", 4],
  ["пятерых", 5], ["пяти", 5], ["пятеро", 5], ["пять", 5],
  ["шестерых", 6], ["шести", 6], ["шестеро", 6], ["шесть", 6],
  ["семерых", 7], ["семи", 7], ["семеро", 7], ["семь", 7],
  ["восьмерых", 8], ["восьми", 8], ["восьмеро", 8], ["восемь", 8],
  ["девятерых", 9], ["девяти", 9], ["девятеро", 9], ["девять", 9],
  ["десятерых", 10], ["десяти", 10], ["десятеро", 10], ["десять", 10],
  ["одиннадцати", 11], ["одиннадцать", 11], ["двенадцати", 12], ["двенадцать", 12]
]);
const WHY = /^(?:(?:почему|зачем)(?: ты)?(?: (?:это|так)(?: (?:советуешь|предлагаешь|рекомендуешь|выбрала|нужно|лучше))?)?|объясни почему)$/u;
const GREEN = /^(?:зеленые(?: тоже)? можно|можно(?: ли)? зеленые|если зеленые|почему зеленые|цвет (?:важен|имеет значение)|что насчет цвета|чем красные отличаются от зеленых|чем зеленые отличаются от красных)$/u;
const FROZEN = /^(?:если замороженная|если замороженную|замороженная|замороженную|как выбрать замороженную рыбу(?: для супа)?)$/u;

function question(text) {
  const value = normalize(text);
  const scoped = /^про ([^:]{1,80}):\s*(.+)$/u.exec(value);
  return { scope: scoped?.[1] ?? null, text: (scoped?.[2] ?? value).replace(/^а /u, "") };
}

function matchingScope(scope, lastUser, lastReply) {
  const targets = shoppingTargets(lastUser);
  if (fishScope(scope)) return !targets.length && (fish.test(lastUser) || fish.test(lastReply));
  if (appleScope(scope)) return targets.every(key => key === "apples") && (apples.test(lastUser) || apples.test(lastReply));
  const scopedTargets = shoppingTargets(scope);
  return scopedTargets.length === 1 && shoppingTargetLabel(scopedTargets[0]) === scope
    && targets.every(key => key === scopedTargets[0])
    && shoppingTargets(`${lastUser} ${lastReply}`).includes(scopedTargets[0]);
}

// These are three exact, read-only follow-ups to a displayed advice exchange.
// History supplies only a bounded subject/match signal; its instructions and
// claims are never executed, copied into replies or used as commercial facts.
export function localShoppingDialogueReference(input) {
  const request = normalizeShoppingAdviceRequest(input);
  if (!request || !request.history?.length) return null;
  const lastUser = normalize(request.history.at(-2).text);
  const lastReply = normalize(request.history.at(-1).text);
  if (!normalizeShoppingAdviceResponse({ kind: "advice", message: request.history.at(-1).text })) return null;
  const current = question(request.text);
  if (current.scope !== null && !matchingScope(current.scope, lastUser, lastReply)) return null;
  const finish = (message, referenceKey) => {
    const reply = normalizeShoppingAdviceResponse({ kind: "advice", message }, request.context);
    return reply ? Object.freeze({ reply, ...(referenceKey ? { referenceKey } : {}) }) : null;
  };

  const countWord = /^(?:на|для|нас) ([а-я]+|\d{1,2})(?: (?:человек[а]?|людей))?$/u.exec(current.text)?.[1];
  const count = people.get(countWord) ?? (/^[1-9]\d?$/u.test(countWord ?? "") ? Number(countWord) : null);
  if (count !== null && count === request.context.peopleCount) {
    return finish(`Для ${count} человек количество зависит от объёма блюда и порций. Какой объём или сколько порций планируешь приготовить?`);
  }

  const previous = question(request.history.at(-2).text);
  if (current.scope !== null && fishScope(current.scope) && FROZEN.test(current.text) && (fish.test(lastUser) || fish.test(lastReply))) {
    return finish("Для замороженной рыбы проверь целостность упаковки и чтобы рыба оставалась твёрдой, а не мягкой и гнущейся. Иней и кристаллы льда могут указывать на длительное хранение либо оттаивание и повторную заморозку, но не доказывают её.", "dialogue-fish-frozen-packaging");
  }
  if (current.scope !== null && fishScope(current.scope) && WHY.test(current.text)
    && FROZEN.test(previous.text) && (previous.scope === null || fishScope(previous.scope))
    && fish.test(lastReply) && /замороженн/u.test(lastReply) && /упаков|ине[йя]|кристалл/u.test(lastReply)) {
    return finish("Я советую проверить упаковку, чтобы заметить её повреждения и возможные признаки проблем с хранением. Иней и кристаллы льда могут указывать на длительное хранение либо оттаивание и повторную заморозку. Целая упаковка и отсутствие инея сами по себе не подтверждают свежесть рыбы.", "dialogue-fish-frozen-packaging");
  }

  const previousAppleQuestion = apples.test(lastUser)
    || (previous.scope === null || appleScope(previous.scope)) && GREEN.test(previous.text);
  if (current.scope !== null && appleScope(current.scope) && GREEN.test(current.text)
    && previousAppleQuestion && (apples.test(lastUser) || apples.test(lastReply))) {
    return finish("Цвет кожуры сам по себе не определяет спелость, сладость или поведение яблок при выпечке. Зелёные яблоки тоже можно рассматривать, но для пирога важны сорт и рецепт. Какой сорт яблок ты рассматриваешь?", "dialogue-apple-colour");
  }
  return null;
}
