export const BETA_REAL_PRODUCTS = Object.freeze([
  Object.freeze({
    id: "frutonyanya-water-330",
    name: "Вода ФрутоНяня артезианская детская",
    unit: "330 мл",
    category: "Детские напитки"
  }),
  Object.freeze({
    id: "frutonyanya-multifruct-200",
    name: "Сок ФрутоНяня Мультифрукт",
    unit: "200 мл",
    category: "Детские напитки"
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
