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
  const more = document.createElement('p'); more.textContent = FILTERED_CATALOG_EMPTY.more;
  main.append(title, copy, more);
}
if (canLoadMoreCatalogPage({ progress, pageLimit: 40, nextOffset: 40, allowFiltered: true })) {
  const button = document.createElement('button');
  button.textContent = progress.filtered ? FILTERED_CATALOG_EMPTY.moreAction : 'Показать ещё';
  button.dataset.autoPaging = String(canLoadMoreCatalogPage({ progress, pageLimit: 40, nextOffset: 40 }));
  main.append(button);
}
