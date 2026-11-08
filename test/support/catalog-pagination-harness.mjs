import { FILTERED_CATALOG_EMPTY, canLoadMoreCatalogPage, catalogPageProgress }
  from '../../src/runtime/catalogPagination.mjs';

const params = new URLSearchParams(location.search);
const progress = catalogPageProgress({
  rawPageSize: Number(params.get('raw')),
  admittedPageSize: Number(params.get('admitted'))
});
const main = document.getElementById('result');
if (progress.filtered) {
  const title = document.createElement('h1'); title.textContent = FILTERED_CATALOG_EMPTY.title;
  const copy = document.createElement('p'); copy.textContent = FILTERED_CATALOG_EMPTY.copy;
  main.append(title, copy);
}
if (canLoadMoreCatalogPage({ progress, pageLimit: 40, nextOffset: 40 })) {
  const button = document.createElement('button'); button.textContent = 'Показать ещё'; main.append(button);
}
