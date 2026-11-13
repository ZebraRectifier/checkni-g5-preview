const OFFER_STATUS = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

const LINE_STATUS = Object.freeze({
  PRICED: 'priced',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

/**
 * Deterministically normalize a manual basket.
 * Duplicate product ids are merged by summing quantity.
 * Output is sorted by product id so equivalent input produces equivalent output.
 *
 * @param {Array<{product: {id: string, name: string, unit?: string}, quantity: number}>} items
 * @returns {Array<{product: {id: string, name: string, unit: string}, quantity: number}>}
 */
function normalizeBasket(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('basket must contain at least one item');
  }

  const byProduct = new Map();

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      throw new TypeError('basket item must be an object');
    }

    const product = item.product;
    if (!product || typeof product !== 'object') {
      throw new TypeError('basket item product is required');
    }

    const id = requireNonEmptyString(product.id, 'product.id');
    const name = requireNonEmptyString(product.name, 'product.name');
    const unit = product.unit == null ? 'unit' : requireNonEmptyString(product.unit, 'product.unit');
    const quantity = requirePositiveNumber(item.quantity, 'basket item quantity');

    const existing = byProduct.get(id);
    if (existing) {
      if (existing.product.name !== name || existing.product.unit !== unit) {
        throw new TypeError('conflicting product metadata for ' + id);
      }
      existing.quantity = requirePositiveNumber(
        existing.quantity + quantity,
        'basket item quantity',
      );
    } else {
      byProduct.set(id, {
        product: { id, name, unit },
        quantity,
      });
    }
  }

  return Array.from(byProduct.values()).sort((a, b) => compareText(a.product.id, b.product.id));
}

/**
 * Compare a basket across stores and derive a deterministic PurchasePlan.
 * Money is represented as integer minor units (for RUB: kopeks).
 *
 * @param {{
 *   basket: Array<{product: {id: string, name: string, unit?: string}, quantity: number}>,
 *   stores: Array<{
 *     id: string,
 *     name: string,
 *     isMock?: boolean,
 *     offers: Array<{productId: string, status: 'available'|'unavailable'|'unknown', unitPriceMinor?: number}>
 *   }>
 * }} input
 */
function compareBasket(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('input is required');
  }

  const basket = normalizeBasket(input.basket);
  const stores = normalizeStores(input.stores);
  const storeBaskets = stores.map((store) => buildStoreBasket(basket, store));
  const completeStores = storeBaskets
    .filter((storeBasket) => storeBasket.complete)
    .sort(compareCompleteStoreBaskets);

  const winner = completeStores.length === 0 ? null : toWinner(completeStores[0]);
  const savingsMinor = completeStores.length < 2
    ? null
    : completeStores[1].totalMinor - completeStores[0].totalMinor;

  return {
    basket,
    storeBaskets,
    winner,
    savingsMinor,
    purchasePlan: buildPurchasePlan(basket, storeBaskets),
  };
}

function normalizeStores(stores) {
  if (!Array.isArray(stores) || stores.length < 2 || stores.length > 3) {
    throw new TypeError('stores must contain 2 or 3 stores');
  }

  const ids = new Set();
  const normalized = stores.map((store) => {
    if (!store || typeof store !== 'object') {
      throw new TypeError('store must be an object');
    }

    const id = requireNonEmptyString(store.id, 'store.id');
    const name = requireNonEmptyString(store.name, 'store.name');
    if (ids.has(id)) {
      throw new TypeError('duplicate store id: ' + id);
    }
    ids.add(id);

    if (!Array.isArray(store.offers)) {
      throw new TypeError('offers must be an array for store ' + id);
    }

    const offerMap = new Map();
    for (const offer of store.offers) {
      if (!offer || typeof offer !== 'object') {
        throw new TypeError('offer must be an object for store ' + id);
      }
      const productId = requireNonEmptyString(offer.productId, 'offer.productId');
      if (offerMap.has(productId)) {
        throw new TypeError('duplicate offer for ' + productId + ' in store ' + id);
      }

      const status = requireOfferStatus(offer.status);
      let unitPriceMinor = null;
      if (
        status === OFFER_STATUS.AVAILABLE
        && Number.isSafeInteger(offer.unitPriceMinor)
        && offer.unitPriceMinor >= 0
      ) {
        unitPriceMinor = offer.unitPriceMinor;
      }

      offerMap.set(productId, { productId, status, unitPriceMinor });
    }

    return {
      id,
      name,
      isMock: Boolean(store.isMock),
      offerMap,
    };
  });

  return normalized.sort((a, b) => compareText(a.id, b.id));
}

function buildStoreBasket(basket, store) {
  const lines = basket.map((item) => buildStoreLine(item, store.offerMap.get(item.product.id)));
  const pricedLines = lines.filter((line) => line.status === LINE_STATUS.PRICED);
  const knownSubtotalMinor = sumMinorAmounts(
    pricedLines.map((line) => line.lineTotalMinor),
    'store basket subtotal',
  );
  const coveredItems = pricedLines.length;
  const totalItems = basket.length;
  const complete = coveredItems === totalItems;

  return {
    storeId: store.id,
    storeName: store.name,
    isMock: store.isMock,
    lines,
    knownSubtotalMinor,
    totalMinor: complete ? knownSubtotalMinor : null,
    coverage: createCoverage(coveredItems, totalItems),
    complete,
    missingProductIds: lines
      .filter((line) => line.status !== LINE_STATUS.PRICED)
      .map((line) => line.productId),
  };
}

function buildStoreLine(item, offer) {
  if (!offer || offer.status === OFFER_STATUS.UNKNOWN) {
    return unpricedLine(item, LINE_STATUS.UNKNOWN);
  }

  if (offer.status === OFFER_STATUS.UNAVAILABLE) {
    return unpricedLine(item, LINE_STATUS.UNAVAILABLE);
  }

  // An "available" offer without a valid price is not priced truth.
  if (offer.unitPriceMinor == null) {
    return unpricedLine(item, LINE_STATUS.UNKNOWN);
  }

  return {
    productId: item.product.id,
    quantity: item.quantity,
    unit: item.product.unit,
    status: LINE_STATUS.PRICED,
    unitPriceMinor: offer.unitPriceMinor,
    lineTotalMinor: calculateLineTotalMinor(offer.unitPriceMinor, item.quantity),
  };
}

function unpricedLine(item, status) {
  return {
    productId: item.product.id,
    quantity: item.quantity,
    unit: item.product.unit,
    status,
    unitPriceMinor: null,
    lineTotalMinor: null,
  };
}

function buildPurchasePlan(basket, storeBaskets) {
  const candidates = [];
  const fallbackStatusByProduct = new Map(
    basket.map((item) => {
      const observedLines = storeBaskets
        .map((store) => store.lines.find((line) => line.productId === item.product.id))
        .filter(Boolean);
      const status = observedLines.length === storeBaskets.length
        && observedLines.every((line) => line.status === LINE_STATUS.UNAVAILABLE)
        ? LINE_STATUS.UNAVAILABLE
        : LINE_STATUS.UNKNOWN;
      return [item.product.id, status];
    }),
  );

  for (let i = 0; i < storeBaskets.length; i += 1) {
    candidates.push(buildPlanCandidate(basket, [storeBaskets[i]], fallbackStatusByProduct));
    for (let j = i + 1; j < storeBaskets.length; j += 1) {
      candidates.push(buildPlanCandidate(
        basket,
        [storeBaskets[i], storeBaskets[j]],
        fallbackStatusByProduct,
      ));
    }
  }

  candidates.sort(comparePlanCandidates);
  return candidates[0];
}

function buildPlanCandidate(basket, selectedStores, fallbackStatusByProduct) {
  const lines = [];
  const allocations = new Map(selectedStores.map((store) => [store.storeId, []]));

  for (const item of basket) {
    const choices = selectedStores
      .map((store) => ({
        storeId: store.storeId,
        line: store.lines.find((line) => line.productId === item.product.id),
      }))
      .filter((choice) => choice.line && choice.line.status === LINE_STATUS.PRICED)
      .sort((a, b) => {
        if (a.line.lineTotalMinor !== b.line.lineTotalMinor) {
          return a.line.lineTotalMinor - b.line.lineTotalMinor;
        }
        return compareText(a.storeId, b.storeId);
      });

    if (choices.length === 0) {
      const status = fallbackStatusByProduct.get(item.product.id) ?? LINE_STATUS.UNKNOWN;

      lines.push({
        productId: item.product.id,
        quantity: item.quantity,
        unit: item.product.unit,
        storeId: null,
        unitPriceMinor: null,
        lineTotalMinor: null,
        status,
      });
      continue;
    }

    const best = choices[0];
    const allocated = {
      productId: item.product.id,
      quantity: item.quantity,
      unit: item.product.unit,
      storeId: best.storeId,
      unitPriceMinor: best.line.unitPriceMinor,
      lineTotalMinor: best.line.lineTotalMinor,
      status: LINE_STATUS.PRICED,
    };
    lines.push(allocated);
    allocations.get(best.storeId).push(allocated);
  }

  const usedStores = selectedStores
    .filter((store) => allocations.get(store.storeId).length > 0)
    .map((store) => ({
      storeId: store.storeId,
      storeName: store.storeName,
      isMock: store.isMock,
      items: allocations.get(store.storeId),
      subtotalMinor: sumMinorAmounts(
        allocations.get(store.storeId).map((line) => line.lineTotalMinor),
        'purchase plan store subtotal',
      ),
    }))
    .sort((a, b) => compareText(a.storeId, b.storeId));

  const coveredItems = lines.filter((line) => line.status === LINE_STATUS.PRICED).length;
  const totalItems = basket.length;
  const complete = coveredItems === totalItems;
  const knownSubtotalMinor = sumMinorAmounts(
    lines
      .filter((line) => line.lineTotalMinor != null)
      .map((line) => line.lineTotalMinor),
    'purchase plan known subtotal',
  );

  return {
    stores: usedStores,
    lines,
    knownSubtotalMinor,
    totalMinor: complete ? knownSubtotalMinor : null,
    coverage: createCoverage(coveredItems, totalItems),
    complete,
    missingProductIds: lines
      .filter((line) => line.status !== LINE_STATUS.PRICED)
      .map((line) => line.productId),
  };
}

function compareCompleteStoreBaskets(a, b) {
  if (a.totalMinor !== b.totalMinor) {
    return a.totalMinor - b.totalMinor;
  }
  return compareText(a.storeId, b.storeId);
}

function comparePlanCandidates(a, b) {
  if (a.coverage.coveredItems !== b.coverage.coveredItems) {
    return b.coverage.coveredItems - a.coverage.coveredItems;
  }

  // Unknown money is not zero. Only compare monetary totals when both plans
  // fully cover the basket; otherwise use non-monetary deterministic tie-breaks.
  if (a.complete && b.complete && a.totalMinor !== b.totalMinor) {
    return a.totalMinor - b.totalMinor;
  }

  if (a.stores.length !== b.stores.length) {
    return a.stores.length - b.stores.length;
  }
  return compareText(
    a.stores.map((store) => store.storeId).join('|'),
    b.stores.map((store) => store.storeId).join('|'),
  );
}

function toWinner(storeBasket) {
  return {
    storeId: storeBasket.storeId,
    storeName: storeBasket.storeName,
    isMock: storeBasket.isMock,
    totalMinor: storeBasket.totalMinor,
    coverage: storeBasket.coverage,
  };
}

function createCoverage(coveredItems, totalItems) {
  return {
    coveredItems,
    totalItems,
    ratio: coveredItems / totalItems,
  };
}

function calculateLineTotalMinor(unitPriceMinor, quantity) {
  const lineTotalMinor = Math.round(unitPriceMinor * quantity);
  if (!Number.isSafeInteger(lineTotalMinor) || lineTotalMinor < 0) {
    throw new TypeError('line total must be a non-negative safe integer');
  }
  return lineTotalMinor;
}

function sumMinorAmounts(amounts, label) {
  return amounts.reduce((sum, amount) => {
    const next = sum + amount;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new TypeError(label + ' must be a non-negative safe integer');
    }
    return next;
  }, 0);
}

function requireOfferStatus(status) {
  if (!Object.values(OFFER_STATUS).includes(status)) {
    throw new TypeError('invalid offer status: ' + String(status));
  }
  return status;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(label + ' must be a non-empty string');
  }
  return value;
}

function requirePositiveNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(label + ' must be a positive finite number');
  }
  return value;
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export {
  LINE_STATUS,
  OFFER_STATUS,
  compareBasket,
  normalizeBasket,
};
