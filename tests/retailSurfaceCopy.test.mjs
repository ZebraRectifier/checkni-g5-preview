import test from 'node:test';
import assert from 'node:assert/strict';
import { compactCatalogAbsence, compactRetailScope } from '../src/presentation/retailSurfaceCopy.mjs';

test('every active network keeps the initial card and header scope compact', () => {
  const full = 'Акции Москвы · цена конкретного магазина и наличие не подтверждены';
  const expected = {
    okey: 'Акции Москвы', pyaterochka: 'Акции Москвы', globus: 'Каталог магазина',
    magnit: 'Каталог по адресу', metro: 'Каталог по адресу', vkusvill: 'Онлайн-каталог',
    lenta: 'Онлайн-каталог', perekrestok: 'Доставка · Москва', da: 'Акции', auchan: 'Акции'
  };
  for (const [retailerId, label] of Object.entries(expected)) {
    assert.equal(compactRetailScope(retailerId, full), label, retailerId);
  }
  assert.equal(compactRetailScope('future-network', full), full);
});

test('Okey empty and error catalogue states are one short line', () => {
  assert.deepEqual(compactCatalogAbsence('okey', 'error'), {
    title: 'Каталог сейчас недоступен', status: 'Каталог сейчас недоступен'
  });
  assert.deepEqual(compactCatalogAbsence('okey', 'empty'), {
    title: 'Свежих акций пока нет', status: 'Свежих акций пока нет'
  });
  assert.equal(compactCatalogAbsence('magnit', 'error'), null);
});
