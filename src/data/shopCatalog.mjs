import { EXTENDED_CATALOG } from "./extendedCatalog.mjs";
import { MOCK_CATALOG } from "./mockCatalog.mjs";
import { BETA_REAL_PRODUCTS } from "./betaRealBasket.mjs";

// Catalogue the shop surface searches and the local basket parser reads:
// the original 12 items, extended everyday products and the fixed live-proof products.
const COMMON_INPUT_ALIASES = Object.freeze({
  "milk-25-900": Object.freeze(["малако"]),
  "apples-1kg": Object.freeze(["яблаки"])
});

const LIVE_PROOF_ALIASES = Object.freeze({
  "dobry-cola-1l": Object.freeze([
    "добрый кола",
    "добрый cola",
    "кола добрый",
    "газировка кола"
  ]),
  "dobry-lemon-lime-1l": Object.freeze([
    "добрый лимон лайм",
    "добрый лимон-лайм",
    "лимон лайм",
    "газировка лимон лайм"
  ])
});

export const SHOP_CATALOG = Object.freeze([
  ...MOCK_CATALOG.map((product) => Object.freeze({
    ...product,
    aliases: COMMON_INPUT_ALIASES[product.id] ?? Object.freeze([])
  })),
  ...BETA_REAL_PRODUCTS.map((product) => Object.freeze({
    id: product.id,
    name: product.name,
    unit: product.unit,
    category: product.category,
    aliases: LIVE_PROOF_ALIASES[product.id] ?? Object.freeze([])
  })),
  ...EXTENDED_CATALOG.map((product) => Object.freeze({
    id: product.id,
    name: product.name,
    unit: product.unit,
    category: product.category,
    aliases: product.aliases
  }))
]);
