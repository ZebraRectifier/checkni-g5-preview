import { getRetailerIdentity } from "../data/retailerRegistry.mjs";
import { resolveGlobusMoscowRegionStore } from "../data/globusMoscowRegionStores.mjs";

export const RETAILER_NAVIGATION_KIND = Object.freeze({
  OFFICIAL_PUBLIC_URL: "official-public-url"
});

const FAIL_CLOSED_CAPABILITIES = Object.freeze({
  affiliate: false,
  basketPrefill: false,
  checkout: false,
  orderPlacement: false,
  stockTruth: false
});

const NAVIGATION_SEED = Object.freeze([
  Object.freeze({
    retailerId: "lenta",
    url: "https://lenta.com/",
    label: "Открыть Ленту",
    kind: RETAILER_NAVIGATION_KIND.OFFICIAL_PUBLIC_URL
  })
]);

function parseOfficialUrl(raw, retailer) {
  if (typeof raw !== "string") {
    throw new TypeError("retailer navigation URL is required");
  }

  let url;
  let identityUrl;
  try {
    url = new URL(raw);
    identityUrl = new URL(retailer.identitySourceUrl);
  } catch {
    throw new TypeError("retailer navigation URL must be valid");
  }

  if (url.protocol !== "https:") {
    throw new TypeError("retailer navigation URL must use https");
  }
  if (url.username || url.password) {
    throw new TypeError("retailer navigation URL must not contain credentials");
  }
  if (url.origin !== identityUrl.origin) {
    throw new TypeError("retailer navigation URL must use the verified retailer origin");
  }

  return url.href;
}

function defineNavigation(seed) {
  const retailer = getRetailerIdentity(seed?.retailerId);
  if (!retailer) {
    throw new TypeError("retailer navigation requires a known retailerId");
  }
  if (seed.kind !== RETAILER_NAVIGATION_KIND.OFFICIAL_PUBLIC_URL) {
    throw new TypeError("retailer navigation kind is unsupported");
  }

  return Object.freeze({
    retailerId: retailer.id,
    retailerName: retailer.name,
    kind: seed.kind,
    url: parseOfficialUrl(seed.url, retailer),
    label: typeof seed.label === "string" && seed.label.trim()
      ? seed.label.trim()
      : `Открыть ${retailer.name}`,
    capabilities: FAIL_CLOSED_CAPABILITIES
  });
}

export const RETAILER_NAVIGATIONS = Object.freeze(
  NAVIGATION_SEED.map(defineNavigation)
);

const NAVIGATION_BY_RETAILER = new Map(
  RETAILER_NAVIGATIONS.map((entry) => [entry.retailerId, entry])
);

function globusPhysicalStoreNavigation(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || candidate.retailerId !== "globus" || candidate.salesChannel !== "store"
      || candidate.granularity !== "exact-store" || candidate.locationTruthLevel !== "store"
      || typeof candidate.storeId !== "string") return null;

  const officialStoreId = /^globus-store-(\d+)$/u.exec(candidate.storeId)?.[1];
  const store = officialStoreId && resolveGlobusMoscowRegionStore(officialStoreId);
  if (!store || store.priceStatus !== "verified" || candidate.storeName !== store.name
      || candidate.locationLabel !== store.address
      || candidate.locationId !== `globus:${candidate.storeId}`) return null;

  // The destination comes only from the reviewed physical-store directory.
  // A caller's URL never becomes navigation, and online/PVZ contexts cannot
  // borrow this physical-store target or its address.
  let url;
  try { url = new URL(store.officialUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "www.globus.ru"
      || url.username || url.password || url.port || url.search || url.hash
      || url.pathname !== `/store/${store.officialStoreId}`
      || url.href !== store.officialUrl) return null;

  return Object.freeze({
    retailerId: "globus", retailerName: "Глобус",
    kind: RETAILER_NAVIGATION_KIND.OFFICIAL_PUBLIC_URL,
    url: store.officialUrl, label: `Открыть страницу «${store.name}»`,
    capabilities: FAIL_CLOSED_CAPABILITIES
  });
}

export function getRetailerNavigation(retailerId, candidate = null) {
  if (typeof retailerId !== "string") return null;
  if (retailerId === "globus") return globusPhysicalStoreNavigation(candidate);
  return NAVIGATION_BY_RETAILER.get(retailerId) ?? null;
}
