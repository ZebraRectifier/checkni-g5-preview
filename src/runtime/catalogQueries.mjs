export const MAX_AI_CATALOG_QUERIES = 5;
export const MAX_CATALOG_QUERY_TERM_LENGTH = 120;

const COMMAND_PREFIX = /^(?:(?:мне|нам)\s+)?(?:нужно|надо|добавь|добавить|купи|купить|найди|найти|хочу|возьми|взять)\s+/iu;
const LEADING_QUANTITY = /^(?:(?:\d+(?:[.,]\d+)?)|один|одна|одно|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)\s+/iu;
const LEADING_PACKAGE = /^(?:пачк(?:а|у|и)?|упаковк(?:а|у|и)?|бутылк(?:а|у|и)?|банк(?:а|у|и)?|килограмм(?:а|ов)?|кг|литр(?:а|ов)?|л)\s+/iu;

function cleanTerm(value) {
  if (typeof value !== "string") return null;

  let term = value.trim().replace(/\s+/g, " ");
  if (!term) return null;

  term = term.replace(COMMAND_PREFIX, "");
  term = term.replace(LEADING_QUANTITY, "");
  term = term.replace(LEADING_PACKAGE, "");
  term = term.trim();

  if (!term || term.length > MAX_CATALOG_QUERY_TERM_LENGTH) return null;
  return term;
}

export function extractCatalogQueries(text) {
  if (typeof text !== "string") return [];

  const segments = text
    .split(/[,;\n]+|\s+и\s+/iu)
    .map(cleanTerm)
    .filter(Boolean);

  const seen = new Set();
  const queries = [];

  for (const segment of segments) {
    const key = segment.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(segment);
    if (queries.length >= MAX_AI_CATALOG_QUERIES) break;
  }

  if (queries.length === 0) {
    const fallback = cleanTerm(text);
    if (fallback) queries.push(fallback);
  }

  return queries;
}
