import {
  HYBRID_DRAFT_CONFIRMATION,
  canConfirmHybridBasketDraft
} from "./hybridBasketConfirmation.mjs";

const HYBRID_BASKET_RESULT = Object.freeze({
  PROPOSAL: "proposal",
  CLARIFICATION: "clarification",
  REJECTED: "rejected",
  UNAVAILABLE: "unavailable",
  ERROR: "error"
});

export const HYBRID_PRESENTATION_STATE = Object.freeze({
  READY: "ready",
  CLARIFY: "clarify",
  UNAVAILABLE: "unavailable",
  REJECTED: "rejected",
  ERROR: "error"
});

function identityItems(validation) {
  if (!Array.isArray(validation?.basket)) return [];

  return Object.freeze(validation.basket.map((row) => Object.freeze({
    productId: row.product.id,
    name: row.product.name,
    unit: row.product.unit,
    quantity: row.quantity
  })));
}

function itemSummary(items) {
  return items
    .map((item) => `${item.name} ×${item.quantity}`)
    .join(" · ");
}

function freezeView(state, details = {}) {
  return Object.freeze({
    state,
    headline: details.headline ?? "",
    message: details.message ?? "",
    items: details.items ?? Object.freeze([]),
    primaryAction: details.primaryAction ?? null,
    secondaryAction: details.secondaryAction ?? null,
    focusClarification: details.focusClarification === true
  });
}

export function presentHybridBasketResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return freezeView(HYBRID_PRESENTATION_STATE.ERROR, {
      headline: "Не получилось разобрать автоматически.",
      message: "Корзина не изменилась.",
      primaryAction: "Искать вручную"
    });
  }

  if (result.kind === HYBRID_BASKET_RESULT.PROPOSAL) {
    const items = identityItems(result.validation);
    return freezeView(HYBRID_PRESENTATION_STATE.READY, {
      headline: items.length > 0
        ? `Поняла: ${itemSummary(items)}`
        : "Поняла запрос.",
      items,
      secondaryAction: "Исправить"
    });
  }

  if (result.kind === HYBRID_BASKET_RESULT.CLARIFICATION) {
    const items = identityItems(result.validation);

    if (result.triggerReason === "quantity_out_of_range") {
      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: "Уточни количество.",
        message: "Не буду угадывать число за тебя.",
        items,
        primaryAction: "Уточнить",
        secondaryAction: "Искать вручную",
        focusClarification: true
      });
    }

    if (result.triggerReason === "commercial_constraint") {
      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: "Уточни товар.",
        message: "Где дешевле — посчитаю отдельно по данным CHECKNI.",
        items,
        primaryAction: "Уточнить",
        secondaryAction: "Искать вручную",
        focusClarification: true
      });
    }

    if (result.reason === "partial_validation") {
      const canAddFoundOnly = canConfirmHybridBasketDraft(
        result,
        HYBRID_DRAFT_CONFIRMATION.ADD_FOUND_ONLY
      );

      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: "Поняла часть запроса.",
        message: "Остальное нужно уточнить.",
        items,
        primaryAction: "Уточнить",
        secondaryAction: items.length > 0 && canAddFoundOnly
          ? "Добавить только найденное"
          : "Искать вручную",
        focusClarification: true
      });
    }

    if (result.triggerReason === "ambiguous_segment") {
      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: "Есть несколько похожих товаров.",
        message: "Предложила один вариант — проверь перед добавлением.",
        items,
        primaryAction: "Добавить предложенное",
        secondaryAction: "Уточнить запрос",
        focusClarification: true
      });
    }

    return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
      headline: "Собрала вариант.",
      message: "Проверь, подходит ли набор.",
      items,
      primaryAction: "Добавить предложенное",
      secondaryAction: "Уточнить запрос",
      focusClarification: true
    });
  }

  if (result.kind === HYBRID_BASKET_RESULT.UNAVAILABLE) {
    return freezeView(HYBRID_PRESENTATION_STATE.UNAVAILABLE, {
      headline: "Не получилось разобрать это автоматически.",
      message: "Корзина не изменилась.",
      primaryAction: "Уточнить запрос",
      secondaryAction: "Искать вручную"
    });
  }

  if (result.kind === HYBRID_BASKET_RESULT.REJECTED) {
    return freezeView(HYBRID_PRESENTATION_STATE.REJECTED, {
      headline: "Не получилось разобрать запрос.",
      message: "Сформулируй покупку обычным списком.",
      primaryAction: "Изменить запрос",
      secondaryAction: "Искать вручную"
    });
  }

  return freezeView(HYBRID_PRESENTATION_STATE.ERROR, {
    headline: "Не получилось разобрать автоматически.",
    message: "Корзина не изменилась.",
    primaryAction: "Уточнить запрос",
    secondaryAction: "Искать вручную"
  });
}
