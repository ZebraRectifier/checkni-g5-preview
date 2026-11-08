import { validPyatSnapshot, PYAT_PUBLISHED_URL } from '../observations/pyaterochkaPublishedPromotions.mjs';

// Manual list identities reviewed against the published 03–09 Nov campaign.
// Evidence: tests/fixtures/pyaterochka-public/reviewed-packs-20261107.json.
// These are city-promotion packages, never canonical or physical-store offers.
const campaign = Object.freeze({ from: '2026-11-03', until: '2026-11-09' });
const packs = Object.freeze([
  {
    "id": "52536073",
    "name": "Гречка ядрица Селяночка быстроразваривающаяся пропаренная 900г",
    "unit": "900 г",
    "category": "makarony-krupy-muka"
  },
  {
    "id": "52536247",
    "name": "Гречка Мистраль 900г",
    "unit": "900 г",
    "category": "makarony-krupy-muka"
  },
  {
    "id": "52536205",
    "name": "Рис Селяночка круглозерный шлифованный 900г",
    "unit": "900 г",
    "category": "makarony-krupy-muka"
  },
  {
    "id": "52536117",
    "name": "Рис Селяночка длиннозерный шлифованный 900г",
    "unit": "900 г",
    "category": "makarony-krupy-muka"
  },
  {
    "id": "52535998",
    "name": "Пельмени Рестория Классические 800г",
    "unit": "800 г",
    "category": "zamorozhennye-produkty"
  },
  {
    "id": "52535976",
    "name": "Вареники Рестория с вишней 450г",
    "unit": "450 г",
    "category": "zamorozhennye-produkty"
  },
  {
    "id": "52535974",
    "name": "Фасоль Global Village красная в собственном соку 400г",
    "unit": "400 г",
    "category": "konservaciya"
  },
  {
    "id": "52536018",
    "name": "Горошек Global Village зеленый из мозговых сортов 400г",
    "unit": "400 г",
    "category": "konservaciya"
  },
  {
    "id": "52536111",
    "name": "Майонез Я Люблю Готовить Московский Провансаль классический 67% 200мл",
    "unit": "200 мл",
    "category": "masla-sousy-specii"
  },
  {
    "id": "52536213",
    "name": "Приправа для картофеля Рестория 15г",
    "unit": "15 г",
    "category": "masla-sousy-specii"
  },
  {
    "id": "52536236",
    "name": "Какао-порошок Золотой Ярлык 100г",
    "unit": "100 г",
    "category": "chaj-kofe-kakao"
  },
  {
    "id": "52536262",
    "name": "Сок Ideas томатный прямого отжима 1л",
    "unit": "1 л",
    "category": "voda-soki-napitki"
  }
].map(Object.freeze));
const admittedCards = new WeakMap();
const storeId = 'pyaterochka-moscow-proshoper';
const productUrl = id => `${PYAT_PUBLISHED_URL}#id_product_${id}`;
const current = (card, nowMs) => {
  const observed = Date.parse(card?.observedAt);
  const from = Date.parse(card?.validFrom + 'T00:00:00+03:00');
  const until = Date.parse(card?.validUntil + 'T00:00:00+03:00') + 86_400_000;
  return Number.isFinite(nowMs) && Number.isFinite(observed) && observed <= nowMs
    && nowMs - observed <= 86_400_000 && nowMs >= from && nowMs < until;
};

/** Called by the ordinary published adapter after its snapshot/source checks. */
export function admitPublishedPromotionListCard(card, { snapshot, product, nowMs = Date.now() } = {}) {
  if (!validPyatSnapshot(snapshot) || !snapshot.products.includes(product)) return null;
  const pack = packs.find(p => p.id === product.sourceProductId);
  if (!pack || product.name !== pack.name || product.category !== pack.category
      || snapshot.cataloguePeriod?.from !== campaign.from || snapshot.cataloguePeriod?.until !== campaign.until
      || product.validFrom !== campaign.from || product.validUntil !== campaign.until
      || snapshot.observedAt !== product.observedAt || snapshot.physicalStoreId !== null
      || snapshot.physicalStoreAddress !== null || snapshot.selectedCity !== 'Москва'
      || product.productUrl !== productUrl(pack.id) || product.priceCondition !== 'promotion-conditions-unconfirmed'
      || product.availability !== 'unknown' || !card
      || card.id !== `retail:pyaterochka:${storeId}:${pack.id}` || card.sourceProductId !== pack.id
      || card.retailerId !== 'pyaterochka' || card.storeId !== storeId || card.publisher !== 'proshoper'
      || card.retailerDisplayName !== 'Пятёрочка' || card.storeName !== 'Пятёрочка · акции Москвы'
      || card.name !== pack.name || !['Фасовка — у источника', pack.unit].includes(card.unit)
      || card.priceScope !== 'city-promotion' || card.physicalStoreId !== null || card.physicalStoreAddress !== null
      || card.localityId !== 'city-moscow-promo' || card.localityName !== 'Москва'
      || card.sourceUrl !== product.productUrl || card.productUrl !== product.productUrl
      || card.catalogSourceUrl !== PYAT_PUBLISHED_URL || card.catalogSource !== 'pyaterochka'
      || card.catalogDisplayOnly !== true || card.comparisonEligible !== false
      || card.currency !== 'RUB' || card.availability !== 'unknown' || card.priceCondition !== product.priceCondition
      || card.priceConditionLabel !== 'Акция Москвы · Прошопер · условия карты неизвестны'
      || !Number.isSafeInteger(card.priceMinor) || card.priceMinor <= 0 || card.priceMinor !== product.priceMinor
      || card.observedAt !== product.observedAt || card.validFrom !== product.validFrom || card.validUntil !== product.validUntil
      || !current(card, nowMs)) return null;
  const admitted = Object.freeze({ ...card, unit: pack.unit, sourceListOnly: true, basketProductId: card.id,
    campaign: Object.freeze({ ...campaign }) });
  admittedCards.set(admitted, Object.freeze({ id: admitted.id, name: admitted.name, unit: pack.unit,
    category: card.category }));
  return admitted;
}

/** Storage, object clones and ID-only lookups do not restore catalogue authority. */
export function publishedPromotionListSelection(card, { nowMs = Date.now() } = {}) {
  const product = card && admittedCards.get(card);
  return product && current(card, nowMs) ? { card, product } : null;
}
