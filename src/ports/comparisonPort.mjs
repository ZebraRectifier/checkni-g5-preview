import { compareBasket } from "../core/basket-core.mjs";
import { compareObservedBasket } from "../core/observed-price-core.mjs";
import { mockStores } from "../core/mock-scenario.mjs";
import {
  createCoreComparisonAdapter,
  reshapeSurfaceBasket
} from "../adapters/coreComparisonAdapter.mjs";
import { observedOffersPort } from "./observedOffersPort.mjs";
import { selectStoreScopedOffers } from "../observations/selectedStoreScope.mjs";
import { matchesReviewedRetailBasketIdentity } from "../catalog/reviewedRetailBasket.mjs";

export const COMPARISON_MODE = Object.freeze({
  DEMO: "demo",
  OBSERVED: "observed"
});

export function resolveComparisonMode(search = "", {
  defaultMode = COMPARISON_MODE.DEMO
} = {}) {
  const raw = new URLSearchParams(typeof search === "string" ? search : "")
    .get("comparison");

  if (raw === COMPARISON_MODE.OBSERVED) return COMPARISON_MODE.OBSERVED;
  if (raw === COMPARISON_MODE.DEMO) return COMPARISON_MODE.DEMO;

  return defaultMode === COMPARISON_MODE.OBSERVED
    ? COMPARISON_MODE.OBSERVED
    : COMPARISON_MODE.DEMO;
}

export function resolveRuntimeComparisonMode({
  search = "",
  hostname = ""
} = {}) {
  const normalizedHost = typeof hostname === "string"
    ? hostname.trim().toLowerCase()
    : "";
  const isPublicBetaHost = (
    normalizedHost === "checkni.vercel.app"
    || normalizedHost.endsWith(".vercel.app")
    || normalizedHost === "zebrarectifier.github.io"
  );

  return resolveComparisonMode(search, {
    defaultMode: isPublicBetaHost
      ? COMPARISON_MODE.OBSERVED
      : COMPARISON_MODE.DEMO
  });
}

/**
 * SURFACE integration seam for one deterministic comparison implementation.
 *
 * The injected compare function owns all commercial truth. This port only
 * exposes availability and forwards the SURFACE basket to that function.
 */
export function createComparisonPort(coreCompare, { mode = COMPARISON_MODE.DEMO } = {}) {
  return Object.freeze({
    mode,
    isAvailable: typeof coreCompare === "function",

    async compare(surfaceBasket) {
      if (typeof coreCompare !== "function") {
        throw new Error("CHECKNI Core comparison is not connected.");
      }

      return coreCompare(surfaceBasket);
    }
  });
}

export function createObservedComparisonPort(
  coreCompare,
  loadObservedOffers,
  { mode = COMPARISON_MODE.OBSERVED, getStoreScope = null } = {}
) {
  return Object.freeze({
    mode,
    isAvailable: (
      typeof coreCompare === "function"
      && typeof loadObservedOffers === "function"
    ),

    async compare(surfaceBasket) {
      if (
        typeof coreCompare !== "function"
        || typeof loadObservedOffers !== "function"
      ) {
        throw new Error("CHECKNI observed comparison is not connected.");
      }

      const basket = reshapeSurfaceBasket(surfaceBasket);
      const storeScope = typeof getStoreScope === "function" ? getStoreScope() : null;
      if (getStoreScope && storeScope?.valid !== true) return coreCompare({ basket, offers: [] });
      const offers = await loadObservedOffers(basket);

      if (!Array.isArray(offers)) {
        throw new TypeError("observed offers port must return an array");
      }

      if (getStoreScope && getStoreScope()?.key !== storeScope.key) {
        throw new Error("Selected comparison addresses changed.");
      }
      return coreCompare({ basket, offers: getStoreScope ? selectStoreScopedOffers(offers, storeScope) : offers });
    }
  });
}

const coreComparisonAdapter = createCoreComparisonAdapter(compareBasket, mockStores);

export const demoComparisonPort = createComparisonPort(coreComparisonAdapter, {
  mode: COMPARISON_MODE.DEMO
});

export const observedComparisonPort = createObservedComparisonPort(
  compareObservedBasket,
  (coreBasket) => observedOffersPort.load(coreBasket)
);

export function createSelectedAddressComparisonPort(getStoreScope, options = {}) {
  if (typeof getStoreScope !== "function") throw new TypeError("selected comparison requires a store scope");
  const load = options.loadObservedOffers ?? (coreBasket => observedOffersPort.load(coreBasket));
  return createObservedComparisonPort(compareObservedBasket, async coreBasket => {
    const offers = await load(coreBasket);
    if (!Array.isArray(offers)) return offers; // The base port rejects malformed results.
    return offers.filter(offer => !["metro-public-live", "magnit-public-live"].includes(offer?.sourceId)
      || matchesReviewedRetailBasketIdentity(coreBasket.find(row => row.product.id === offer.canonicalProductId)?.product));
  }, { getStoreScope });
}

export function selectComparisonPort(mode, {
  demoPort = demoComparisonPort,
  observedPort = observedComparisonPort
} = {}) {
  return mode === COMPARISON_MODE.OBSERVED ? observedPort : demoPort;
}

const runtimeMode = resolveRuntimeComparisonMode({
  search: typeof globalThis.location?.search === "string"
    ? globalThis.location.search
    : "",
  hostname: typeof globalThis.location?.hostname === "string"
    ? globalThis.location.hostname
    : ""
});

export const comparisonPort = selectComparisonPort(runtimeMode);

