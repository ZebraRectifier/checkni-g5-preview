export const LOCAL_BASKET_PREFLIGHT = Object.freeze({
  PASS: "pass",
  FALLBACK: "fallback",
  REJECT: "reject"
});

const PROMPT_INJECTION_PATTERNS = Object.freeze([
  /(?:^|\s)(?:system|developer)\s*:/i,
  /системн(?:ый|ого|ому|ым)?\s+промпт/i,
  /(?:игнорируй|игнорь|забудь|обойди)\s+(?:все\s+)?(?:правил|ограничен|инструкц)/i,
  /забей\s+на\s+(?:все\s+)?(?:правил|ограничен|инструкц)/i,
  /(?:покажи|раскрой)\s+(?:секретн|системн)/i,
  /не\s+слушай\s+(?:schema|схем)/i,
  /(?:ignore|forget|bypass)\s+(?:(?:all|any)\s+)?(?:(?:previous|prior)\s+)?(?:instructions|rules|constraints)/i,
  /(?:show|reveal|print)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|message|instructions)/i
]);

const COMMERCIAL_CONSTRAINT_PATTERNS = Object.freeze([
  /сам(?:ое|ую|ый|ые)?\s+дешев/i,
  /(?:дешевле|дешевый|дешёвый|подешевле)/i,
  /(?:точно\s+)?(?:есть|имеется)\s+в\s+налич/i,
  /(?:^|\s)в\s+налич/i,
  /(?:^|\s)точно\s+(?:есть|имеется)(?:$|\s|[,.;!?])/i,
  /(?:^|\s)где\s+(?:есть|имеется)(?:$|\s|[,.;!?])/i,
  /(?:^|\s)(?:есть|имеется)\s+ли(?:$|\s|[,.;!?])/i,
  /(?:цена|стоимость|скидк|акци|экономи|выгодн)/i,
  /(?:^|\s)\d+(?:[.,]\d+)?\s*(?:₽|руб(?:ля|лей|ль)?\.?)/i,
  /(?:из|в)\s+[а-яa-z0-9-]+\s+магазин/i,
  /(?:^|\s)(?:в|из)\s+(?:пятерочк[а-я]*|магнит[а-я]*|перекрест[а-я]*|лент[а-я]*|ашан[а-я]*|вкусвилл[а-я]*|metro|метро|ozon|озон|яндекс(?:\s+маркет)?)(?=$|\s|[,.;!?])/i,
  /(?:^|\s)(?:в|из)\s+магазин(?:е|а|у|ом)?\s+[а-яa-z0-9-]+/i,
  /(?:магазин(?:е|а|у|ом)?|ритейлер(?:е|а|у|ом)?|retailer)\s+[а-яa-z0-9-]+/i,
  /(?:оформ[а-я]*|создай|сделай)\s+(?:заказ|доставк[а-я]*)/i,
  /(?:checkout|order|доставк)/i,
  /(?:победител|winner|экономия|сбережен)/i
]);

const SEMANTIC_INTENT_PATTERNS = Object.freeze([
  /что[-\s]?нибудь/i,
  /что[-\s]?то\s+(?:вкусн|сладк|солен|солён|сытн)/i,
  /(?:посоветуй|предложи|подбери)/i,
  /собери\s+(?:завтрак|обед|ужин|перекус|закуск|набор)/i,
  /(?:завтрак|обед|ужин|перекус)\s+на\s+(?:одн|дво|тро|четвер)/i,
  /(?:^|\s)к\s+(?:пиву|кофе|чаю|вину|фильму)(?:$|\s)/i,
  /(?:^|\s)для\s+(?:фильма|вечера|вечеринки|гостей|ребенка|ребёнка|школы)(?:$|\s)/i,
  /готовить\s+(?:не\s+хочу|лень|не\s+буду)/i
]);

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function preflightLocalBasketText(normalizedText) {
  const text = String(normalizedText ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return Object.freeze({
      kind: LOCAL_BASKET_PREFLIGHT.PASS
    });
  }

  if (matchesAny(text, PROMPT_INJECTION_PATTERNS)) {
    return Object.freeze({
      kind: LOCAL_BASKET_PREFLIGHT.REJECT,
      reason: "prompt_injection"
    });
  }

  if (matchesAny(text, COMMERCIAL_CONSTRAINT_PATTERNS)) {
    return Object.freeze({
      kind: LOCAL_BASKET_PREFLIGHT.FALLBACK,
      reason: "commercial_constraint"
    });
  }

  if (matchesAny(text, SEMANTIC_INTENT_PATTERNS)) {
    return Object.freeze({
      kind: LOCAL_BASKET_PREFLIGHT.FALLBACK,
      reason: "semantic_intent"
    });
  }

  return Object.freeze({
    kind: LOCAL_BASKET_PREFLIGHT.PASS
  });
}
