// Shared, affirmative request framing. Keep product qualifiers, quantities,
// refusals and questions intact; this is not a general stop-word filter.
const REQUEST_PREFIX = /^(?:(?:пожалуйста|слушай|смотри|ну)[,\s]+)*(?:(?:я|мы)\s+(?:хочу|хотим|(?:хотел|хотела|хотели)\s+бы|бы\s+(?:хотел|хотела|хотели))|(?:(?:мне|нам)\s+)?(?:нужен|нужна|нужно|нужны|надо|добавь|добавить|купи|купить|найди|найти|хочу|возьми|взять))\s+/iu;

export function stripShoppingRequestPrefix(value) {
  const text = typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/gu, " ") : "";
  return text.replace(REQUEST_PREFIX, "").trim();
}
