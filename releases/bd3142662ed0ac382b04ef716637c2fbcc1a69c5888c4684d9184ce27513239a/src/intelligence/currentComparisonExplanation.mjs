import { OBSERVED_LINE_STATUS, OBSERVED_COMPARISON_CONCLUSION } from '../core/observed-price-core.mjs';
import { buildObservedResultModel, formatRubMinor } from '../components/ComparisonResult.mjs';
import { GLOBUS_CATALOG_PRICE_MAX_AGE_MS } from '../ports/selectedGlobusCatalogOffersPort.mjs';

// Read/presentation only. The existing UI flow owns this in-memory receipt;
// Core owns every total, coverage, conclusion and savings value below.
export function currentComparisonExplanation(receipt, { nowMs = Date.now() } = {}) {
  const result = receipt?.result; const context = receipt?.context; const scope = context?.scope;
  if (!Number.isSafeInteger(nowMs) || context?.mode !== 'observed'
      || scope?.kind !== 'selected-store-scope' || scope.valid !== true || scope.mode !== 'selected'
      || typeof scope.key !== 'string' || !scope.key || !Array.isArray(scope.stores)
      || result?.kind !== 'observed-price-comparison' || !Array.isArray(result.candidates)) return null;
  let priced = 0; let oldest = Infinity;
  for (const candidate of result.candidates) {
    for (const line of Array.isArray(candidate?.lines) ? candidate.lines : []) {
      if (line?.status !== OBSERVED_LINE_STATUS.PRICED) continue;
      priced++;
      const selected = scope.stores.find(store => store.retailerId === 'globus'
        && store.storeIds?.includes(candidate.storeId) && store.address === candidate.locationLabel);
      const observed = typeof line.observedAt === 'string' ? Date.parse(line.observedAt) : NaN;
      if (!selected || candidate.sourceId !== 'globus-physical-catalog'
          || (line.provenance?.sourceId ?? candidate.sourceId) !== 'globus-physical-catalog'
          || candidate.retailerId !== 'globus' || candidate.granularity !== 'exact-store'
          || candidate.locationTruthLevel !== 'store' || line.salesChannel !== 'store'
          || !Number.isFinite(observed) || observed > nowMs
          || nowMs - observed > GLOBUS_CATALOG_PRICE_MAX_AGE_MS) return null;
      oldest = Math.min(oldest, observed);
    }
  }
  if (!priced) return null; // No guessed TTL for unsupported/missing observations.
  const model = buildObservedResultModel(result);
  if (!model) return null;
  const footer = `Наблюдения: ${model.observedAtLabel ?? new Date(oldest).toISOString()}. Наличие товаров не подтверждено.`;
  if (model.kind === OBSERVED_COMPARISON_CONCLUSION.CHEAPEST_PROVEN) {
    const winner = result.candidates.find(candidate => candidate.candidateId === result.conclusion.candidateId);
    const peers = result.candidates.filter(candidate => candidate.candidateId !== winner.candidateId
      && candidate.completeComparisonReadyCoverage === true).map(candidate =>
      `${candidate.storeName} (${candidate.locationLabel}) — ${formatRubMinor(candidate.totalMinor)}`).join('; ');
    return `${model.title} (${winner.locationLabel}) — ${model.totalLabel}, ${model.coverageLabel}. Это более дешёвая корзина среди полных сопоставимых наблюдений выбранных адресов.`
      + (peers ? ` Другие полные варианты: ${peers}.` : '')
      + (model.savingsLabel ? ` Экономия ${model.savingsLabel} относительно следующей полной корзины.` : '')
      + ` ${[model.priceConditionLabel, model.salesChannelLabel].filter(Boolean).join('; ')}. ${footer}`;
  }
  if (model.kind === OBSERVED_COMPARISON_CONCLUSION.LOWEST_TIE) return `Одинаковый минимум ${model.totalLabel}: ${model.tiedNames.join('; ')}. ${model.note} ${footer}`;
  if (model.kind === OBSERVED_COMPARISON_CONCLUSION.OBSERVED_TOTAL_ONLY) return `${model.title} — наблюдаемая сумма ${model.totalLabel}, ${model.coverageLabel}. ${[model.priceConditionLabel, model.salesChannelLabel].filter(Boolean).join('; ')}. Полных сопоставимых вариантов недостаточно, чтобы назвать этот адрес самым дешёвым или показать экономию. ${footer}`;
  if (model.kind === OBSERVED_COMPARISON_CONCLUSION.INSUFFICIENT_COVERAGE) return `Победителя и экономию сейчас определить нельзя. ${model.note} ${footer}`;
  return null;
}
