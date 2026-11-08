const COMPACT_SCOPE_LABELS = Object.freeze({
  okey: 'Акции Москвы',
  pyaterochka: 'Акции Москвы',
  globus: 'Каталог магазина',
  magnit: 'Каталог по адресу',
  metro: 'Каталог по адресу',
  vkusvill: 'Онлайн-каталог',
  lenta: 'Онлайн-каталог',
  perekrestok: 'Доставка · Москва',
  da: 'Акции',
  auchan: 'Акции'
});

export function compactRetailScope(retailerId, scopeLabel = '') {
  if (COMPACT_SCOPE_LABELS[retailerId]) return COMPACT_SCOPE_LABELS[retailerId];
  return typeof scopeLabel === 'string' ? scopeLabel : '';
}

export function compactCatalogAbsence(retailerId, state) {
  if (retailerId !== 'okey') return null;
  if (state === 'error') {
    return Object.freeze({ title: 'Каталог сейчас недоступен', status: 'Каталог сейчас недоступен' });
  }
  if (state === 'empty') {
    return Object.freeze({ title: 'Свежих акций пока нет', status: 'Свежих акций пока нет' });
  }
  return null;
}
