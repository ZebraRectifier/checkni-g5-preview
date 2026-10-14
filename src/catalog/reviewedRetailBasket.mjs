import {
  BETA_EVERYDAY_BINDINGS,
  BETA_EVERYDAY_PROOF_PRODUCTS,
  BETA_REAL_PRODUCTS
} from "../data/betaRealBasket.mjs";

// Identity only. These are the reviewed SKUs from the existing live proof,
// not a name search, a price observation or a retailer stock assertion.
const BINDINGS = Object.freeze([
  ["globus", "000000000000027692_ST", "globus-kefir-prostokvashino-32-930g", "Кефир Простоквашино 3,2%, 930г",
    "/products/kefir-prostokvashino-32-930g-27692_ST/"],
  ["globus", "000000000000712952_ST", "globus-dobry-cola-1l", "Напиток Добрый Cola, 1л",
    "/products/napitok-dobryj-cola-1l-712952_ST/"],
  ["globus", "000000000000754268_ST", "globus-rice-uvelka-round-800g", "Рис круглозерный Увелка, 800г",
    "/products/ris-kruglozernyj-uvelka-800g-754268_ST/"],
  ["metro", "241097", "milk-25-900", "Молоко Простоквашино пастеризованное 2.5%, 930мл",
    "/products/moloko-prostokvashino-pasterizovannoye-2-5-930ml"],
  ["metro", "241096", "kefir-1l", "Кефир Простоквашино 2.5%, 930г",
    "/products/kefir-prostokvashino-25-930g"],
  ["metro", "644791", "butter-825-180", "Масло сливочное Брест-Литовск 82.5%, 180г",
    "/products/brest-litovskoe-825-180g-bzmzh"],
  ["magnit", "1899800733", "milk-25-900", "Молоко Простоквашино пастеризованное 2.5% 930мл",
    "/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml"],
  ["magnit", "1899800689", "kefir-1l", "Кефир Простоквашино 2.5% 930г",
    "/product/1899800689-kefir_prostokvashino_2_5_930g"],
  ["magnit", "1000084229", "butter-825-180", "Масло сладко-сливочное Брест-Литовск 82.5% 180г",
    "/product/1000084229-maslo_sladko_slivochnoe_brest_litovsk_82_5_180g"]
].map(([retailerId, sourceProductId, productId, name, path]) => Object.freeze({
  retailerId, sourceProductId, productId, name, path
})));

// These physical-catalogue identities have their own exact pack IDs. They do
// not inherit the historical kefir/rice family IDs or online beta profiles.
const GLOBUS_PRODUCTS = Object.freeze([
  Object.freeze({ id: "globus-kefir-prostokvashino-32-930g",
    name: "Кефир Простоквашино 3,2%", unit: "930 г", category: "Молочные продукты" }),
  Object.freeze({ id: "globus-dobry-cola-1l",
    name: "Напиток Добрый Cola", unit: "1 л", category: "Газированные напитки" }),
  Object.freeze({ id: "globus-rice-uvelka-round-800g",
    name: "Рис круглозерный Увелка", unit: "800 г", category: "Бакалея" })
]);

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

// Fixed live profiles price these exact packs. A historical family ID alone
// cannot turn a generic 900ml/1l basket row into the reviewed 930ml/930g SKU.
export function getReviewedRetailBasketIdentity(productId) {
  const physical = GLOBUS_PRODUCTS.find(row => row.id === productId);
  if (physical) return physical;
  const display = BETA_EVERYDAY_BINDINGS.find(row => row.canonicalProductId === productId)?.displayName;
  const separator = display?.lastIndexOf(", ") ?? -1;
  if (separator >= 0) return Object.freeze({ id: productId,
    name: display.slice(0, separator), unit: display.slice(separator + 2) });
  const exact = BETA_REAL_PRODUCTS.find(row => row.id === productId);
  return exact ? Object.freeze({ id: exact.id, name: exact.name, unit: exact.unit }) : null;
}

export function matchesReviewedRetailBasketIdentity(product) {
  if (!product || typeof product !== "object") return false;
  const physical = GLOBUS_PRODUCTS.find(row => row.id === product.id);
  if (physical) return normalizedName(physical.name) === normalizedName(product.name)
    && normalizedUnit(physical.unit) === normalizedUnit(product.unit);
  const exact = BETA_EVERYDAY_PROOF_PRODUCTS.find(row => row.id === product.id)
    ?? BETA_REAL_PRODUCTS.find(row => row.id === product.id);
  const display = BETA_EVERYDAY_BINDINGS.find(row => row.canonicalProductId === product.id)?.displayName;
  const separator = display?.lastIndexOf(", ") ?? -1;
  const names = [exact?.name, separator >= 0 ? display.slice(0, separator) : null].filter(Boolean);
  const units = [exact?.unit, separator >= 0 ? display.slice(separator + 2) : null].filter(Boolean);
  return names.some(name => normalizedName(name) === normalizedName(product.name))
    && units.some(unit => normalizedUnit(unit) === normalizedUnit(product.unit));
}

export function getReviewedRetailSourceProductIds(retailerId, products) {
  if (!Array.isArray(products)) return [];
  const ids = new Set(products.filter(matchesReviewedRetailBasketIdentity).map(product => product.id));
  return BINDINGS.filter(binding => binding.retailerId === retailerId && ids.has(binding.productId))
    .map(binding => binding.sourceProductId);
}

export function getReviewedRetailBasketProduct(product) {
  if (!product || typeof product !== "object") return null;
  const binding = BINDINGS.find(candidate => (
    candidate.retailerId === product.retailerId
    && candidate.sourceProductId === product.sourceProductId
    && normalizedName(candidate.name) === normalizedName(product.name)
  ));
  if (!binding) return null;

  const physical = GLOBUS_PRODUCTS.find(item => item.id === binding.productId);
  const canonical = physical ?? BETA_EVERYDAY_PROOF_PRODUCTS.find(item => item.id === binding.productId);
  const display = BETA_EVERYDAY_BINDINGS.find(item => item.canonicalProductId === binding.productId);
  // A missing separate unit is safe only because the exact reviewed title
  // above already proves this pack. A contradictory supplied unit fails closed.
  if (!canonical || (!physical && !display) || (product.unit != null
      && normalizedUnit(product.unit) !== normalizedUnit(canonical.unit))) return null;

  let url;
  try { url = new URL(product.productUrl); } catch { return null; }
  const host = binding.retailerId === "globus" ? "www.globus.ru"
    : binding.retailerId === "metro" ? "online.metro-cc.ru" : "magnit.ru";
  if (url.protocol !== "https:" || url.host !== host || url.username || url.password
      || url.pathname !== binding.path
      || (physical && (url.search || url.hash))) return null;

  if (physical) return physical;

  const suffix = ", " + canonical.unit;
  if (!display.displayName.endsWith(suffix)) return null;
  return Object.freeze({
    id: canonical.id,
    name: display.displayName.slice(0, -suffix.length),
    unit: canonical.unit,
    category: canonical.category
  });
}
