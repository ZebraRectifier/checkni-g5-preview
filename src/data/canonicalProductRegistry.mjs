import { MOCK_CATALOG } from "./mockCatalog.mjs";

export const CANONICAL_PRODUCT_REGISTRY_META = Object.freeze({
  coverage: "curated-seed",
  exhaustive: false,
  identityOnly: true,
  commercialTruth: false
});

export const CANONICAL_PRODUCTS = Object.freeze(
  MOCK_CATALOG.map((product) => Object.freeze({
    id: product.id,
    name: product.name,
    unit: product.unit,
    category: product.category
  }))
);

const CANONICAL_PRODUCT_BY_ID = new Map(
  CANONICAL_PRODUCTS.map((product) => [product.id, product])
);

export function getCanonicalProduct(productId) {
  if (typeof productId !== "string") return null;
  return CANONICAL_PRODUCT_BY_ID.get(productId) ?? null;
}
