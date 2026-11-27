export const SOURCE_KIND = Object.freeze({
  AGGREGATOR: "aggregator",
  DISCOUNT_AGGREGATOR: "discount-aggregator",
  MARKETPLACE: "marketplace",
  DARKSTORE: "darkstore",
  RETAILER_DELIVERY: "retailer-delivery"
});

export const SOURCE_STATUS = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused"
});

const unsupportedLiveCapabilities = Object.freeze({
  basketPrefill: false,
  observedPriceImport: false,
  exactStorePrice: false,
  stockImport: false
});

function createSource({
  id,
  name,
  kind,
  url,
  status = SOURCE_STATUS.ACTIVE,
  externalNavigation = true
}) {
  return Object.freeze({
    id,
    name,
    kind,
    url,
    status,
    capabilities: Object.freeze({
      externalNavigation,
      ...unsupportedLiveCapabilities
    })
  });
}

export const COMMERCE_SOURCES = Object.freeze([
  createSource({
    id: "yandex-eda",
    name: "Яндекс Еда",
    kind: SOURCE_KIND.AGGREGATOR,
    url: "https://eda.yandex.ru/"
  }),
  createSource({
    id: "kuper",
    name: "Купер",
    kind: SOURCE_KIND.AGGREGATOR,
    url: "https://kuper.ru/"
  }),
  createSource({
    id: "edadeal",
    name: "Едадил",
    kind: SOURCE_KIND.DISCOUNT_AGGREGATOR,
    url: "https://edadeal.ru/"
  }),
  createSource({
    id: "broniboy",
    name: "Broniboy",
    kind: SOURCE_KIND.AGGREGATOR,
    url: "https://broniboy.ru/",
    status: SOURCE_STATUS.PAUSED,
    externalNavigation: false
  }),
  createSource({
    id: "ozon-fresh",
    name: "Ozon Fresh",
    kind: SOURCE_KIND.MARKETPLACE,
    url: "https://www.ozon.ru/category/supermarket-25000/?miniapp=supermarket"
  }),
  createSource({
    id: "samokat",
    name: "Самокат",
    kind: SOURCE_KIND.DARKSTORE,
    url: "https://samokat.ru/"
  }),
  createSource({
    id: "vprok",
    name: "Vprok.ru",
    kind: SOURCE_KIND.RETAILER_DELIVERY,
    url: "https://www.vprok.ru/"
  })
]);

export function getCommerceSource(sourceId) {
  return COMMERCE_SOURCES.find((source) => source.id === sourceId) ?? null;
}

export function getExternalCheckSources() {
  return COMMERCE_SOURCES.filter((source) => (
    source.status === SOURCE_STATUS.ACTIVE
    && source.capabilities.externalNavigation === true
  ));
}
