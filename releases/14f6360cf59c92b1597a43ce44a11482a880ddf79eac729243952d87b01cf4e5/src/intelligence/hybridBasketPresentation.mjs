import {
  HYBRID_DRAFT_CONFIRMATION,
  canConfirmHybridBasketDraft
} from "./hybridBasketConfirmation.mjs";
import { formatRubMinor } from "../components/ComparisonResult.mjs";
import { MARTEN_STATE } from "./martenMind.mjs";

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

function defaultMascotState(state) {
  if (state === HYBRID_PRESENTATION_STATE.READY) return MARTEN_STATE.FOUND;
  if (state === HYBRID_PRESENTATION_STATE.CLARIFY) return MARTEN_STATE.CHECKING;
  return MARTEN_STATE.ERROR;
}

function freezeView(state, details = {}) {
  return Object.freeze({
    state,
    mascotState: details.mascotState ?? defaultMascotState(state),
    headline: details.headline ?? "",
    message: details.message ?? "",
    items: details.items ?? Object.freeze([]),
    primaryAction: details.primaryAction ?? null,
    secondaryAction: details.secondaryAction ?? null,
    focusClarification: details.focusClarification === true
  });
}

function commercialBasketItems(commercial) {
  if (!Array.isArray(commercial?.basket)) return Object.freeze([]);

  return Object.freeze(commercial.basket.map((row) => Object.freeze({
    productId: row.id,
    name: row.name,
    unit: row.unit,
    quantity: row.quantity
  })));
}

function retailPriceSummary(products) {
  if (!Array.isArray(products)) return "";
  return products
    .slice(0, 3)
    .map((product) => {
      const condition = product.priceConditionLabel
        ? ` · ${product.priceConditionLabel}`
        : "";
      const pack = product.unit ? ` · ${product.unit}` : "";
      const time = Number.isFinite(Date.parse(product.observedAt))
        ? ` · наблюдение ${new Date(product.observedAt).toLocaleDateString("ru-RU", { timeZone: "UTC" })}`
        : " · дата наблюдения неизвестна";
      return `${product.name}${pack} — ${formatRubMinor(product.priceMinor)}${condition}${time}`;
    })
    .join("; ");
}

function catalogIdentitySummary(products) {
  if (!Array.isArray(products)) return "";
  return products
    .slice(0, 4)
    .map((product) => `${product.name} (${product.unit})`)
    .join("; ");
}

function commercialView(commercial) {
  const items = commercialBasketItems(commercial);
  const comparison = commercial?.comparison;
  const conclusion = comparison?.conclusion;

  if (conclusion?.kind === "cheapest-proven" && comparison?.winner) {
    const winner = comparison.winner;
    const savings = Number.isSafeInteger(conclusion.savingsMinor)
      ? ` Экономия против следующего сопоставимого варианта — ${formatRubMinor(conclusion.savingsMinor)}.`
      : "";
    return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
      headline: `По проверенным данным дешевле — ${winner.candidateName}.`,
      message:
        `Сумма по этой корзине — ${formatRubMinor(conclusion.totalMinor)}.`
        + savings
        + " Наличие по видимой цене не подтверждаю.",
      items,
      primaryAction: "Уточнить запрос",
      secondaryAction: "Уточнить запрос",
      focusClarification: true
    });
  }

  if (conclusion?.kind === "lowest-tie") {
    return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
      headline: "Минимальная подтверждённая сумма совпала.",
      message:
        `Сопоставимые варианты дают ${formatRubMinor(conclusion.totalMinor)}. `
        + "Наличие по видимой цене не подтверждаю.",
      items,
      primaryAction: "Уточнить запрос",
      secondaryAction: "Уточнить запрос",
      focusClarification: true
    });
  }

  if (conclusion?.kind === "observed-total-only" && comparison?.winner) {
    return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
      headline: `Нашла подтверждённую сумму: ${comparison.winner.candidateName}.`,
      message:
        `${formatRubMinor(conclusion.totalMinor)} по наблюдаемым ценам. `
        + "Другого сопоставимого полного варианта пока нет, поэтому победителя не объявляю. "
        + "Наличие не подтверждено.",
      items,
      primaryAction: "Уточнить запрос",
      secondaryAction: "Уточнить запрос",
      focusClarification: true
    });
  }

  const retailerObservation = commercial?.retailerObservation;
  if (
    retailerObservation
    && Number.isSafeInteger(retailerObservation.totalMinor)
    && retailerObservation.totalMinor > 0
  ) {
    return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
      headline: `Нашла подтверждённую цену для ${retailerObservation.candidateName}.`,
      message:
        `По сопоставимым наблюдениям: ${formatRubMinor(retailerObservation.totalMinor)}. `
        + "Это не утверждение о наличии — наличие остаётся неизвестным.",
      items,
      primaryAction: "Уточнить запрос",
      secondaryAction: "Уточнить запрос",
      focusClarification: true
    });
  }

  const retailSummary = retailPriceSummary(commercial?.retailProducts);
  if (retailSummary) {
    const retailerName = commercial.retailProducts[0]?.retailerDisplayName
      ?? "магазине";
    const storeName = commercial.retailProducts[0]?.storeName;
    const scopeLabel = typeof storeName === "string" && storeName
      ? storeName
      : retailerName;
    return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
      headline: `Нашла варианты для ${scopeLabel}.`,
      message:
        `${retailSummary}. Это публичные наблюдаемые цены именно этого каталога; `
        + "наличие неизвестно. Разные бренды, состав и упаковки не считаю одним товаром "
        + "и не называю победителя.",
      items,
      primaryAction: "Уточнить товар",
      secondaryAction: "Искать вручную",
      focusClarification: true
    });
  }

  const catalogSummary = catalogIdentitySummary(commercial?.catalogProducts);
  if (catalogSummary) {
    return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
      headline: "Нашла похожие подтверждённые товары.",
      message:
        `${catalogSummary}. Выбери конкретный вариант — цену, наличие и магазин `
        + "я не буду угадывать.",
      items,
      primaryAction: "Уточнить товар",
      secondaryAction: "Искать вручную",
      focusClarification: true
    });
  }

  if (conclusion?.kind === "insufficient-coverage" || items.length > 0) {
    return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
      headline: "Для честного сравнения данных пока не хватает.",
      message:
        "Товар поняла, но CHECKNI не видит достаточно сопоставимых текущих цен, "
        + "чтобы назвать самый дешёвый вариант. Корзину не меняю.",
      items,
      primaryAction: "Уточнить запрос",
      secondaryAction: "Искать вручную",
      focusClarification: true
    });
  }

  return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
    headline: "Для честного сравнения данных пока не хватает.",
    message: "CHECKNI не видит достаточно сопоставимых текущих цен. Не все товары удалось точно сопоставить с каталогом — уточни название или упаковку. Корзину не меняю.",
    items,
    primaryAction: "Уточнить запрос",
    secondaryAction: "Искать вручную",
    focusClarification: true
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

    if (result.triggerReason === "approximate_match") {
      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: "Нужно уточнить товар.",
        message: `Для ${listTerms(result.approximateTerms)} нашёл только похожее название. Проверь предложенные товары и упаковки: это именно то, что нужно? До подтверждения список не меняю.`,
        items,
        primaryAction: "Да, выбрать предложенное",
        secondaryAction: "Исправить",
        focusClarification: true
      });
    }

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
        mascotState: result.assistantReply.mascotState ?? MARTEN_STATE.CURIOUS,
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
      const terms = listTerms(result.unresolvedTerms);
      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: "Поняла не всё.",
        mascotState: MARTEN_STATE.PARTIAL,
        message: terms
          ? `Проверь, правильно ли я поняла: ${terms}. Показываю только то, что смогла сопоставить с каталогом.`
          : "Показываю только то, что смогла уверенно сопоставить. Непонятную часть лучше уточнить, чтобы не положить в корзину не тот товар.",
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

    if (
      result.triggerReason === "commercial_constraint"
      && result.reason === "commercial_truth"
      && result.commercial
    ) {
      const view = commercialView(result.commercial);
      if (view) return view;
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
        mascotState: MARTEN_STATE.PARTIAL,
        items,
        primaryAction: "Уточнить",
        secondaryAction: items.length > 0 && canAddFoundOnly
          ? "Добавить только найденное"
          : "Искать вручную",
        focusClarification: true
      });
    }

    if (result.triggerReason === "ambiguous_segment") {
      const choices = Array.isArray(result.ambiguousChoices)
        ? result.ambiguousChoices.slice(0, 5)
        : [];
      const descriptions = choices.map((choice) => {
        const options = Array.isArray(choice?.options)
          ? choice.options.filter((name) => typeof name === "string" && name)
          : [];
        return typeof choice?.term === "string" && choice.term && options.length > 0
          ? `«${choice.term}» может означать: ${options.join(", ")}.`
          : typeof choice?.term === "string" && choice.term
            ? `«${choice.term}» нужно уточнить.`
            : "";
      }).filter(Boolean);
      const unresolved = listTerms(result.unresolvedTerms);
      if (unresolved) descriptions.push(`Ещё не нашла: ${unresolved}.`);
      const message = descriptions.length > 0
        ? `${descriptions.join(" ")} Уточни, какой товар нужен.`
        : "Не буду выбирать за тебя — уточни, какой товар нужен.";

      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: "Есть несколько похожих товаров.",
        message,
        mascotState: MARTEN_STATE.PARTIAL,
        items,
        primaryAction: "Уточнить товар",
        secondaryAction: "Искать вручную",
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
        const options = Array.isArray(choice.options)
          ? choice.options.filter((name) => typeof name === "string" && name)
          : [];
        notes.push(
          options.length > 0
            ? `«${choice.term}» может означать: ${options.join(", ")}. Уточни, какой нужен.`
            : `«${choice.term}» нужно уточнить.`
        );
      }
      for (const note of packNotes) {
        notes.push(`«${note.term}» — в каталоге упаковка ${note.unit}; предлагаю 1 × ${note.productName}.`);
      }
      notes.push("Проверь и добавь.");

      const canAddFound = items.length > 0;

      return freezeView(HYBRID_PRESENTATION_STATE.CLARIFY, {
        headline: terms ? "Нашла не всё." : "Нужно уточнение.",
        message: notes.join(" "),
        mascotState: terms ? MARTEN_STATE.PARTIAL : MARTEN_STATE.CHECKING,
        items,
        primaryAction: canAddFound ? "Добавить найденное" : "Уточнить запрос",
        secondaryAction: canAddFound ? "Уточнить запрос" : "Искать вручную",
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
