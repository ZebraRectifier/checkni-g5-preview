// Lightweight zero-token assistant dialogue for CHECKNI.
// It handles social chatter locally and strips a leading greeting from a
// shopping request. No model call, commercial claim or basket mutation.

const GREETING_PREFIX =
  /^(?:привет(?:ик)?|прив|здравствуй(?:те)?|здрасте|здрасьте|здарова|здорово|доброе\s+утро|добрый\s+день|добрый\s+вечер|хай|hello|hi)(?=$|[\s,!.—-])[\s,!.—-]*/iu;

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[!?.,;:()\[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reply(headline, message, actionLabel = "Написать покупки") {
  return Object.freeze({
    headline,
    message,
    actionLabel
  });
}

export function stripAssistantGreetingPrefix(text) {
  const value = String(text ?? "").normalize("NFKC").trim();
  const stripped = value.replace(GREETING_PREFIX, "").trim();
  return stripped || value;
}

export function resolveLocalAssistantDialogue(text) {
  const normalized = normalize(text);
  if (!normalized) return null;

  const withoutGreeting = normalize(
    String(text ?? "").normalize("NFKC").replace(GREETING_PREFIX, "")
  );

  if (
    /^(?:что|че|чё)\s+(?:ты\s+)?(?:умеешь|можешь)(?:\s+делать)?$/u.test(withoutGreeting || normalized)
    || /^(?:помоги|помощь|help|как\s+(?:тут|этим|тобой)\s+пользоваться)$/u.test(withoutGreeting || normalized)
  ) {
    return reply(
      "Помогу с корзиной.",
      "Напиши продукты обычными словами — списком, с количеством, с опечатками или как сказал бы вслух. Я соберу черновик. Цены, наличие и магазин не выдумываю: это CHECKNI проверяет отдельно."
    );
  }

  if (/^(?:кто\s+ты|ты\s+кто|как\s+тебя\s+зовут)$/u.test(withoutGreeting || normalized)) {
    return reply(
      "Я помощник CHECKNI.",
      "Моя работа — понять, что ты хочешь купить, собрать аккуратный черновик корзины и спросить, если что-то неоднозначно."
    );
  }

  if (/^(?:как\s+дела|как\s+ты|как\s+жизнь)$/u.test(withoutGreeting || normalized)) {
    return reply(
      "Нормально 🙂",
      "Я на месте и готов разбирать корзину. Пиши хоть коротко, хоть разговорно."
    );
  }

  if (/^(?:спасибо|спс|благодарю|пасиб|пасиба|мерси)$/u.test(withoutGreeting || normalized)) {
    return reply(
      "Пожалуйста 🙂",
      "Кидай следующий список — разберу."
    );
  }

  if (/^(?:пока|до\s+встречи|увидимся|бывай|давай\s+пока)$/u.test(withoutGreeting || normalized)) {
    return reply(
      "Давай 👋",
      "Корзина никуда не денется. Вернёшься — продолжим.",
      "Продолжить"
    );
  }

  if (GREETING_PREFIX.test(String(text ?? "").normalize("NFKC").trim()) && withoutGreeting === "") {
    return reply(
      "Привет 👋",
      "Я здесь. Напиши, что купить — например «молоко, хлеб и 2 пачки гречки» или просто как сказал бы человеку."
    );
  }

  return null;
}
