import { compareBasket } from "../core/basket-core.mjs";
import { compareObservedBasket } from "../core/observed-price-core.mjs";
import { mockStores } from "../core/mock-scenario.mjs";
import {
  createCoreComparisonAdapter,
  reshapeSurfaceBasket
} from "../adapters/coreComparisonAdapter.mjs";
import { observedOffersPort } from "./observedOffersPort.mjs";

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
  { mode = COMPARISON_MODE.OBSERVED } = {}
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
      const offers = await loadObservedOffers(basket);

      if (!Array.isArray(offers)) {
        throw new TypeError("observed offers port must return an array");
      }

      return coreCompare({ basket, offers });
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
