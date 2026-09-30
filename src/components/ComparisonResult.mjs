import {
  OBSERVED_COMPARISON_CONCLUSION
} from "../core/observed-price-core.mjs";
import { getRetailerNavigation } from "../navigation/retailerNavigation.mjs";

export function formatRubMinor(minor) {
  if (!Number.isSafeInteger(minor) || minor < 0) return null;

  const rubles = Math.floor(minor / 100);
  const kopeks = String(minor % 100).padStart(2, "0");

  return `${rubles.toLocaleString("ru-RU")},${kopeks} ₽`;
}

function coverageLabel(coverage) {
  const coveredItems = Number.isInteger(coverage?.coveredItems)
    ? coverage.coveredItems
    : null;
  const totalItems = Number.isInteger(coverage?.totalItems)
    ? coverage.totalItems
    : null;

  if (coveredItems == null || totalItems == null) return null;
  return `${coveredItems} из ${totalItems} позиций`;
}

function observedAtRange(candidate) {
  const timestamps = Array.isArray(candidate?.lines)
    ? candidate.lines
        .map((line) => Date.parse(line?.observedAt))
        .filter(Number.isFinite)
    : [];

  if (timestamps.length === 0) return null;

  return Object.freeze({
    oldest: new Date(Math.min(...timestamps)).toISOString(),
    newest: new Date(Math.max(...timestamps)).toISOString()
  });
}

function formatObservedAt(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(timestamp)) + " UTC";
}

function truthLevelLabel(level) {
  if (level === "store") return "точка магазина";
  if (level === "city") return "населённый пункт";
  if (level === "region") return "регион";
  return "география не подтверждена";
}

function geographyLabel(candidate) {
  const parts = [candidate?.localityName, candidate?.regionName]
    .filter((value, index, values) => (
      typeof value === "string"
      && value.trim()
      && values.indexOf(value) === index
    ));

  return parts.length > 0 ? parts.join(" · ") : null;
}

function sourceLabel(candidate) {
  const names = Array.isArray(candidate?.sources)
    ? candidate.sources
        .map((source) => source?.sourceName)
        .filter((name) => typeof name === "string" && name.trim())
    : [];

  if (names.length > 0) return names.join(", ");
  if (typeof candidate?.sourceName === "string" && candidate.sourceName) {
    return candidate.sourceName;
  }
  return null;
}

function priceConditionLabel(candidate) {
  if (!Array.isArray(candidate?.priceConditions)) return null;
  const conditions = Array.from(new Set(candidate.priceConditions));

  if (conditions.length === 0) return "Условие цены не подтверждено";
  if (conditions.length > 1) return "Смешанные условия цены";

  if (conditions[0] === "regular") return "Обычная цена";
  if (conditions[0] === "loyalty") return "Цена по программе лояльности";
  if (conditions[0] === "promo") return "Акционная цена";
  if (conditions[0] === "unknown") return "Условие цены не подтверждено";
  return null;
}

function salesChannelLabel(candidate) {
  if (candidate?.salesChannel === "online") return "Онлайн-заказ";
  if (candidate?.salesChannel === "store") return "Покупка в магазине";
  if (candidate?.salesChannel === "unknown") return "Канал продажи не подтверждён";
  return null;
}

function priceConditionDetails(candidate) {
  const details = new Set(
    Array.isArray(candidate?.priceConditionDetails)
      ? candidate.priceConditionDetails.filter(
          (value) => typeof value === "string" && value.trim()
        )
      : []
  );

  if (Array.isArray(candidate?.lines)) {
    for (const line of candidate.lines) {
      const detail = (
        line?.conditionNote
        ?? line?.provenance?.proof?.conditionNote
        ?? line?.provenance?.conditionNote
      );
      if (typeof detail === "string" && detail.trim()) {
        details.add(detail.trim());
      }
    }
  }

  return Object.freeze(Array.from(details).sort());
}

function observedCandidateName(candidate) {
  return (
    candidate?.storeName
    ?? candidate?.candidateName
    ?? sourceLabel(candidate)
    ?? "Наблюдаемый вариант"
  );
}

function confirmedObservedPrices(candidate) {
  if (!Array.isArray(candidate?.lines)) return Object.freeze([]);

  return Object.freeze(candidate.lines
    .filter((line) => (
      line?.status === "priced-observation"
      && Number.isSafeInteger(line?.unitPriceMinor)
      && line.unitPriceMinor > 0
    ))
    .map((line) => Object.freeze({
      productId: typeof line.productId === "string" ? line.productId : null,
      priceLabel: formatRubMinor(line.unitPriceMinor)
    }))
    .filter((line) => line.priceLabel !== null));
}

export function buildWinnerResultModel(result) {
  const winner = result?.winner;
  if (!winner) return null;

  const totalLabel = formatRubMinor(winner.totalMinor);
  if (!totalLabel) return null;

  const formattedCoverage = coverageLabel(winner.coverage);
  if (!formattedCoverage) return null;

  const savingsLabel = result.savingsMinor == null
    ? null
    : formatRubMinor(result.savingsMinor);

  return Object.freeze({
    storeId: winner.storeId,
    storeName: winner.storeName,
    isMock: winner.isMock === true,
    totalLabel,
    coverageLabel: formattedCoverage,
    savingsLabel,
    actionLabel: "Показать список для этого магазина"
  });
}

export function buildObservedResultModel(result) {
  const conclusion = result?.conclusion;
  if (
    !conclusion
    || !Object.values(OBSERVED_COMPARISON_CONCLUSION).includes(conclusion.kind)
  ) {
    return null;
  }

  if (conclusion.kind === OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE) {
    const confirmedCandidates = Array.isArray(result?.candidates)
      ? result.candidates
          .map((candidate) => Object.freeze({
            title: observedCandidateName(candidate),
            prices: confirmedObservedPrices(candidate)
          }))
          .filter((candidate) => candidate.prices.length > 0)
      : [];

    return Object.freeze({
      kind: conclusion.kind,
      title: "Недостаточно данных для «дешевле»",
      note: conclusion.reason === "incomparable_geography_or_truth_level"
        ? "Есть реальные наблюдения, но их нельзя честно сравнить между разными географиями или уровнями точности."
        : conclusion.reason === "conditional_price_context"
          ? "Есть полные суммы, но часть цен зависит от акции или программы лояльности. CHECKNI не называет один вариант дешевле, пока условия цены не сопоставимы."
          : conclusion.reason === "mixed_sales_channel"
            ? "Есть полные суммы, но часть цен относится к онлайн-заказу, а часть — к покупке в магазине. CHECKNI не сравнивает их как один ценовой режим."
            : "Пока нет полного реального покрытия корзины. MOCK-цены сюда не подставляем.",
      confirmedCandidates: Object.freeze(confirmedCandidates)
    });
  }

  if (conclusion.kind === OBSERVED_COMPARISON_CONCLUSION.LOWEST_TIE) {
    const totalLabel = formatRubMinor(conclusion.totalMinor);
    if (!totalLabel) return null;

    const candidateIds = Array.isArray(conclusion.candidateIds)
      ? conclusion.candidateIds
      : [];
    const tiedNames = Array.isArray(result?.candidates)
      ? candidateIds
          .map((candidateId) => result.candidates.find(
            (candidate) => candidate?.candidateId === candidateId
          ))
          .filter(Boolean)
          .map(observedCandidateName)
      : [];

    return Object.freeze({
      kind: conclusion.kind,
      title: "Одинаковая минимальная сумма",
      totalLabel,
      tiedNames,
      savingsLabel: null,
      note: "Несколько полных сопоставимых вариантов стоят одинаково. Одного варианта «дешевле» нет, поэтому экономию не показываем."
    });
  }

  const candidate = Array.isArray(result?.candidates)
    ? result.candidates.find(
        (entry) => entry?.candidateId === conclusion.candidateId
      )
    : null;

  if (!candidate) return null;

  const totalLabel = formatRubMinor(conclusion.totalMinor);
  const formattedCoverage = coverageLabel(candidate.priceCoverage);
  if (!totalLabel || !formattedCoverage) return null;

  const observedRange = observedAtRange(candidate);
  const oldestObservedAtLabel = observedRange
    ? formatObservedAt(observedRange.oldest)
    : null;
  const newestObservedAtLabel = observedRange
    ? formatObservedAt(observedRange.newest)
    : null;
  const observedAtLabel = oldestObservedAtLabel && newestObservedAtLabel
    ? oldestObservedAtLabel === newestObservedAtLabel
      ? oldestObservedAtLabel
      : `${oldestObservedAtLabel} — ${newestObservedAtLabel}`
    : null;
  const savingsLabel = (
    conclusion.kind === OBSERVED_COMPARISON_CONCLUSION.CHEAPEST_PROVEN
    && conclusion.savingsMinor != null
  )
    ? formatRubMinor(conclusion.savingsMinor)
    : null;

  const navigation = getRetailerNavigation(candidate.retailerId);
  const conditionLabel = priceConditionLabel(candidate);
  const conditionDetails = priceConditionDetails(candidate);
  const channelLabel = salesChannelLabel(candidate);

  return Object.freeze({
    kind: conclusion.kind,
    candidateId: candidate.candidateId,
    title: observedCandidateName(candidate),
    totalLabel,
    coverageLabel: formattedCoverage,
    savingsLabel,
    sourceLabel: sourceLabel(candidate),
    geographyLabel: geographyLabel(candidate),
    ...(conditionLabel ? { priceConditionLabel: conditionLabel } : {}),
    ...(conditionDetails.length > 0
      ? { priceConditionDetails: conditionDetails }
      : {}),
    ...(channelLabel ? { salesChannelLabel: channelLabel } : {}),
    observedAtLabel,
    truthLevelLabel: truthLevelLabel(candidate.locationTruthLevel),
    availabilityLabel: candidate.availability === "unknown"
      ? "Наличие не подтверждено"
      : "Наличие подтверждается отдельно",
    ...(navigation ? { navigation } : {})
  });
}

function createModeMeta(chipText, eyebrowText) {
  const meta = document.createElement("div");
  meta.className = "product-meta";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = eyebrowText;

  const chip = document.createElement("span");
  chip.className = "mock-chip";
  chip.textContent = chipText;

  meta.append(eyebrow, chip);
  return meta;
}

export function createComparisonResult(result, { onInspectStore } = {}) {
  const model = buildWinnerResultModel(result);
  if (!model) return null;

  const section = document.createElement("section");
  section.className = "future-step comparison-result";
  section.setAttribute("aria-label", "Лучший вариант покупки");

  const meta = createModeMeta(
    model.isMock ? "DEMO · MOCK" : "CHECKNI",
    "Лучший вариант"
  );

  const heading = document.createElement("h2");
  heading.textContent = model.storeName;

  const facts = document.createElement("p");
  const factsParts = [
    `Итого ${model.totalLabel}`,
    model.coverageLabel
  ];
  if (model.savingsLabel) {
    factsParts.push(`Экономия ${model.savingsLabel}`);
  }
  facts.textContent = factsParts.join(" · ");

  const note = document.createElement("p");
  note.textContent = model.isMock
    ? "Тестовые данные. Это не подтверждённые цены или наличие конкретного магазина."
    : "Сравнение рассчитано CHECKNI.";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "primary-button";
  action.textContent = model.actionLabel;
  action.setAttribute(
    "aria-label",
    `${model.actionLabel}: ${model.storeName}`
  );
  action.addEventListener("click", () => {
    if (typeof onInspectStore === "function") {
      onInspectStore(model.storeId);
    }
  });

  section.append(meta, heading, facts, note, action);
  return section;
}

export function createObservedComparisonResult(result) {
  const model = buildObservedResultModel(result);
  if (!model) return null;

  const section = document.createElement("section");
  section.className = "future-step comparison-result observed-result";
  section.setAttribute("aria-label", "Результат по наблюдаемым ценам");

  const eyebrowText = model.kind === OBSERVED_COMPARISON_CONCLUSION.CHEAPEST_PROVEN
    ? "Дешевле по сопоставимым наблюдениям"
    : model.kind === OBSERVED_COMPARISON_CONCLUSION.LOWEST_TIE
      ? "Равный минимум"
      : model.kind === OBSERVED_COMPARISON_CONCLUSION.OBSERVED_TOTAL_ONLY
        ? "Наблюдаемая сумма"
        : "Реальные цены";

  section.append(createModeMeta("OBSERVED · REAL", eyebrowText));

  const heading = document.createElement("h2");
  heading.textContent = model.title;
  section.append(heading);

  if (model.kind === OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE) {
    const note = document.createElement("p");
    note.textContent = model.note;
    section.append(note);

    for (const candidate of model.confirmedCandidates ?? []) {
      const prices = candidate.prices
        .map((price, index) => (
          price.productId
            ? `${price.productId}: ${price.priceLabel}`
            : `Позиция ${index + 1}: ${price.priceLabel}`
        ))
        .join(" · ");

      if (!prices) continue;
      const confirmed = document.createElement("p");
      confirmed.className = "comparison-provenance";
      confirmed.textContent = `Подтверждённые цены · ${candidate.title}: ${prices}`;
      section.append(confirmed);
    }

    return section;
  }

  if (model.kind === OBSERVED_COMPARISON_CONCLUSION.LOWEST_TIE) {
    const facts = document.createElement("p");
    facts.textContent = `Минимальная сумма ${model.totalLabel}`;

    const contenders = document.createElement("p");
    contenders.className = "comparison-provenance";
    contenders.textContent = model.tiedNames.length > 0
      ? `Одинаково: ${model.tiedNames.join(" · ")}`
      : "Несколько вариантов имеют одинаковый минимум.";

    const note = document.createElement("p");
    note.textContent = model.note;
    section.append(facts, contenders, note);
    return section;
  }

  const facts = document.createElement("p");
  const factsParts = [
    `Итого ${model.totalLabel}`,
    model.coverageLabel
  ];
  if (model.savingsLabel) {
    factsParts.push(`Экономия ${model.savingsLabel}`);
  }
  facts.textContent = factsParts.join(" · ");

  const provenance = document.createElement("p");
  provenance.className = "comparison-provenance";
  provenance.textContent = [
    model.sourceLabel ? `Источник: ${model.sourceLabel}` : null,
    model.geographyLabel,
    model.truthLevelLabel,
    model.priceConditionLabel,
    ...(model.priceConditionDetails ?? []).map(
      (detail) => `Условие: ${detail}`
    ),
    model.salesChannelLabel,
    model.observedAtLabel ? `Наблюдения: ${model.observedAtLabel}` : null,
    model.availabilityLabel
  ].filter(Boolean).join(" · ");

  const note = document.createElement("p");
  note.textContent = model.kind === OBSERVED_COMPARISON_CONCLUSION.OBSERVED_TOTAL_ONLY
    ? "Это реальная наблюдаемая сумма, но сопоставимых полных вариантов пока недостаточно, чтобы назвать её самой дешёвой."
    : "«Дешевле» показано только среди полных сопоставимых наблюдений в одной географии и на одном уровне точности.";

  section.append(facts, provenance, note);

  if (model.navigation) {
    const action = document.createElement("a");
    action.className = "primary-button";
    action.href = model.navigation.url;
    action.target = "_blank";
    action.rel = "noopener noreferrer";
    action.textContent = model.navigation.label;
    action.setAttribute(
      "aria-label",
      `${model.navigation.label} — официальный сайт, откроется в новой вкладке`
    );
    section.append(action);
  }

  return section;
}
