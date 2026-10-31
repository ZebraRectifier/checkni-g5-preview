// Exact pack identities from the retained delivery snapshot; no prices or
// comparison offers. Evidence time identifies the review, never price freshness.
export const PEREKRESTOK_REVIEWED_LIST_CONTEXT = Object.freeze({
  retailerId: 'perekrestok',
  storeId: 'perekrestok-yandex-3186917',
  bindingId: 'yandex-eda:perekryostok_h5q7w:3186917',
  storeName: 'Перекрёсток · Москва, Большой Овчинниковский пер. 16 · Яндекс Еда',
  locationLabel: 'Российская Федерация, Москва, Большой Овчинниковский переулок, 16',
  sourceUrl: 'https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w',
  salesChannel: 'yandex-eda-delivery',
  physicalStoreId: null,
  evidenceObservedAt: '2026-10-31T18:17:04.801Z'
});

export const PEREKRESTOK_REVIEWED_LIST_PACKS = Object.freeze([
  ['22f84859-1ad2-481f-9250-c24580363f8c', 'perekrestok-3186917-petelinka-mince-450g',
    'Фарш Петелинка Премиум из филе грудки охлажденный', '450 г'],
  ['5c6afaf4-d14f-4cf3-9770-73eaa24da3b8', 'perekrestok-3186917-maltagliati-pennoni-450g',
    'Макароны Maltagliati Рифленые перья (Pennoni Rigati) 074', '450 г'],
  ['fb3574cb-eba6-47a1-9932-30da895354fb', 'perekrestok-3186917-yasno-solnyshko-no2-500g',
    'Хлопья овсяные Ясно Солнышко средний размер No 2', '500 г'],
  ['22e71f23-4a19-438a-855b-2dcfc480e4ae', 'perekrestok-3186917-prostokvashino-34-45-930ml',
    'Молоко Простоквашино отборное 3.4 - 4.5%', '930 мл']
].map(([sourceProductId, id, name, unit]) => Object.freeze({
  sourceProductId, sourceName: name + ' ' + unit,
  identity: Object.freeze({ id, name, unit, category: 'Продукты · доставка Перекрёстка' })
})));

const nameKey = value => typeof value === 'string'
  ? value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU')
    .replace(/(\d)[.,](\d)/gu, '$1,$2').replace(/\s+/gu, ' ')
  : null;
const unitKey = value => typeof value === 'string'
  ? value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/gu, '') : null;
const contextUrl = value => {
  try { return new URL(value).href === PEREKRESTOK_REVIEWED_LIST_CONTEXT.sourceUrl; }
  catch { return false; }
};

export function getReviewedPerekrestokListIdentity(id) {
  return PEREKRESTOK_REVIEWED_LIST_PACKS.find(p => p.identity.id === id)?.identity ?? null;
}

export function matchesReviewedPerekrestokListIdentity(product) {
  if (!product || typeof product !== 'object') return false;
  const identity = getReviewedPerekrestokListIdentity(product.id);
  return !!identity && nameKey(product.name) === nameKey(identity.name)
    && unitKey(product.unit) === unitKey(identity.unit);
}

export function getReviewedPerekrestokListProduct(product) {
  const context = PEREKRESTOK_REVIEWED_LIST_CONTEXT;
  if (!product || product.retailerId !== context.retailerId) return null;
  const pack = PEREKRESTOK_REVIEWED_LIST_PACKS.find(p => p.sourceProductId === product.sourceProductId);
  if (!pack || nameKey(product.name) !== nameKey(pack.sourceName)
      || (product.unit != null && unitKey(product.unit) !== unitKey(pack.identity.unit))
      || !contextUrl(product.productUrl)) return null;

  // The normalizer first supplies only pack fields; the final card also carries
  // its retained context. Reject contradictory context whenever supplied.
  for (const [field, expected] of Object.entries({
    id: `retail:${context.retailerId}:${context.storeId}:${pack.sourceProductId}`,
    storeId: context.storeId, storeName: context.storeName, bindingId: context.bindingId,
    salesChannel: context.salesChannel, scopeBinding: 'same-source'
  })) if (Object.hasOwn(product, field) && product[field] !== expected) return null;
  if (Object.hasOwn(product, 'sourceUrl') && !contextUrl(product.sourceUrl)) return null;
  if (Object.hasOwn(product, 'priceCondition')
      && !['yandex-eda-regular', 'yandex-eda-promo'].includes(product.priceCondition)) return null;
  return pack.identity;
}
