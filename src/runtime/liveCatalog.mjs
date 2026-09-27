import { buildAiCatalogHints } from "../catalog/productDiscovery.mjs";
import { CANONICAL_PRODUCTS } from "../data/canonicalProductRegistry.mjs";
import { extractCatalogQueries } from "./catalogQueries.mjs";

export function surfaceProductsFromCatalog(products) {
  if (!Array.isArray(products)) return [];

  const byId = new Map();

  for (const product of products) {
    if (
      !product
      || product.comparisonEligible !== true
      || typeof product.canonicalProductId !== "string"
      || !product.canonicalIdentity
    ) {
      continue;
    }

    const { id, name, unit } = product.canonicalIdentity;
    if (
      id !== product.canonicalProductId
      || typeof name !== "string"
      || typeof unit !== "string"
    ) {
      continue;
    }

    const surfaceProduct = Object.freeze({
      id,
      name,
      unit,
      category: typeof product.category === "string" && product.category.trim()
        ? product.category.trim()
        : "Каталог",
      catalogSource: "open-food-facts"
    });

    if (byId.has(id)) {
      const existing = byId.get(id);
      if (
        existing !== null
        && (
          existing.name !== surfaceProduct.name
          || existing.unit !== surfaceProduct.unit
        )
      ) {
        byId.set(id, null);
      }
      continue;
    }

    byId.set(id, surfaceProduct);
  }

  return Array.from(byId.values()).filter(Boolean);
}

export function createAiCatalogResolver(searchCatalog, options = {}) {
  if (typeof searchCatalog !== "function") {
    throw new TypeError("AI catalog resolver requires search function");
  }

  const fallbackCatalog = options.fallbackCatalog ?? CANONICAL_PRODUCTS;

  return async function resolveAiCatalog(text) {
    const queries = extractCatalogQueries(text);
    if (queries.length === 0) {
      throw new TypeError("AI catalog query is empty");
    }

    const result = await searchCatalog(queries, { limitPerQuery: 8 });

    if (result?.kind === "unavailable") {
      return fallbackCatalog;
    }

    if (result?.kind !== "catalog") {
      throw new TypeError("live catalog search failed");
    }

    const hints = buildAiCatalogHints(result.products);
    if (hints.length === 0) {
      throw new TypeError("live catalog returned no confirmed identities");
    }

    return hints;
  };
}
