import { stripAssistantGreetingPrefix } from './localAssistantDialogue.mjs';
import { extractShoppingNeedContext } from './shoppingNeedContext.mjs';
import { shoppingTargets } from './shoppingConversation.mjs';

const clean = text => stripAssistantGreetingPrefix(String(text)).normalize('NFKC')
  .toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();

export function isShoppingPlanningRequest(text) {
  const value = clean(text);
  if (/^(?:убери|удали|замени|подтверждаю|применяй|сбрось|отмени|забудь)(?=$|\s)/iu.test(value)) return false;
  return /еда|еду|еды|продукт|покуп|закуп|меню|рацион|питаться/iu.test(value)
    && /(?:нужн|хочу|помоги|подбери|составь|собери|посоветуй|порекомендуй|рекомендац)/iu.test(value)
    && (extractShoppingNeedContext(value).recognized || /меню|рацион|закуп|питаться/iu.test(value));
}

export function canContinueShoppingDialogue(text) {
  const value = clean(text);
  return !/^(?:добавь|добавить|положи|убери|удали|замени|возьми|купи|закажи|подтверждаю|применяй|применить|сбрось|отмени|забудь|перестрой|пересобери|обнови корзину|новая корзина|новая задача|другая корзина)(?=$|\s)/u.test(value)
    && !/цен[ауы]|стоим|сто[ия]т|почем|дешев|налич|доставк|заказ|сравни (?:магазины|корзину)/u.test(value);
}

export function shoppingDialogueNeed(text, history = []) {
  const pending = history.at(-1)?.role === 'assistant' ? clean(history.at(-1).text) : '';
  // A bare count has meaning only after an actual people-count question. It
  // cannot reinterpret an arbitrary quantity, time, price or basket command.
  const asksPeople = /на сколько (?:человек|людей)|сколько (?:вас|человек)/u.test(pending);
  const bare = asksPeople && clean(text).match(/^(?:на\s+)?(\d{1,2})(?=$|\s*[,.;!?]|\s+(?:да|нет|есть|морозилка))/u);
  const explicitText = bare ? text.replace(/^(?:на\s+)?\d{1,2}/iu, `на ${bare[1]} человек`) : text;
  const need = extractShoppingNeedContext(explicitText);
  const budget = !asksPeople && /бюджет|лимит/u.test(pending)
    && clean(text).match(/^(?:(?:около|примерно|до)\s+)?(\d{1,6})(?:\s*(?:₽|руб(?:лей|ля|ль)?))?[.!?]*$/u);
  if (budget) {
    const budgetMinor = Number(budget[1]) * 100;
    if (budgetMinor < 1000 || budgetMinor > 99999900) return { ...need, recognized: true,
      clarification: 'Уточни общий бюджет одним числом в рублях; прежние условия сохранила.' };
    return { ...need, recognized: true, facts: { ...need.facts, budgetMinor: { value: budgetMinor, scope: 'goal' } } };
  }
  return need;
}

export function explicitFreezerAnswer(text) {
  const value = clean(text);
  if (/\?/u.test(value) || /^(?:а\s+)?(?:если|допустим|предположим)(?=$|\s)/u.test(value)) return null;
  if (/(?:нет|без)\s+морозилк|морозилк\S*\s+(?:нет|сломалась|не работает)/u.test(value)) return false;
  if (/есть\s+морозилк|морозилк\S*\s+есть/u.test(value)) return true;
  return null;
}

export function shoppingDialogueText(text, memory, freezer) {
  const notes = [];
  const location = memory.facts.location?.value;
  if (typeof location === 'string' && location.length <= 80) notes.push(`город: ${location}`);
  if (freezer !== null) notes.push(`морозилка: ${freezer ? 'есть' : 'нет'}`);
  const scoped = notes.length ? `Условия покупок (${notes.join('; ')}). Текущий запрос: ${text}` : text;
  return scoped.length <= 300 ? scoped : text;
}

export function shoppingDialogueRecoveryQuestion(memory, code, turn = null) {
  const notice = code === 'rate_limited' ? 'Лимит обращений к сервису советов сейчас исчерпан.'
    : code === 'invalid_advice' || /^(?:invalid_provider_advice|provider_advice_)/u.test(code ?? '') ? 'Ответ сервиса не прошёл проверку.'
    : code === 'provider_timeout' ? 'Не успел получить ответ сервиса.'
    : 'Сервис советов сейчас не ответил.';
  const specific = text => shoppingTargets(text).length || /рыб|готов|ужин|обед|завтрак|заморож/iu.test(text);
  const previousQuestions = (turn?.history ?? []).filter(row => row.role === 'user');
  const onTopic = turn && !isShoppingPlanningRequest(turn.text) && (specific(turn.text)
    || !previousQuestions.some(row => isShoppingPlanningRequest(row.text)) && previousQuestions.some(row => specific(row.text)));
  if (onTopic) return `${notice} Вопрос и контекст сохранены. Можно повторить вопрос или продолжить уточнять эту же тему.`;
  const question = !memory.facts.peopleCount ? 'На сколько человек нужна еда?'
    : !memory.facts.shoppingDays ? 'На сколько дней планируем покупки?'
      : !memory.facts.budgetMinor ? 'Какой общий бюджет на весь срок?'
        : 'Какие продукты особенно хочется включить, а какие исключить?';
  return `${notice} Твои условия сохранила. Продолжим: ${question}`;
}
