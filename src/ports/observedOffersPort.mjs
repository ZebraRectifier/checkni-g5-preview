import {
  OBSERVATION_GRANULARITY,
  OBSERVED_AVAILABILITY,
  PUBLIC_PAGE_OBSERVATION_KIND,
  validatePublicPageObservation
} from "../adapters/publicPageObservationAdapter.mjs";
import { getRetailerIdentity } from "../data/retailerRegistry.mjs";
import {
  MATCH_METHOD,
  MATCH_STATUS,
  createProductMatch
} from "../matching/productMatch.mjs";
import {
  createObservedOffer
} from "../observations/observedOffer.mjs";
import { getSensorSource } from "../sensors/sourceRegistry.mjs";
import {
  loadLocalUserEvidence
} from "../observations/localUserEvidenceStore.mjs";
import {
  loadYandexProductMappings
} from "../observations/localYandexProductMappingStore.mjs";
import {
  loadCachedYandexPrices,
  saveCachedYandexPrices
} from "../observations/localYandexPriceCacheStore.mjs";
import {
  requestYandexPublicPrices
} from "./yandexPublicPricesPort.mjs";
import {
  requestBetaRetailPrices
} from "./betaRetailPricesPort.mjs";
import { BETA_LIVE_PROFILE_PRODUCT_IDS } from "../data/betaRealBasket.mjs";

export const LOCAL_OBSERVED_PRICE_MAX_AGE_MS = 60 * 60 * 1000;
export const YANDEX_OBSERVED_PRICE_MAX_AGE_MS = 15 * 60 * 1000;
export const YANDEX_PRODUCT_MAPPING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_YANDEX_ORGANIZATIONS_PER_COMPARISON = 3;
export const YANDEX_PUBLIC_SOURCE_ID = "yandex-business-public";
export const YANDEX_PUBLIC_SOURCE_NAME =
  "Яндекс Карты · публичные прайс-листы";
export const BETA_RETAIL_PRICE_MAX_AGE_MS = 5 * 60 * 1000;
export const PEREKRESTOK_BETA_RETAIL_PRICE_MAX_AGE_MS =
  7 * 60 * 60 * 1000;
const PEREKRESTOK_BETA_SOURCE_ID = "perekrestok-yandex-eda-live";

function isCoreBasketItem(item) {
  return Boolean(
    item
    && typeof item === "object"
    && item.product
    && typeof item.product.id === "string"
  );
}

function requireCoreBasket(coreBasket) {
  if (!Array.isArray(coreBasket) || !coreBasket.every(isCoreBasketItem)) {
    throw new TypeError("observed offers require a Core basket");
  }
}

function sortOffers(offers) {
  return offers.slice().sort((left, right) => (
    String(left.locationId).localeCompare(String(right.locationId), "en")
    || left.canonicalProductId.localeCompare(right.canonicalProductId, "en")
    || right.observedAt.localeCompare(left.observedAt, "en")
    || String(left.sourceProductId ?? "").localeCompare(
      String(right.sourceProductId ?? ""),
      "en"
    )
  ));
}

export async function loadLocalObservedOffers(coreBasket, options = {}) {
  requireCoreBasket(coreBasket);

  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs =
    options.maxAgeMs ?? LOCAL_OBSERVED_PRICE_MAX_AGE_MS;
  const wantedIds = new Set(
    coreBasket.map((item) => item.product.id)
  );

  const entries = loadLocalUserEvidence({
    storage: options.storage,
    storageKey: options.storageKey,
    nowMs,
    retentionMs: options.retentionMs
  });

  const offers = [];

  for (const entry of entries) {
    if (!wantedIds.has(entry.match.canonicalProductId)) continue;

    const materialized = createObservedOffer({
      observation: entry.observation,
      match: entry.match,
      nowMs,
      maxAgeMs
    });

    if (materialized.kind === "accepted") {
      offers.push(materialized.offer);
    }
  }

  return sortOffers(offers);
}

function yandexOrganizationUrl(organizationId) {
  return `https://yandex.com/maps/org/${organizationId}/`;
}

const YANDEX_PUBLIC_SOURCE = Object.freeze({
  id: YANDEX_PUBLIC_SOURCE_ID,
  name: YANDEX_PUBLIC_SOURCE_NAME,
  publicUrl: "https://yandex.com/maps/",
  origin: "https://yandex.com",
  capabilities: Object.freeze({
    automatedObservation: true,
    historicalPriceRead: false,
    exactStoreContext: false,
    stockObservation: false
  }),
  license: null
});

function observedSourceResolver(sourceId) {
  if (sourceId === YANDEX_PUBLIC_SOURCE_ID) return YANDEX_PUBLIC_SOURCE;
  return getSensorSource(sourceId);
}

function normalizedIdentityText(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU").replaceAll("ё", "е")
    : null;
}

function sameMappedSourceProduct(mapping, product) {
  return (
    mapping.sourceProductId === product?.sourceProductId
    && normalizedIdentityText(mapping.sourceProductName)
      === normalizedIdentityText(product?.name)
  );
}

function yandexObservationContext(mapping) {
  const retailer = getRetailerIdentity(mapping.context.retailerId);
  if (!retailer) return null;

  return Object.freeze({
    countryCode: mapping.context.countryCode,
    regionId: mapping.context.regionId,
    regionName: mapping.context.regionName,
    localityId: mapping.context.localityId,
    localityName: mapping.context.localityName,
    retailerId: retailer.id,
    locationId:
      `yandex-retailer:${retailer.id}:city:${mapping.context.localityId}`,
    locationLabel: `${retailer.name} · ${mapping.context.localityName}`
  });
}

function yandexOfferFrom({
  mapping,
  product,
  sourceUrl,
  observedAt,
  nowMs,
  maxAgeMs
}) {
  const context = yandexObservationContext(mapping);
  if (!context || !sameMappedSourceProduct(mapping, product)) return null;

  const validated = validatePublicPageObservation({
    kind: PUBLIC_PAGE_OBSERVATION_KIND,
    sourceId: YANDEX_PUBLIC_SOURCE_ID,
    sourceUrl,
    observedAt,
    product: {
      sourceProductId: product.sourceProductId,
      name: product.name
    },
    priceMinor: product.priceMinor,
    currency: "RUB",
    minimumQuantity: null,
    granularity: OBSERVATION_GRANULARITY.CITY,
    context,
    availability: OBSERVED_AVAILABILITY.UNKNOWN
  }, {
    sourceResolver: observedSourceResolver
  });

  if (validated.kind !== "accepted") return null;

  const matched = createProductMatch({
    sourceId: YANDEX_PUBLIC_SOURCE_ID,
    sourceProductId: product.sourceProductId,
    sourceProductName: product.name,
    canonicalProductId: mapping.canonicalProductId,
    method: MATCH_METHOD.USER_CONFIRMED,
    status: MATCH_STATUS.CONFIRMED,
    confidence: 1
  }, {
    sourceResolver: observedSourceResolver
  });

  if (matched.kind !== "accepted") return null;

  const materialized = createObservedOffer({
    observation: validated.observation,
    match: matched.match,
    nowMs,
    maxAgeMs,
    sourceResolver: observedSourceResolver
  });

  return materialized.kind === "accepted"
    ? materialized.offer
    : null;
}

function yandexOrganizationContextKey(mapping) {
  const context = mapping?.context;
  if (!context) return null;
  return JSON.stringify([
    context.countryCode,
    context.regionId,
    context.regionName,
    context.localityId,
    context.localityName,
    context.retailerId
  ]);
}

function coherentYandexOrganizationMappings(mappings) {
  const contextsByOrganization = new Map();

  for (const mapping of mappings) {
    const contextKey = yandexOrganizationContextKey(mapping);
    if (!contextKey) continue;
    const contexts = contextsByOrganization.get(mapping.organizationId) ?? new Set();
    contexts.add(contextKey);
    contextsByOrganization.set(mapping.organizationId, contexts);
  }

  return mappings.filter((mapping) => (
    contextsByOrganization.get(mapping.organizationId)?.size === 1
  ));
}

function yandexOrganizationIdFromSourceUrl(sourceUrl) {
  if (typeof sourceUrl !== "string") return null;

  try {
    const url = new URL(sourceUrl);
    if (url.origin !== "https://yandex.com") return null;
    const match = /^\/maps\/org\/(?:(?:[^/]+)\/)?(\d+)\/menu\/$/.exec(
      url.pathname
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function newestYandexOffer(left, right) {
  const byTime = right.observedAt.localeCompare(left.observedAt, "en");
  if (byTime > 0) return right;
  if (byTime < 0) return left;

  return String(right.sourceUrl ?? "").localeCompare(
    String(left.sourceUrl ?? ""),
    "en"
  ) < 0 ? right : left;
}

function coherentOrganizationOffers(offers) {
  const byProduct = new Map();

  for (const offer of offers) {
    const current = byProduct.get(offer.canonicalProductId);
    if (!current) {
      byProduct.set(offer.canonicalProductId, {
        kind: "offer",
        offer
      });
      continue;
    }

    if (current.kind === "conflict") continue;
    if (current.offer.unitPriceMinor !== offer.unitPriceMinor) {
      byProduct.set(offer.canonicalProductId, {
        kind: "conflict"
      });
      continue;
    }

    current.offer = newestYandexOffer(current.offer, offer);
  }

  const coherent = new Map();
  for (const [productId, entry] of byProduct) {
    if (entry.kind === "offer") coherent.set(productId, entry.offer);
  }
  return coherent;
}

export function collapseYandexRetailerCityOffers(offers) {
  if (!Array.isArray(offers)) {
    throw new TypeError("Yandex offers must be an array");
  }

  const byRetailerCity = new Map();

  for (const offer of offers) {
    const organizationId = yandexOrganizationIdFromSourceUrl(
      offer.sourceUrl
    );
    if (!organizationId || !offer.locationId) continue;

    const cityGroup = byRetailerCity.get(offer.locationId) ?? new Map();
    const organizationOffers = cityGroup.get(organizationId) ?? [];
    organizationOffers.push(offer);
    cityGroup.set(organizationId, organizationOffers);
    byRetailerCity.set(offer.locationId, cityGroup);
  }

  const collapsed = [];

  for (const organizationGroups of byRetailerCity.values()) {
    const candidates = Array.from(organizationGroups.entries())
      .map(([organizationId, organizationOffers]) => ({
        organizationId,
        offersByProduct: coherentOrganizationOffers(organizationOffers)
      }))
      .filter((candidate) => candidate.offersByProduct.size > 0);

    if (candidates.length === 0) continue;

    // A price that differs between public branch cards cannot be promoted to
    // retailer+city truth because the source does not expose whether either
    // row is a branch override. Remove that product from every branch scope.
    const allProductIds = new Set(
      candidates.flatMap((candidate) => (
        Array.from(candidate.offersByProduct.keys())
      ))
    );

    for (const productId of allProductIds) {
      const prices = new Set(
        candidates
          .map((candidate) => candidate.offersByProduct.get(productId))
          .filter(Boolean)
          .map((offer) => offer.unitPriceMinor)
      );
      if (prices.size <= 1) continue;
      for (const candidate of candidates) {
        candidate.offersByProduct.delete(productId);
      }
    }

    const remaining = candidates.filter(
      (candidate) => candidate.offersByProduct.size > 0
    );
    if (remaining.length === 0) continue;

    const maxCoverage = Math.max(
      ...remaining.map((candidate) => candidate.offersByProduct.size)
    );
    const top = remaining.filter(
      (candidate) => candidate.offersByProduct.size === maxCoverage
    );

    const signatures = new Set(
      top.map((candidate) => JSON.stringify(
        Array.from(candidate.offersByProduct.entries())
          .sort(([left], [right]) => left.localeCompare(right, "en"))
          .map(([productId, offer]) => [productId, offer.unitPriceMinor])
      ))
    );

    // Equal-size but different product sets cannot be stitched into one
    // synthetic retailer-city basket. Wait for one coherent card scope.
    if (signatures.size !== 1) continue;

    const selected = top
      .slice()
      .sort((left, right) => {
        const leftNewest = Array.from(left.offersByProduct.values())
          .map((offer) => offer.observedAt)
          .sort()
          .at(-1) ?? "";
        const rightNewest = Array.from(right.offersByProduct.values())
          .map((offer) => offer.observedAt)
          .sort()
          .at(-1) ?? "";
        return (
          rightNewest.localeCompare(leftNewest, "en")
          || left.organizationId.localeCompare(right.organizationId, "en")
        );
      })[0];

    collapsed.push(
      ...Array.from(selected.offersByProduct.values())
    );
  }

  return sortOffers(collapsed);
}

function isCurrentObservedAt(observedAt, nowMs, maxAgeMs) {
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) return false;
  if (observedAtMs > nowMs + 60_000) return false;
  return nowMs - observedAtMs <= maxAgeMs;
}

function uniqueYandexProductsBySourceId(products) {
  if (!Array.isArray(products)) return new Map();

  const unique = new Map();
  const conflicted = new Set();

  for (const product of products) {
    const sourceProductId = product?.sourceProductId;
    if (typeof sourceProductId !== "string" || conflicted.has(sourceProductId)) {
      continue;
    }

    const existing = unique.get(sourceProductId);
    if (!existing) {
      unique.set(sourceProductId, product);
      continue;
    }

    if (
      existing.name !== product.name
      || existing.priceMinor !== product.priceMinor
      || existing.currency !== product.currency
    ) {
      unique.delete(sourceProductId);
      conflicted.add(sourceProductId);
    }
  }

  return unique;
}

export async function loadMappedYandexObservedOffers(
  coreBasket,
  options = {}
) {
  requireCoreBasket(coreBasket);

  const storage = options.storage;
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs =
    options.maxAgeMs ?? YANDEX_OBSERVED_PRICE_MAX_AGE_MS;
  const maxMappingAgeMs =
    options.maxMappingAgeMs ?? YANDEX_PRODUCT_MAPPING_MAX_AGE_MS;
  const maxOrganizations =
    options.maxOrganizations ?? MAX_YANDEX_ORGANIZATIONS_PER_COMPARISON;
  const requestPrices =
    options.requestPrices ?? requestYandexPublicPrices;

  if (
    !Number.isSafeInteger(maxOrganizations)
    || maxOrganizations < 0
  ) {
    throw new TypeError("Yandex organization fan-out limit is invalid");
  }
  if (!Number.isFinite(maxMappingAgeMs) || maxMappingAgeMs < 0) {
    throw new TypeError("Yandex mapping max age is invalid");
  }
  if (typeof requestPrices !== "function") {
    throw new TypeError("Yandex price requester must be a function");
  }

  const wantedIds = new Set(
    coreBasket.map((item) => item.product.id)
  );
  const mappings = loadYandexProductMappings({
    storage,
    storageKey: options.mappingStorageKey
  }).filter((mapping) => {
    if (!wantedIds.has(mapping.canonicalProductId)) return false;

    const mappedAtMs = Date.parse(mapping.mappedAt);
    return (
      Number.isFinite(mappedAtMs)
      && mappedAtMs <= nowMs + 60_000
      && nowMs - mappedAtMs <= maxMappingAgeMs
    );
  });

  if (mappings.length === 0 || maxOrganizations === 0) return [];

  const coherentMappings = coherentYandexOrganizationMappings(mappings);
  if (coherentMappings.length === 0) return [];

  const organizationIds = Array.from(
    new Set(coherentMappings.map((mapping) => mapping.organizationId))
  )
    .sort((a, b) => a.localeCompare(b, "en"))
    .slice(0, maxOrganizations);

  const allowedOrganizations = new Set(organizationIds);
  const scopedMappings = coherentMappings.filter((mapping) => (
    allowedOrganizations.has(mapping.organizationId)
  ));

  const responses = await Promise.all(
    organizationIds.map(async (organizationId) => {
      const cached = loadCachedYandexPrices(
        organizationId,
        {
          storage,
          storageKey: options.priceCacheStorageKey,
          nowMs,
          maxAgeMs
        }
      );
      if (cached) return cached;

      try {
        const response = await requestPrices(
          yandexOrganizationUrl(organizationId)
        );

        if (
          (
            response?.kind === "prices"
            || response?.kind === "empty"
          )
          && response.organizationId === organizationId
        ) {
          saveCachedYandexPrices(response, {
            storage,
            storageKey: options.priceCacheStorageKey,
            nowMs,
            maxAgeMs
          });
        }

        return response;
      } catch {
        return Object.freeze({
          kind: "unavailable",
          code: "transport_unavailable"
        });
      }
    })
  );

  const offers = [];

  for (let index = 0; index < organizationIds.length; index += 1) {
    const organizationId = organizationIds[index];
    const response = responses[index];

    if (
      !response
      || response.kind !== "prices"
      || response.organizationId !== organizationId
      || !isCurrentObservedAt(response.observedAt, nowMs, maxAgeMs)
    ) {
      continue;
    }

    const productMap = uniqueYandexProductsBySourceId(
      response.products
    );

    for (const mapping of scopedMappings) {
      if (mapping.organizationId !== organizationId) continue;
      const product = productMap.get(mapping.sourceProductId);
      if (!product) continue;

      const offer = yandexOfferFrom({
        mapping,
        product,
        sourceUrl: response.sourceUrl,
        observedAt: response.observedAt,
        nowMs,
        maxAgeMs
      });
      if (offer) offers.push(offer);
    }
  }

  return collapseYandexRetailerCityOffers(offers);
}

export async function loadBetaRetailObservedOffers(coreBasket, options = {}) {
  requireCoreBasket(coreBasket);

  const wantedIds = new Set(coreBasket.map((item) => item.product.id));
  const profiles = Object.entries(BETA_LIVE_PROFILE_PRODUCT_IDS)
    .filter(([, ids]) => ids.some((id) => wantedIds.has(id)))
    .map(([profileId]) => profileId);
  if (profiles.length === 0) return [];

  const requestPrices =
    options.requestBetaRetailPrices ?? requestBetaRetailPrices;
  if (typeof requestPrices !== "function") {
    throw new TypeError("beta retail price requester must be a function");
  }

  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs =
    options.betaRetailMaxAgeMs ?? BETA_RETAIL_PRICE_MAX_AGE_MS;
  const perekrestokMaxAgeMs =
    options.perekrestokBetaRetailMaxAgeMs
    ?? PEREKRESTOK_BETA_RETAIL_PRICE_MAX_AGE_MS;

  const responses = await Promise.all(profiles.map(async (profileId) => {
    try {
      return await requestPrices(profileId);
    } catch {
      return null;
    }
  }));

  const offers = [];
  for (const response of responses) {
    if (
      !response
      || !["prices", "insufficient"].includes(response.kind)
      || !Array.isArray(response.offers)
    ) {
      continue;
    }
    offers.push(...response.offers.filter((offer) => {
      const offerMaxAgeMs = offer.sourceId === PEREKRESTOK_BETA_SOURCE_ID
        ? perekrestokMaxAgeMs
        : maxAgeMs;
      return (
        wantedIds.has(offer.canonicalProductId)
        && isCurrentObservedAt(offer.observedAt, nowMs, offerMaxAgeMs)
      );
    }));
  }

  return sortOffers(offers);
}

export async function loadObservedOffers(coreBasket, options = {}) {
  requireCoreBasket(coreBasket);

  const local = await loadLocalObservedOffers(coreBasket, options);

  let betaRetail = [];
  try {
    betaRetail = await loadBetaRetailObservedOffers(coreBasket, options);
  } catch {
    betaRetail = [];
  }

  let yandex = [];
  try {
    yandex = await loadMappedYandexObservedOffers(coreBasket, options);
  } catch {
    // External sources must never break the manual observed-price path.
    yandex = [];
  }

  return sortOffers([...local, ...betaRetail, ...yandex]);
}

export function createObservedOffersPort(loadOffers) {
  if (typeof loadOffers !== "function") {
    throw new TypeError("observed offers port requires a loader");
  }

  return Object.freeze({
    async load(coreBasket) {
      const offers = await loadOffers(coreBasket);
      if (!Array.isArray(offers)) {
        throw new TypeError("observed offers loader must return an array");
      }
      return offers;
    }
  });
}

// Beta default: merge contract-validated local confirmations with fresh Yandex
// public-page prices only after an explicit user product mapping exists.
// External source failures fail closed and never disable the manual flow.
// MOCK is never mixed into observed mode.
export const observedOffersPort = createObservedOffersPort(
  (coreBasket) => loadObservedOffers(coreBasket)
);
