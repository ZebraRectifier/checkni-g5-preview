import { getRetailerIdentity } from "../data/retailerRegistry.mjs";

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

export function getRetailerNavigation(retailerId) {
  if (typeof retailerId !== "string") return null;
  return NAVIGATION_BY_RETAILER.get(retailerId) ?? null;
}
