export function reshapeSurfaceBasket(surfaceBasket) {
  if (!Array.isArray(surfaceBasket)) {
    throw new TypeError("surface basket must be an array");
  }

  return surfaceBasket.map((item) => ({
    product: {
      id: item?.id,
      name: item?.name,
      unit: item?.unit
    },
    quantity: item?.quantity
  }));
}

export function createCoreComparisonAdapter(coreCompare, stores) {
  if (typeof coreCompare !== "function") {
    throw new TypeError("core compare must be a function");
  }

  if (!Array.isArray(stores)) {
    throw new TypeError("stores must be an array");
  }

  return function compareSurfaceBasket(surfaceBasket) {
    return coreCompare({
      basket: reshapeSurfaceBasket(surfaceBasket),
      stores
    });
  };
}
