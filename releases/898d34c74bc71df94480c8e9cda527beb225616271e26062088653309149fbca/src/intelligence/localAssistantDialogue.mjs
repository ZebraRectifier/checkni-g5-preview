import { MARTEN_STATE } from "./martenMind.mjs";

// Lightweight zero-token dialogue for CHECKNI.
// Social language stays social; shopping language stays in the basket parser.
// This layer never mutates the basket or authors commercial truth.

const GREETING_PREFIX =
  /^(?:привет(?:ик)?|прив|превет|здравствуй(?:те)?|здрасте|здрасьте|здарова|здорово|доброе\s+утро|добрый\s+день|добрый\s+вечер|хай|hello|hi|privet(?:ik)?|zdraste|zdarova|ghbdtn(?:br)?|слушай|смотри|эй)(?=$|[\s,!.—-])[\s,!.—-]*/iu;
const ASSISTANT_ADDRESS = /^(?:мойра|мартен|checkni|чекни)(?=$|[\s,!?.:—-])[\s,!?.:—-]*/iu;
const DISCOURSE_PREFIX = /^(?:ну|короче|пожалуйста)(?=[\s,!?.:—-])[\s,!?.:—-]*/iu;
// "Скажи сыр" is not an unambiguous shopping request. Remove this wrapper
// only when the remaining text is itself a question, preserving its subject.
const QUESTION_PREFIX = /^скажи(?:[\s,]+пожалуйста)?[\s,]+(?=(?:а\s+)?(?:как(?:ой|ая|ое|ие|ую|ого|их)?|что|чем|сколько|почему|зачем|где|поч[её]м|можно\s+ли|в\s+ч[её]м)(?=$|\s))/iu;

const KEYBOARD_EN_TO_RU = Object.freeze({
  q:"й", w:"ц", e:"у", r:"к", t:"е", y:"н", u:"г", i:"ш", o:"щ", p:"з",
  "[":"х", "]":"ъ", a:"ф", s:"ы", d:"в", f:"а", g:"п", h:"р", j:"о",
  k:"л", l:"д", ";":"ж", "'":"э", z:"я", x:"ч", c:"с", v:"м", b:"и",
  n:"т", m:"ь", ",":"б", ".":"ю"
});

const LATIN_DIALOGUE_ALIASES = new Map([
  ["privet", "привет"],
  ["privetik", "приветик"],
  ["zdraste", "здрасте"],
  ["zdarova", "здарова"],
  ["kak dela", "как дела"],
  ["kak ty", "как ты"],
  ["che kak", "че как"],
  ["cho kak", "че как"],
  ["chto delaesh", "что делаешь"],
  ["chto ty umeesh", "что ты умеешь"],
  ["spasibo", "спасибо"],
  ["spasiba", "спасибо"],
  ["poka", "пока"],
  ["ok", "ок"],
  ["okay", "окей"],
  ["mne grustno", "мне грустно"],
  ["ya ustal", "я устал"],
  ["ya ustala", "я устала"]
]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[!?.,;:()\[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function swapEnglishKeyboard(value) {
  return String(value ?? "").replace(/[a-z\[\];',.]/gi, (char) => {
    const lower = char.toLocaleLowerCase("en-US");
    const replacement = KEYBOARD_EN_TO_RU[lower];
    if (!replacement) return char;
    return char === char.toLocaleUpperCase("en-US")
      ? replacement.toLocaleUpperCase("ru-RU")
      : replacement;
  });
}

function conversationalForm(value) {
  return normalize(value)
    .replace(/^(?:(?:ну|короче|бля(?:ть)?|сука)\s+)+/u, "")
    .trim();
}

function dialogueCandidates(value) {
  const direct = conversationalForm(value);
  const swapped = conversationalForm(swapEnglishKeyboard(value));
  const alias = LATIN_DIALOGUE_ALIASES.get(direct) ?? null;

  return [...new Set([direct, alias, swapped].filter(Boolean))];
}

function matches(candidates, pattern) {
  return candidates.some((candidate) => pattern.test(candidate));
}

function reply(dialogueKind, mascotState, headline, message, actionLabel = "Написать покупки") {
  return Object.freeze({
    dialogueKind,
    mascotState,
    headline,
    message,
    actionLabel
  });
}

function stripLeadingAssistantWrappers(text) {
  let value = text;
  // Each pass removes a nonempty leading wrapper, so even repeated attention
  // calls are bounded by the input length. Never filter words inside a request.
  for (;;) {
    const next = value.replace(ASSISTANT_ADDRESS, "").replace(GREETING_PREFIX, "")
      .replace(DISCOURSE_PREFIX, "").replace(QUESTION_PREFIX, "").trim();
    if (next === value) return value;
    value = next;
  }
}

export function stripAssistantGreetingPrefix(text) {
  const original = String(text ?? "").normalize("NFKC").trim();
  return stripLeadingAssistantWrappers(original) || original.replace(ASSISTANT_ADDRESS, "").trim() || original;
}

export function resolveLocalAssistantDialogue(text) {
  const original = String(text ?? "").normalize("NFKC").trim();
  const raw = original.replace(ASSISTANT_ADDRESS, "");
  if (!normalize(raw) && ASSISTANT_ADDRESS.test(original)) return reply("attention", MARTEN_STATE.IDLE,
    "Я здесь.", "Что обсудим: продукты, готовку или подбор корзины?");
  if (!normalize(raw)) return null;

  const stripped = stripLeadingAssistantWrappers(raw);
  const utteranceCandidates = dialogueCandidates(stripped || raw);

  if (matches(utteranceCandidates,
    /^(?:помоги|помогите|поможешь|(?:можешь\s+)?помочь)(?:\s+(?:мне|нам))?\s+(?:с\s+(?:покупками|продуктами|корзиной)|(?:выбрать|подобрать|купить)\s+продукты|(?:собрать|составить)\s+(?:корзину|список\s+покупок))$/u)) {
    return reply("shopping_start", MARTEN_STATE.CURIOUS, "Давай помогу 🙂",
      "Что хочешь купить? Если список уже есть, напиши продукты — начнём подбирать. Если списка пока нет, расскажи, для чего нужны покупки: например, быстрый ужин на двоих. Уточним только то, что нужно для выбора.");
  }

  if (
    matches(
      utteranceCandidates,
      /^(?:что|че|чё)\s+(?:ты\s+)?(?:умеешь|можешь)(?:\s+делать)?$/u
    )
    || matches(
      utteranceCandidates,
      /^(?:помоги|помощь|help|как\s+(?:тут|этим|тобой)\s+пользоваться)$/u
    )
  ) {
    return reply(
      "capability",
      MARTEN_STATE.CURIOUS,
      "Помогу с корзиной.",
      "Пиши покупки обычными словами — списком, с количеством, опечатками или разговорно. Соберу черновик и спрошу, если что-то неоднозначно. Цены, наличие и победителя не выдумываю: это CHECKNI проверяет отдельно."
    );
  }

  if (matches(utteranceCandidates, /^(?:кто\s+ты|ты\s+кто|как\s+тебя\s+зовут)$/u)) {
    return reply(
      "identity",
      MARTEN_STATE.IDLE,
      "Я куница CHECKNI.",
      "Помогаю понять список покупок и собрать черновик корзины. Если не уверена — уточню, а не выберу товар за тебя."
    );
  }

  if (
    matches(
      utteranceCandidates,
      /^(?:(?:че|что|чё)\s+как(?:\s+дела)?|как\s+дела|как\s+ты|как\s+жизнь|что\s+делаешь|чем\s+занимаешься)$/u
    )
  ) {
    return reply(
      "check_in",
      MARTEN_STATE.CURIOUS,
      "Да вот, на посту 🙂",
      "Разбираю списки и слежу, чтобы лишнего не додумывать. А у тебя что нового?"
    );
  }

  if (
    matches(
      utteranceCandidates,
      /^(?:мне\s+(?:грустно|плохо|тяжело|одиноко)|я\s+(?:устал|устала|задолбался|задолбалась)|все\s+бесит|ничего\s+не\s+получается)$/u
    )
  ) {
    return reply(
      "support",
      MARTEN_STATE.IDLE,
      "Похоже, день тяжёлый.",
      "Можешь рассказать, что случилось. Покупки можно вообще не трогать.",
      "Написать"
    );
  }

  if (
    matches(
      utteranceCandidates,
      /^(?:ау|алло|слушай|смотри|эй|ты\s+(?:тут|здесь)|есть\s+кто)$/u
    )
  ) {
    return reply(
      "attention",
      MARTEN_STATE.CURIOUS,
      "Я тут.",
      "Не пропала. Продолжай.",
      "Написать"
    );
  }

  if (
    matches(
      utteranceCandidates,
      /^(?:лаги?|завис(?:ла|ло)?|ничего\s+не\s+работает|ты\s+(?:тупишь|тупая|сломал(?:ся|ась)|не\s+работаешь|не\s+понимаешь)|все\s+сломалось|бесит)$/u
    )
  ) {
    return reply(
      "frustration",
      MARTEN_STATE.ERROR,
      "Да, тут что-то пошло не так.",
      "Опиши, где именно сломалось — попробую понять. В товар эту фразу не превращу.",
      "Описать проблему"
    );
  }

  if (matches(utteranceCandidates, /^(?:расскажи\s+(?:анекдот|шутку)|пошути)$/u)) {
    return reply(
      "joke",
      MARTEN_STATE.CURIOUS,
      "Ладно, держи 🙂",
      "Куница зашла в магазин за одной скидкой. Вышла с калькулятором.",
      "Ещё поговорить"
    );
  }

  if (matches(utteranceCandidates, /^(?:спасибо|спс|благодарю|пасиб|пасиба|мерси)$/u)) {
    return reply(
      "thanks",
      MARTEN_STATE.IDLE,
      "Пожалуйста 🙂",
      "Я рядом. Можем продолжить разговор или собрать покупки."
    );
  }

  if (matches(utteranceCandidates, /^(?:пока|до\s+встречи|увидимся|бывай|давай\s+пока)$/u)) {
    return reply(
      "goodbye",
      MARTEN_STATE.SLEEPING,
      "Давай 👋",
      "Вернёшься — продолжим.",
      "Продолжить"
    );
  }

  if (
    matches(
      utteranceCandidates,
      /^(?:ага|угу|ок|окей|ладно|понял|поняла|ясно|круто|класс|ахах|хаха|лол)$/u
    )
  ) {
    return reply(
      "acknowledgement",
      MARTEN_STATE.IDLE,
      "Угу 🙂",
      "Я с тобой. Продолжай."
    );
  }

  const greetingOnly = dialogueCandidates(raw).some((candidate) => (
    /^(?:привет(?:ик)?|прив|превет|здравствуй(?:те)?|здрасте|здрасьте|здарова|здорово|доброе\s+утро|добрый\s+день|добрый\s+вечер|хай|hello|hi)$/u
      .test(candidate)
  ));

  if (greetingOnly || (GREETING_PREFIX.test(raw) && normalize(stripped) === "")) {
    return reply(
      "greeting",
      MARTEN_STATE.IDLE,
      "Привет 👋",
      "Я здесь. Можешь просто поговорить или написать, что купить."
    );
  }

  return null;
}
