export const FILTERED_CATALOG_EMPTY = Object.freeze({
  title: 'Нет актуальных товаров',
  copy: 'Источник ответил, но свежих проверенных карточек в этой выдаче нет.',
  status: 'Актуальных товаров сейчас нет',
  end: 'Других актуальных товаров сейчас нет',
  more: 'В этой порции подходящих карточек нет. Следующую можно проверить вручную.',
  moreAction: 'Проверить следующую страницу'
});

export function catalogPageProgress(result, fallbackSize = 0) {
  const fallback = Number.isSafeInteger(fallbackSize) && fallbackSize >= 0 ? fallbackSize : 0;
  const raw = Number.isSafeInteger(result?.rawPageSize) && result.rawPageSize >= 0
    ? result.rawPageSize
    : Number.isSafeInteger(result?.pageSize) && result.pageSize >= 0 ? result.pageSize : fallback;
  const admitted = Number.isSafeInteger(result?.admittedPageSize) && result.admittedPageSize >= 0
    ? result.admittedPageSize : fallback;
  return Object.freeze({ raw, admitted, filtered: raw > 0 && admitted === 0 });
}

export function canLoadMoreCatalogPage({ progress, pageLimit, nextOffset, offset = 0, expectedCount = 0,
  allowFiltered = false }) {
  const hasVisibleOrManualContinuation = progress.admitted > 0 || allowFiltered && progress.filtered;
  return hasVisibleOrManualContinuation && progress.raw === pageLimit && nextOffset > offset && nextOffset <= 10_000
    && (expectedCount <= 0 || nextOffset < expectedCount);
}
