import {
  HYBRID_DRAFT_CONFIRMATION,
  canConfirmHybridBasketDraft
} from "./hybridBasketConfirmation.mjs";
import { formatRubMinor } from "../components/ComparisonResult.mjs";

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

function listTerms(terms) {
  if (!Array.isArray(terms)) return "";
  return terms
    .filter((term) => typeof term === "string" && term.trim() !== "")
    .slice(0, 5)
    .map((term) => `«${term.trim()}»`)
    .join(", ");
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

    if (
      result.triggerReason === "smalltalk"
      && result.assistantReply
      && typeof result.assistantReply.headline === "string"
      && typeof result.assistantReply.message === "string"
    ) {
      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: result.assistantReply.headline,
        message: result.assistantReply.message,
        items,
        primaryAction: result.assistantReply.actionLabel || "Написать покупки",
        secondaryAction: null,
        focusClarification: true
      });
    }

    if (result.triggerReason === "budget_request" && result.budget) {
      const budgetLabel = formatRubMinor(result.budget.budgetMinor);
      const estimateLabel = formatRubMinor(result.budget.estimateMinor);

      if (result.budget.overBudget) {
        return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
          headline: "В такой бюджет не уложиться.",
          message: `Даже самое дешёвое из базовых продуктов стоит от ${estimateLabel} — `
            + `это больше ${budgetLabel}. Предложила его, реши, подходит ли. `
            + "Цены — с сайтов магазинов, регион не подтверждён.",
          items,
          primaryAction: "Добавить предложенное",
          secondaryAction: "Уточнить запрос",
          focusClarification: true
        });
      }

      const richer = result.budget.style === "richer";
      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: richer
          ? "Собрала корзину под бюджет — вариант посытнее."
          : "Собрала корзину под бюджет.",
        message: `Выйдет примерно ${estimateLabel} из ${budgetLabel} по лучшим ценам `
          + "с сайтов магазинов (регион не подтверждён). Где вся корзина дешевле — "
          + "покажет сравнение. Проверь и добавь."
          + (richer
            ? " Хочешь дешевле — напиши «подешевле»."
            : " Хочешь разнообразнее — напиши «получше»."),
        items,
        primaryAction: "Добавить предложенное",
        secondaryAction: "Уточнить запрос",
        focusClarification: true
      });
    }

    if (
      result.source === "ai"
      && result.reason === "confirmation_required"
      && result.triggerReason === "unresolved_segment"
    ) {
      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: "Поняла не всё.",
        message: "Показываю только то, что смогла уверенно сопоставить. Непонятную часть лучше уточнить, чтобы не положить в корзину не тот товар.",
        items,
        primaryAction: items.length > 0 ? "Добавить найденное" : "Уточнить запрос",
        secondaryAction: items.length > 0 ? "Уточнить запрос" : "Искать вручную",
        focusClarification: true
      });
    }

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

    if (
      result.reason === "confirmation_required"
      && (
        result.unresolvedTerms?.length > 0
        || result.ambiguousChoices?.length > 0
        || result.packNotes?.length > 0
      )
    ) {
      const notes = [];
      const terms = listTerms(result.unresolvedTerms);
      const packNotes = result.packNotes ?? [];
      const ambiguousChoices = result.ambiguousChoices ?? [];

      if (
        !terms
        && ambiguousChoices.length === 0
        && packNotes.length === 1
      ) {
        const note = packNotes[0];
        const rest = items.length > 1
          ? " Остальные товары тоже распознаны."
          : "";
        return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
          headline: "Нужно уточнить количество.",
          message: `Ты написал «${note.term}». В каталоге ${note.productName} — упаковка ${note.unit}. Взять 1 упаковку?${rest}`,
          items,
          primaryAction: "Взять 1 упаковку",
          secondaryAction: "Изменить количество",
          focusClarification: true
        });
      }

      if (terms) notes.push(`Не нашла: ${terms}.`);
      for (const choice of ambiguousChoices) {
        const others = choice.otherNames?.length
          ? ` Есть ещё: ${choice.otherNames.join(", ")}.`
          : "";
        notes.push(`«${choice.term}» — взяла ${choice.chosenName}.${others}`);
      }
      for (const note of packNotes) {
        notes.push(`«${note.term}» — в каталоге упаковка ${note.unit}; предлагаю 1 × ${note.productName}.`);
      }
      notes.push("Проверь и добавь.");

      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: terms ? "Нашла не всё." : "Нужно уточнение.",
        message: notes.join(" "),
        items,
        primaryAction: "Добавить предложенное",
        secondaryAction: "Уточнить запрос",
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
