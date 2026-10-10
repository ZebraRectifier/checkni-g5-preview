import {
  BETA_EVERYDAY_BINDINGS,
  BETA_EVERYDAY_PROOF_PRODUCTS
} from "../data/betaRealBasket.mjs";

// Identity only. These are the reviewed SKUs from the existing live proof,
// not a name search, a price observation or a retailer stock assertion.
const BINDINGS = Object.freeze([
  ["metro", "241097", "milk-25-900", "Молоко Простоквашино пастеризованное 2.5%, 930мл",
    "/products/moloko-prostokvashino-pasterizovannoye-2-5-930ml"],
  ["metro", "241096", "kefir-1l", "Кефир Простоквашино 2.5%, 930г",
    "/products/kefir-prostokvashino-25-930g"],
  ["metro", "644791", "butter-825-180", "Масло сливочное Брест-Литовск 82.5%, 180г",
    "/products/brest-litovskoe-825-180g-bzmzh"],
  ["magnit", "1899800733", "milk-25-900", "Молоко Простоквашино пастеризованное 2.5% 930мл",
    "/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml"],
  ["magnit", "1899800689", "kefir-1l", "Кефир Простоквашино 2.5% 930г",
    "/product/1899800689-kefir_prostokvashino_2_5_930g"]
].map(([retailerId, sourceProductId, productId, name, path]) => Object.freeze({
  retailerId, sourceProductId, productId, name, path
})));

function normalizedName(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU")
      .replace(/(\d)[.,](\d)/gu, "$1,$2").replace(/\s+/gu, " ")
    : null;
}

function normalizedUnit(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/\s+/gu, "")
    : null;
}

export function getReviewedRetailBasketProduct(product) {
  if (!product || typeof product !== "object") return null;
  const binding = BINDINGS.find(candidate => (
    candidate.retailerId === product.retailerId
    && candidate.sourceProductId === product.sourceProductId
    && normalizedName(candidate.name) === normalizedName(product.name)
  ));
  if (!binding) return null;

  const canonical = BETA_EVERYDAY_PROOF_PRODUCTS.find(item => item.id === binding.productId);
  const display = BETA_EVERYDAY_BINDINGS.find(item => item.canonicalProductId === binding.productId);
  // A missing separate unit is safe only because the exact reviewed title
  // above already proves this pack. A contradictory supplied unit fails closed.
  if (!canonical || !display || (product.unit != null
      && normalizedUnit(product.unit) !== normalizedUnit(canonical.unit))) return null;

  let url;
  try { url = new URL(product.productUrl); } catch { return null; }
  const host = binding.retailerId === "metro" ? "online.metro-cc.ru" : "magnit.ru";
  if (url.protocol !== "https:" || url.host !== host || url.username || url.password
      || url.pathname !== binding.path) return null;

  const suffix = ", " + canonical.unit;
  if (!display.displayName.endsWith(suffix)) return null;
  return Object.freeze({
    id: canonical.id,
    name: display.displayName.slice(0, -suffix.length),
    unit: canonical.unit,
    category: canonical.category
  });
}
