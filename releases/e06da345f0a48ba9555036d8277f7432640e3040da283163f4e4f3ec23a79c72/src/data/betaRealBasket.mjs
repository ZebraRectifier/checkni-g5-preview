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

export const BETA_DOBRY_BINDINGS = Object.freeze([
  Object.freeze({
    canonicalProductId: "dobry-cola-1l",
    displayName: "Напиток Добрый Cola, 1 л"
  }),
  Object.freeze({
    canonicalProductId: "dobry-lemon-lime-1l",
    displayName: "Напиток Добрый Лимон-Лайм, 1 л"
  })
]);

// Everyday Moscow basket compared on live METRO and GLOBUS pages.
// Must match supabase/functions/beta-retail-prices/profiles.mjs (tested).
export const BETA_DOBRY_PROFILE_ID = "dobry-1l-globus-metro-v1";
export const BETA_EVERYDAY_PROFILE_ID = "everyday-moscow-globus-metro-v1";
export const BETA_DOBRY_PROOF_PROFILE_ID =
  "proof-dobry-lemon-lime-globus-metro-v1";
export const BETA_EGGS_PROOF_PROFILE_ID =
  "proof-eggs-c1-globus-metro-v1";
export const BETA_METRO_MAGNIT_PROOF_PROFILE_ID =
  "proof-dobry-metro-magnit-v1";
export const BETA_METRO_MAGNIT_EVERYDAY_PROOF_PROFILE_ID =
  "proof-everyday-metro-magnit-v1";

export const BETA_EVERYDAY_BINDINGS = Object.freeze([
  Object.freeze({ canonicalProductId: "milk-25-900", displayName: "Молоко Простоквашино пастеризованное 2,5%, 930 мл" }),
  Object.freeze({ canonicalProductId: "kefir-1l", displayName: "Кефир Простоквашино 2,5%, 930 г" }),
  Object.freeze({ canonicalProductId: "butter-825-180", displayName: "Масло сливочное Брест-Литовск 82,5%, 180 г" }),
  Object.freeze({ canonicalProductId: "rice-900", displayName: "Рис Увелка круглозёрный шлифованный, 800 г" }),
  Object.freeze({ canonicalProductId: "eggs-c1-10", displayName: "Яйца Окское столовые С1, 10 шт" }),
  Object.freeze({ canonicalProductId: "pasta-450", displayName: "Спагетти Pasteroni №114, 450 г" })
]);

export const BETA_EVERYDAY_PRODUCT_IDS = Object.freeze(
  BETA_EVERYDAY_BINDINGS.map((binding) => binding.canonicalProductId)
);

export const BETA_EVERYDAY_PROOF_BINDINGS = Object.freeze(
  BETA_EVERYDAY_BINDINGS.slice(0, 3)
);

export const BETA_EVERYDAY_PROOF_PRODUCTS = Object.freeze([
  Object.freeze({
    id: "milk-25-900",
    name: "Молоко Простоквашино",
    unit: "930 мл",
    category: "Молочные продукты"
  }),
  Object.freeze({
    id: "kefir-1l",
    name: "Кефир Простоквашино 2,5%",
    unit: "930 г",
    category: "Молочные продукты"
  }),
  Object.freeze({
    id: "butter-825-180",
    name: "Масло сливочное Брест-Литовск 82,5%",
    unit: "180 г",
    category: "Молочные продукты"
  })
]);

export const BETA_EVERYDAY_PROOF_PRODUCT_IDS = Object.freeze(
  BETA_EVERYDAY_PROOF_PRODUCTS.map((product) => product.id)
);

export const BETA_EVERYDAY_PROOF_BASKET = Object.freeze(
  BETA_EVERYDAY_PROOF_PRODUCTS.map((product) => Object.freeze({
    product: Object.freeze({
      id: product.id,
      name: product.name,
      unit: product.unit
    }),
    quantity: 1
  }))
);

export const BETA_PROFILE_PRODUCT_IDS = Object.freeze({
  [BETA_DOBRY_PROFILE_ID]: BETA_REAL_PRODUCT_IDS,
  [BETA_EVERYDAY_PROFILE_ID]: BETA_EVERYDAY_PRODUCT_IDS
});


export const BETA_PROFILE_BINDINGS = Object.freeze({
  [BETA_DOBRY_PROFILE_ID]: BETA_DOBRY_BINDINGS,
  [BETA_EVERYDAY_PROFILE_ID]: BETA_EVERYDAY_BINDINGS
});


export const BETA_LIVE_PROFILE_PRODUCT_IDS = Object.freeze({
  [BETA_METRO_MAGNIT_EVERYDAY_PROOF_PROFILE_ID]:
    BETA_EVERYDAY_PROOF_PRODUCT_IDS,
  [BETA_METRO_MAGNIT_PROOF_PROFILE_ID]:
    BETA_REAL_PRODUCT_IDS
});

export const BETA_LIVE_PROFILE_BINDINGS = Object.freeze({
  [BETA_METRO_MAGNIT_EVERYDAY_PROOF_PROFILE_ID]:
    BETA_EVERYDAY_PROOF_BINDINGS,
  [BETA_METRO_MAGNIT_PROOF_PROFILE_ID]:
    BETA_DOBRY_BINDINGS
});

// Owner-test live proof: three ordinary grocery products observed in METRO
// and Magnit at explicit Moscow store/city scope. Magnit prices may be public
// promos; the condition remains visible and typed.
export const BETA_LIVE_PROOF_BASKET = BETA_EVERYDAY_PROOF_BASKET;
