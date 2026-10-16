// Display ordering only. A card's supplied pack price does not establish
// comparable identity, current stock, unit price or a cheapest basket.
export function sortObservedCatalogProducts(products, sortMode = 'default') {
  if (!Array.isArray(products)) return [];
  if (sortMode !== 'cheapest') return products.slice();

  return products.map((product, index) => ({ product, index,
    price: Number.isSafeInteger(product?.priceMinor) && product.priceMinor > 0
      ? product.priceMinor : null
  })).sort((left, right) => {
    if (left.price === null) return right.price === null ? left.index - right.index : 1;
    if (right.price === null) return -1;
    return left.price - right.price || left.index - right.index;
  }).map(entry => entry.product);
}
