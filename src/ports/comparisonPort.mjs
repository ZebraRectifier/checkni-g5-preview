import { compareBasket } from "../core/basket-core.mjs";
import { mockStores } from "../core/mock-scenario.mjs";
import { createCoreComparisonAdapter } from "../adapters/coreComparisonAdapter.mjs";

/**
 * SURFACE integration seam for CHECKNI Core comparison.
 *
 * The injected compare function owns all commercial truth. This port only
 * exposes availability and forwards the SURFACE basket to that function.
 */
export function createComparisonPort(coreCompare) {
  return Object.freeze({
    isAvailable: typeof coreCompare === "function",

    async compare(surfaceBasket) {
      if (typeof coreCompare !== "function") {
        throw new Error("CHECKNI Core comparison is not connected.");
      }

      return coreCompare(surfaceBasket);
    }
  });
}

const coreComparisonAdapter = createCoreComparisonAdapter(compareBasket, mockStores);

export const comparisonPort = createComparisonPort(coreComparisonAdapter);
