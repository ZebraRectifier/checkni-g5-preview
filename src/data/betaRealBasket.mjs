export const BETA_REAL_PRODUCTS = Object.freeze([
  Object.freeze({
    id: "dobry-cola-1l",
    name: "Напиток Добрый Cola",
    unit: "1 л",
    category: "Газированные напитки"
  }),
  Object.freeze({
    id: "dobry-lemon-lime-1l",
    name: "Напиток Добрый Лимон-Лайм",
    unit: "1 л",
    category: "Газированные напитки"
  })
]);

export const BETA_REAL_BASKET = Object.freeze(
  BETA_REAL_PRODUCTS.map((product) => Object.freeze({
    product: Object.freeze({
      id: product.id,
      name: product.name,
      unit: product.unit
    }),
    quantity: 1
  }))
);

export const BETA_REAL_PRODUCT_IDS = Object.freeze(
  BETA_REAL_PRODUCTS.map((product) => product.id)
);
