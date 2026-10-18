// Explicit shopping context, never a portion calculation or pack multiplier.
// These goal facts stay in this conversation; preference storage omits them.
const words = { одного: 1, одну: 1, один: 1, одной: 1, двоих: 2, двух: 2, два: 2, две: 2,
  троих: 3, трех: 3, три: 3, четверых: 4, четырех: 4, четыре: 4, пятерых: 5, пяти: 5, пять: 5,
  шестерых: 6, шести: 6, шесть: 6, семерых: 7, семи: 7, семь: 7, восьми: 8, восемь: 8,
  девяти: 9, девять: 9, десяти: 10, десять: 10 };
const numeric = "[+-]?\\d+(?:[.,]\\d+)?(?:\\s*[-–—]\\s*\\d+)?";
const count = `(?:${Object.keys(words).join("|")}|${numeric})`;
const peopleNoun = "(?:человек(?:а)?|людей|персон(?:ы)?|чел\\.?|взрослых)";
const people = new RegExp(`(?<![а-яa-z0-9])(?:на|для)\\s+((?:одного|одну|двоих|двух|троих|трех|четверых|четырех|пятерых|пяти|шестерых|шести)(?:\\s+${peopleNoun})?|${numeric}\\s+${peopleNoun})(?=$|[\\s,;.!?])`, "giu");
const period = new RegExp(`(?<![а-яa-z0-9])(?:на\\s+(${count})\\s+(день|дня|дней|неделю|недели|недель|недельку|недельки|неделек)|(?:на|всю)\\s+(неделю|недельку))(?=$|[\\s,;.!?])`, "giu");
const number = value => words[value] ?? Number(value.replace(",", "."));

export function extractShoppingNeedContext(text) {
  const original = String(text ?? "").normalize("NFKC").replaceAll("ё", "е");
  const masked = original.replace(/«[^»]*»|“[^”]*”|"[^"]*"/gu, match => " ".repeat(match.length));
  const values = { peopleCount: [], shoppingDays: [] };
  const spans = [];
  let negative = false;
  for (const [key, pattern] of [["peopleCount", people], ["shoppingDays", period]]) {
    for (const match of masked.matchAll(pattern)) {
      const raw = match[1]?.toLocaleLowerCase("ru-RU").replace(new RegExp(`\\s+${peopleNoun}$`, "u"), "");
      const amount = key === "peopleCount" ? number(raw)
        : match[3] ? 7 : number(raw) * (match[2].toLocaleLowerCase("ru-RU").startsWith("недел") ? 7 : 1);
      values[key].push(amount);
      spans.push([match.index, match.index + match[0].length]);
      if (/(?:^|[\s,;])(?:не|нет)\s*$/iu.test(masked.slice(0, match.index))) negative = true;
    }
  }
  const recognized = spans.length > 0;
  if (!recognized) return { text: original, facts: {}, recognized: false };
  const invalidPeople = values.peopleCount.some(value => !Number.isSafeInteger(value) || value < 1 || value > 12)
    || new Set(values.peopleCount).size > 1;
  const invalidDays = values.shoppingDays.some(value => !Number.isSafeInteger(value) || value < 1 || value > 31)
    || new Set(values.shoppingDays).size > 1;
  if (negative || invalidPeople || invalidDays) return { text: original, facts: {}, recognized: true,
    clarification: negative ? "Уточни, на сколько человек и дней нужны покупки. Прежние условия сохранила."
      : invalidPeople ? "На сколько человек подбираем? Укажи одно целое число от 1 до 12."
        : "На сколько дней нужны покупки? Укажи одно целое число от 1 до 31." };
  let cleaned = original;
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) cleaned = cleaned.slice(0, start) + " " + cleaned.slice(end);
  cleaned = cleaned.replace(/(?:[,;]\s*){2,}/gu, ", ").replace(/\s+/gu, " ").replace(/^[\s,;]+|[\s,;]+$/gu, "").trim();
  return { text: cleaned, recognized, facts: Object.fromEntries(Object.entries(values)
    .filter(([, entries]) => entries.length).map(([key, entries]) => [key, { value: entries.at(-1), scope: "goal" }])) };
}

export function shoppingDaysText(days) {
  const dayLabel = days % 10 === 1 && days % 100 !== 11 ? "день"
    : [2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100) ? "дня" : "дней";
  return `${days} ${dayLabel}`;
}

export function shoppingNeedContextSummary(memory) {
  const people = memory.facts.peopleCount?.value, days = memory.facts.shoppingDays?.value;
  if (!people && !days) return "";
  return `Покупки${people ? ` для ${people} чел.` : ""}${days ? ` на ${shoppingDaysText(days)}` : ""}. Количество упаковок выберем отдельно.`;
}
