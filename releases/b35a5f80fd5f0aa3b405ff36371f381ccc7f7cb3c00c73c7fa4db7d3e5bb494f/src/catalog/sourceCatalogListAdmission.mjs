import {PEREKRESTOK_REVIEWED_LIST_CONTEXT as PEREK, PEREKRESTOK_REVIEWED_LIST_PACKS} from './perekrestokReviewedList.mjs';
import {WEEKLY_PEREKRESTOK_IDENTITIES} from './weeklyPerekrestokIdentities.mjs';

// Manual list admission only. It never creates a canonical product, a quote,
// stock assertion or cross-retailer equivalence. Core keeps its own freshness.
export const SOURCE_CATALOG_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const admittedCards = new WeakMap();
// A failed reviewed identity must not become addable through the broader list
// fallback. Those source IDs retain their existing exact-pack admission gates.
const reservedIds = {
  perekrestok: new Set([...PEREKRESTOK_REVIEWED_LIST_PACKS, ...WEEKLY_PEREKRESTOK_IDENTITIES].map(row => row.sourceProductId)),
  metro: new Set(['241097', '241096', '644791'])
};
const units = /^(\d+(?:[.,]\d+)?)\s*(кг|г|мл|л|шт\.?)$/iu;
const uncertain = /(?:весов|развес|на\s+вес|цена\s+за|за\s+\d|приблиз|около\s+\d|[≈~])/iu;
const unitKey = value => typeof value === 'string'
  ? value.trim().toLowerCase().replace(/\s+/gu, '').replace(',', '.').replace(/\.$/u, '') : null;

function exactUnit(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const match = units.exec(value.trim());
  const amount = match ? Number(match[1].replace(',', '.')) : NaN;
  return Number.isFinite(amount) && amount > 0 ? value.trim() : null;
}

const titleSizes = name => [...name.matchAll(/\d+(?:[.,]\d+)?\s*(?:кг|г|мл|л|шт)(?=[\s.,/)]|$)/giu)].map(match => match[0]);

function titleUnit(name) {
  // A single explicit trailing size is evidence; quantities elsewhere in a
  // title, multipacks, ranges and approximate weights are not pack evidence.
  if (titleSizes(name).length !== 1) return null;
  const match = /(?:^|[,\s])(\d+(?:[.,]\d+)?)\s*(кг|г|мл|л|шт\.?)$/iu.exec(name);
  if (!match || /(?:\d\s*[xх×*]|\d\s*[-–—])\s*$/iu.test(name.slice(0, match.index))) return null;
  return exactUnit(`${match[1]} ${match[2]}`);
}

function sourceUnit(row) {
  if (uncertain.test(row.name) || /\d\s*[xх×*]\s*\d/iu.test(row.name)) return null;
  const semantics = row.quantity_semantics;
  if (semantics != null && (typeof semantics !== 'object' || Array.isArray(semantics))) return null;
  if (semantics && Object.keys(semantics).length && !(semantics.packageType === 'piece'
      && ['1 шт', '1 уп'].includes(semantics.unitPriceText)
      && Object.keys(semantics).every(key => ['packageType', 'unitPriceText'].includes(key)))) return null;
  const supplied = exactUnit(row.weight_text);
  const fromTitle = titleUnit(row.name);
  if (supplied && titleSizes(row.name).some(size => unitKey(supplied) !== unitKey(size))) return null;
  // METRO's source often keeps the explicit pack only in the title. Never
  // replace a contradictory/ambiguous supplied unit with that title suffix.
  return supplied ?? (row.retailer_id === 'metro' && row.weight_text == null ? fromTitle : null);
}

function sourceUrl(raw, hosts, prefixes) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search
      && hosts.includes(url.host) && prefixes.some(prefix => url.pathname.startsWith(prefix)) ? url.href : null;
  } catch { return null; }
}

function validScope(row, definition) {
  if (row.scope_evidence_url !== row.source_url) return false;
  if (row.retailer_id === 'vkusvill') {
    return definition.storeId === 'vkusvill-public-web' && row.binding_id === definition.storeId
      && row.locality_id === 'country-ru-public-catalog' && row.locality_name === 'Россия'
      && row.sales_channel === 'online-catalog' && row.scope_binding === 'public-catalog-unscoped'
      && row.minimum_quantity === 1 && ['public-online', 'loyalty-vkusvill', 'promo'].includes(row.price_condition)
      && sourceUrl(row.product_url, ['vkusvill.ru', 'www.vkusvill.ru'], ['/goods/'])
      && new URL(row.product_url).pathname.endsWith(`-${row.source_product_id}/`)
      && sourceUrl(row.source_url, ['vkusvill.ru', 'www.vkusvill.ru'], ['/goods/']);
  }
  if (row.retailer_id === 'perekrestok') {
    // This is the pinned delivery catalogue, never a physical shop offer.
    return definition.storeId === PEREK.storeId && row.binding_id === PEREK.bindingId
      && row.locality_id === 'city-moscow' && row.locality_name === 'Москва'
      && row.sales_channel === PEREK.salesChannel && row.scope_binding === 'same-source'
      && row.location_label === PEREK.locationLabel && row.store_name === PEREK.storeName
      && (row.minimum_quantity == null || row.minimum_quantity === 1)
      && ['yandex-eda-regular', 'yandex-eda-promo'].includes(row.price_condition)
      && row.product_url === PEREK.sourceUrl && row.source_url === PEREK.sourceUrl;
  }
  if (row.retailer_id === 'metro') {
    return /^metro-address-[a-z0-9]+$/u.test(definition.storeId)
      && row.binding_id === definition.storeId && row.sales_channel === 'online'
      && row.scope_binding === 'same-source' && row.minimum_quantity === 1 && row.price_condition === 'regular'
      && row.locality_id === definition.localityId && row.locality_name === definition.localityName
      && (definition.acceptedLocationLabels ?? [definition.storeAddress]).includes(row.location_label)
      && sourceUrl(row.product_url, ['online.metro-cc.ru'], ['/products/'])
      && sourceUrl(row.source_url, ['online.metro-cc.ru'], ['/products/', '/dynamic/']);
  }
  return false;
}

function current(card, nowMs) {
  const observed = Date.parse(card.observedAt);
  return Number.isFinite(nowMs) && Number.isFinite(observed)
    && observed <= nowMs && nowMs - observed < SOURCE_CATALOG_LIST_MAX_AGE_MS;
}

/** Called only by the retail adapter after its ordinary source/scope guards. */
export function admitSourceCatalogListCard(card, {row, definition, nowMs = Date.now()} = {}) {
  if (!row || !definition || !card || !['vkusvill', 'perekrestok', 'metro'].includes(row.retailer_id)
      || definition.retailerId !== row.retailer_id || card.retailerId !== row.retailer_id
      || row.store_id !== definition.storeId || typeof row.source_product_id !== 'string'
      || !/^[a-zA-Z0-9_-]{1,80}$/u.test(row.source_product_id)
      || reservedIds[row.retailer_id]?.has(row.source_product_id)
      || card.sourceProductId !== row.source_product_id
      || card.id !== `retail:${row.retailer_id}:${row.store_id}:${row.source_product_id}`
      || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 300
      || card.name !== row.name.trim() || card.catalogDisplayOnly !== true
      || card.currency !== 'RUB' || row.currency !== 'RUB'
      || !Number.isSafeInteger(card.priceMinor) || card.priceMinor <= 0 || card.priceMinor !== row.price_minor
      || card.availability !== 'unknown' || row.availability !== 'unknown'
      || card.priceCondition !== row.price_condition || card.sourceUrl !== row.source_url
      || card.productUrl !== row.product_url || Date.parse(card.observedAt) !== Date.parse(row.observed_at)
      || !current(card, nowMs) || !validScope(row, definition)) return null;
  const unit = sourceUnit(row);
  if (!unit || (card.unit !== 'упаковка' && unitKey(card.unit) !== unitKey(unit))) return null;
  const admitted = Object.freeze({...card, unit, sourceListOnly: true, basketProductId: card.id});
  admittedCards.set(admitted, Object.freeze({id: admitted.id, name: admitted.name, unit,
    category: typeof admitted.category === 'string' ? admitted.category : 'Продукты · выбранный каталог'}));
  return admitted;
}

/** JSON/storage/id-only inputs cannot recreate runtime catalogue admission. */
export function sourceCatalogListSelection(card, {nowMs = Date.now()} = {}) {
  const product = card && admittedCards.get(card);
  return product && current(card, nowMs) ? {card, product} : null;
}
