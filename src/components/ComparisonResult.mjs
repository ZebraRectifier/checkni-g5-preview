import {
  OBSERVED_COMPARISON_CONCLUSION
} from "../core/observed-price-core.mjs";
import { getRetailerNavigation } from "../navigation/retailerNavigation.mjs";
import { metroCatalogLineMaxAgeMs, METRO_CATALOG_PRICE_MAX_AGE_MS } from "../observations/retailCatalogFreshnessPolicy.mjs";

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

function candidateObservedAtLabel(candidate) {
  const range = observedAtRange(candidate);
  if (!range) return null;
  const first = formatObservedAt(range.oldest), last = formatObservedAt(range.newest);
  return first && last ? first === last ? first : `${first} — ${last}` : null;
}

function candidateAddress(candidate) {
  return typeof candidate?.locationLabel === 'string' && candidate.locationLabel.trim()
    ? candidate.locationLabel.trim() : null;
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

function confirmedObservedPrices(candidate, basket) {
  if (!Array.isArray(candidate?.lines)) return Object.freeze([]);

  const labels = new Map((Array.isArray(basket) ? basket : [])
    .filter(item => typeof item?.product?.id === "string"
      && typeof item.product.name === "string" && item.product.name.trim())
    .map(item => [item.product.id, [item.product.name, item.product.unit]
      .filter(value => typeof value === "string" && value.trim()).join(", ")]));

  return Object.freeze(candidate.lines
    .filter((line) => (
      line?.status === "priced-observation"
      && Number.isSafeInteger(line?.unitPriceMinor)
      && line.unitPriceMinor > 0
    ))
    .map((line) => Object.freeze({
      productId: typeof line.productId === "string" ? line.productId : null,
      priceLabel: formatRubMinor(line.unitPriceMinor),
      ...(labels.has(line.productId) ? { productLabel: labels.get(line.productId) } : {}),
      ...(formatObservedAt(line.observedAt)
        ? { observedAtLabel: formatObservedAt(line.observedAt) } : {})
    }))
    .filter((line) => line.priceLabel !== null));
}

function unconfirmedObservedItems(candidate, basket) {
  if (!Array.isArray(candidate?.lines) || !Array.isArray(basket)) return Object.freeze([]);
  const names = new Map(basket.filter(item => typeof item?.product?.id === "string"
    && typeof item.product.name === "string" && item.product.name.trim())
    .map(item => [item.product.id, item.product.name.trim()]));
  const seen = new Set();
  return Object.freeze(candidate.lines.flatMap(line => {
    if (!line || line.status === "priced-observation" || typeof line.productId !== "string"
        || !names.has(line.productId) || seen.has(line.productId)) return [];
    seen.add(line.productId);
    return [names.get(line.productId)];
  }));
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

function catalogueFreshnessLabels(result, nowMs) {
  return (Array.isArray(result?.candidates) ? result.candidates : []).flatMap(candidate => {
    const times = (Array.isArray(candidate?.lines) ? candidate.lines : [])
      .filter(line => line?.status === "priced-observation"
        && metroCatalogLineMaxAgeMs(line.provenance?.sourceId ?? candidate.sourceId, line, candidate, nowMs)
          === METRO_CATALOG_PRICE_MAX_AGE_MS)
      .map(line => Date.parse(line.observedAt));
    if (!times.length) return [];
    const oldest = Math.min(...times);
    const newest = Math.max(...times);
    const format = time => formatObservedAt(new Date(time).toISOString());
    const observed = oldest === newest ? format(oldest) : `${format(oldest)} — ${format(newest)}`;
    return [`Сохранённые цены METRO · ${observedCandidateName(candidate)} · наблюдались ${observed} · окно сравнения — 1 час от наблюдения, до ${format(oldest + METRO_CATALOG_PRICE_MAX_AGE_MS)}`];
  });
}

export function buildObservedResultModel(result, { nowMs = Date.now() } = {}) {
  const conclusion = result?.conclusion;
  if (
    !conclusion
    || !Object.values(OBSERVED_COMPARISON_CONCLUSION).includes(conclusion.kind)
  ) {
    return null;
  }
  const labels = catalogueFreshnessLabels(result, nowMs);
  const freshness = labels.length ? { catalogueFreshnessLabels: Object.freeze(labels) } : {};

  if (conclusion.kind === OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE) {
    const confirmedCandidates = Array.isArray(result?.candidates)
      ? result.candidates
          .map((candidate) => Object.freeze({
            title: observedCandidateName(candidate),
            prices: confirmedObservedPrices(candidate, result.basket),
            ...(unconfirmedObservedItems(candidate, result.basket).length
              ? { unconfirmedItems: unconfirmedObservedItems(candidate, result.basket) } : {})
          }))
          .filter((candidate) => candidate.prices.length > 0 || candidate.unconfirmedItems?.length > 0)
      : [];

    return Object.freeze({
      ...freshness,
      kind: conclusion.kind,
      title: "Недостаточно данных для «дешевле»",
      note: conclusion.reason === "incomparable_geography_or_truth_level"
        ? "Есть реальные наблюдения, но их нельзя честно сравнить между разными географиями или уровнями точности."
        : conclusion.reason === "conditional_price_context"
          ? "Есть полные суммы, но часть цен зависит от акции или программы лояльности. CHECKNI не называет один вариант дешевле, пока условия цены не сопоставимы."
          : conclusion.reason === "mixed_sales_channel"
            ? "Есть полные суммы, но часть цен относится к онлайн-заказу, а часть — к покупке в магазине. CHECKNI не сравнивает их как один ценовой режим."
            : "Не хватает свежих цен для всей корзины. Полную сумму и экономию пока не показываем.",
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
      ...freshness,
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

  const navigation = getRetailerNavigation(candidate.retailerId, candidate);
  const conditionLabel = priceConditionLabel(candidate);
  const conditionDetails = priceConditionDetails(candidate);
  const channelLabel = salesChannelLabel(candidate);
  const linePrices = confirmedObservedPrices(candidate, result.basket);
  // Core's savings is relative to its second comparison-ready candidate.
  // Only identify that candidate when exactly two are eligible and the Core
  // totals prove the relationship; never infer it from a partial offer.
  const ready = Array.isArray(result?.candidates)
    ? result.candidates.filter(entry => entry?.completeComparisonReadyCoverage === true && entry?.contextCoherent === true)
    : [];
  const other = conclusion.kind === OBSERVED_COMPARISON_CONCLUSION.CHEAPEST_PROVEN && ready.length === 2
    ? ready.find(entry => entry.candidateId !== conclusion.candidateId) : null;
  const otherTotal = other && Number.isSafeInteger(other.totalMinor) && Number.isSafeInteger(conclusion.savingsMinor)
    && other.totalMinor === conclusion.totalMinor + conclusion.savingsMinor ? formatRubMinor(other.totalMinor) : null;
  const otherAddress = candidateAddress(other), otherObservedAt = candidateObservedAtLabel(other);

  return Object.freeze({
    ...freshness,
    kind: conclusion.kind,
    candidateId: candidate.candidateId,
    title: observedCandidateName(candidate),
    ...(candidateAddress(candidate) ? { addressLabel: candidateAddress(candidate) } : {}),
    totalLabel,
    coverageLabel: formattedCoverage,
    savingsLabel,
    ...(linePrices.length ? { linePrices } : {}),
    ...(otherTotal ? { otherCandidate: { title: observedCandidateName(other), totalLabel: otherTotal,
      ...(otherAddress ? { addressLabel: otherAddress } : {}), ...(otherObservedAt ? { observedAtLabel: otherObservedAt } : {}) } } : {}),
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

  meta.append(eyebrow);
  if (chipText !== eyebrowText) meta.append(chip);
  return meta;
}

export function createComparisonResult(result, { onInspectStore } = {}) {
  const model = buildWinnerResultModel(result);
  if (!model) return null;

  const section = document.createElement("section");
  section.className = "future-step comparison-result";
  section.setAttribute("aria-label", "Лучший вариант покупки");

  const meta = createModeMeta(
    model.isMock ? "Тестовые цены" : "CHECKNI",
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

  section.append(createModeMeta("Реальные цены", eyebrowText));

  const heading = document.createElement("h2");
  heading.textContent = model.title;
  section.append(heading);
  if (model.addressLabel) {
    const address = document.createElement('p'); address.className = 'comparison-provenance';
    address.textContent = model.addressLabel; section.append(address);
  }

  for (const label of model.catalogueFreshnessLabels ?? []) {
    const freshness = document.createElement("p");
    freshness.className = "comparison-provenance";
    freshness.textContent = label;
    section.append(freshness);
  }

  if (model.kind === OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE) {
    const note = document.createElement("p");
    note.textContent = model.note;
    section.append(note);

    for (const candidate of model.confirmedCandidates ?? []) {
      const prices = candidate.prices
        .map((price, index) => (
          `${price.productLabel ?? `Позиция ${index + 1}`}: ${price.priceLabel}`
          + (price.observedAtLabel ? ` · наблюдалась ${price.observedAtLabel}` : "")
        ))
        .join(" · ");

      if (prices) {
        const confirmed = document.createElement("p");
        confirmed.className = "comparison-provenance";
        confirmed.textContent = `Подтверждённые цены · ${candidate.title}: ${prices}`;
        section.append(confirmed);
      }
      if (candidate.unconfirmedItems?.length) {
        const details = document.createElement("details");
        details.className = "comparison-provenance";
        const summary = document.createElement("summary");
        summary.textContent = `Нет подтверждённой цены · ${candidate.title} · ${candidate.unconfirmedItems.length}`;
        const list = document.createElement("ul");
        for (const name of candidate.unconfirmedItems) {
          const item = document.createElement("li");
          item.textContent = name;
          list.append(item);
        }
        details.append(summary, list);
        section.append(details);
      }
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

  const other = model.otherCandidate ? document.createElement('p') : null;
  if (other) {
    other.className = 'comparison-provenance';
    other.textContent = [model.otherCandidate.title, model.otherCandidate.addressLabel,
      `${model.otherCandidate.totalLabel} · наблюдаемая сумма`,
      model.otherCandidate.observedAtLabel ? `Наблюдения: ${model.otherCandidate.observedAtLabel}` : null].filter(Boolean).join(' · ');
  }
  section.append(facts, provenance);
  if (other) section.append(other);
  section.append(note);
  if (model.linePrices?.length) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Цены по товарам · ${model.title}`;
    const list = document.createElement('ul');
    for (const line of model.linePrices) {
      const item = document.createElement('li');
      item.textContent = `${line.productLabel ?? 'Товар'}: ${line.priceLabel} за единицу`
        + (line.observedAtLabel ? ` · наблюдение ${line.observedAtLabel}` : '');
      list.append(item);
    }
    details.append(summary, list); section.append(details);
  }

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

