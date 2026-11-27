// MARTEN-MIND: deterministic conversational policy for CHECKNI.
//
// This module is deliberately zero-token and commercially blind. It may keep
// small session preferences that the user stated explicitly, select a mascot
// state and expose progress copy. It must never author price, stock, savings,
// store ranking or winner truth.

export const MARTEN_STATE = Object.freeze({
  IDLE: "idle",
  CURIOUS: "curious",
  SEARCHING: "searching",
  CHECKING: "checking",
  FOUND: "found",
  PARTIAL: "partial",
  ERROR: "error",
  BIG_SAVING: "big_saving",
  SLEEPING: "sleeping"
});

export const MARTEN_PROGRESS_STAGE = Object.freeze({
  THINKING: "thinking",
  SEARCHING: "searching",
  CHECKING: "checking"
});

export const MARTEN_PREFERENCE_KEY = Object.freeze({
  COOKING_EFFORT: "cookingEffort",
  BUDGET_STYLE: "budgetStyle",
  BRAND_STYLE: "brandStyle"
});

const MASCOT_STATES = new Set(Object.values(MARTEN_STATE));
const PREFERENCE_VALUES = Object.freeze({
  [MARTEN_PREFERENCE_KEY.COOKING_EFFORT]: new Set(["minimal", "normal"]),
  [MARTEN_PREFERENCE_KEY.BUDGET_STYLE]: new Set(["cheaper", "balanced", "better"]),
  [MARTEN_PREFERENCE_KEY.BRAND_STYLE]: new Set(["specific", "any"])
});

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

function safePreferences(value) {
  const output = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return output;
  }

  for (const [key, allowed] of Object.entries(PREFERENCE_VALUES)) {
    if (allowed.has(value[key])) output[key] = value[key];
  }

  return output;
}

export function inferExplicitMartenPreferences(text) {
  const value = normalize(text);
  const preferences = {};

  if (
    /(?:без\s+готовк|не\s+хочу\s+готовить|готов(?:ое|ую|ые)\s+ед|почти\s+готов)/u
      .test(value)
  ) {
    preferences[MARTEN_PREFERENCE_KEY.COOKING_EFFORT] = "minimal";
  } else if (/(?:можно\s+готовить|готовить\s+норм|обычн.*готов)/u.test(value)) {
    preferences[MARTEN_PREFERENCE_KEY.COOKING_EFFORT] = "normal";
  }

  if (/(?:не\s+самое\s+дешев|получше|качественн)/u.test(value)) {
    preferences[MARTEN_PREFERENCE_KEY.BUDGET_STYLE] = "better";
  } else if (/(?:подешевле|самое\s+дешев|эконом(?:но|нее)?|бюджетн)/u.test(value)) {
    preferences[MARTEN_PREFERENCE_KEY.BUDGET_STYLE] = "cheaper";
  } else if (/(?:средн(?:ий|яя)\s+вариант|баланс)/u.test(value)) {
    preferences[MARTEN_PREFERENCE_KEY.BUDGET_STYLE] = "balanced";
  }

  if (
    /(?:бренд|марка).{0,20}(?:без\s+разницы|не\s+важн)|(?:любая|любой)\s+(?:марка|бренд)/u
      .test(value)
  ) {
    preferences[MARTEN_PREFERENCE_KEY.BRAND_STYLE] = "any";
  } else if (
    /(?:конкретн.{0,12}(?:бренд|марк)|(?:бренд|марка)\s+важн|по\s+бренд)/u
      .test(value)
  ) {
    preferences[MARTEN_PREFERENCE_KEY.BRAND_STYLE] = "specific";
  }

  return Object.freeze(preferences);
}

export function resolveMartenMascotState(result, options = {}) {
  const phase = options.phase;
  if (phase === MARTEN_PROGRESS_STAGE.THINKING) return MARTEN_STATE.CURIOUS;
  if (phase === MARTEN_PROGRESS_STAGE.SEARCHING) return MARTEN_STATE.SEARCHING;
  if (phase === MARTEN_PROGRESS_STAGE.CHECKING) return MARTEN_STATE.CHECKING;

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return MARTEN_STATE.ERROR;
  }

  if (result.kind === "proposal") return MARTEN_STATE.FOUND;

  if (result.kind === "clarification") {
    if (result.triggerReason === "smalltalk") {
      const requested = result.assistantReply?.mascotState;
      return MASCOT_STATES.has(requested) ? requested : MARTEN_STATE.CURIOUS;
    }

    if (
      result.reason === "partial_validation"
      || result.triggerReason === "unresolved_segment"
      || result.triggerReason === "ambiguous_segment"
    ) {
      return MARTEN_STATE.PARTIAL;
    }

    return MARTEN_STATE.CHECKING;
  }

  if (
    result.kind === "unavailable"
    || result.kind === "rejected"
    || result.kind === "error"
  ) {
    return MARTEN_STATE.ERROR;
  }

  return MARTEN_STATE.IDLE;
}

export function martenProgressCue(stage) {
  if (stage === MARTEN_PROGRESS_STAGE.THINKING) {
    return "Сейчас подумаю…";
  }
  if (stage === MARTEN_PROGRESS_STAGE.SEARCHING) {
    return "Ищу, что подходит по твоему запросу…";
  }
  if (stage === MARTEN_PROGRESS_STAGE.CHECKING) {
    return "Проверяю, что именно ты имел в виду…";
  }
  return null;
}

export function createMartenMindState(seed = {}) {
  const mascotState = MASCOT_STATES.has(seed.mascotState)
    ? seed.mascotState
    : MARTEN_STATE.IDLE;
  const turn = Number.isSafeInteger(seed.turn) && seed.turn >= 0
    ? seed.turn
    : 0;

  return Object.freeze({
    turn,
    mascotState,
    preferences: Object.freeze(safePreferences(seed.preferences))
  });
}

export function updateMartenMindState(state, event = {}) {
  const current = createMartenMindState(state);
  const inferred = inferExplicitMartenPreferences(event.text);
  const preferences = Object.freeze(event.preferences ? safePreferences(event.preferences) : {
    ...current.preferences,
    ...inferred
  });

  return Object.freeze({
    turn: current.turn + 1,
    mascotState: resolveMartenMascotState(event.result, {
      phase: event.phase
    }),
    preferences
  });
}
