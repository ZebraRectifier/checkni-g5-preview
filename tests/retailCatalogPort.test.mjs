import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanQuery,
  createRetailCatalogClient,
  getRetailCatalogDefinition,
  RETAIL_CATALOG_IDS,
  normalizeRetailCategory,
  normalizeRetailRow
} from "../src/ports/retailCatalogPort.mjs";

function row(overrides = {}) {
  return {
    retailer_id: "globus",
    store_id: "globus-pvz-2",
    store_name: "Глобус Красногорск",
    locality_id: "city-moscow",
    locality_name: "Москва",
    source_product_id: "000000000000446051_ST",
    name: "Молоко Село Зелёное 3,2%, 950 мл",
    price_minor: 12299,
    currency: "RUB",
    price_condition: "regular",
    availability: "unknown",
    product_url:
      "https://www.globus.ru/products/moloko-selo-zelyonoe-32-950ml-446051_ST/",
    image_url: "https://image.globus.ru/mobile/99/09/4749909.jpg",
    weight_text: "950 мл",
    main_category_id: 3979002,
    observed_at: "2026-09-30T21:10:31.368Z",
    ...overrides
  };
}

test("normalizes a Moscow-scoped GLOBUS row for display without comparison identity", () => {
  assert.deepEqual(normalizeRetailRow(row()), {
    id: "retail:globus:globus-pvz-2:000000000000446051_ST",
    name: "Молоко Село Зелёное 3,2%, 950 мл",
    unit: "950 мл",
    category: "Глобус · Москва",
    catalogSource: "globus",
    catalogDisplayOnly: true,
    retailerId: "globus",
    retailerDisplayName: "Глобус",
    storeName: "Глобус Красногорск",
    sourceProductId: "000000000000446051_ST",
    priceMinor: 12299,
    currency: "RUB",
    priceCondition: "regular",
    priceConditionLabel: null,
    availability: "unknown",
    mainCategoryId: 3979002,
    imageUrl: "https://image.globus.ru/mobile/99/09/4749909.jpg",
    sourceUrl:
      "https://www.globus.ru/products/moloko-selo-zelyonoe-32-950ml-446051_ST/",
    productUrl:
      "https://www.globus.ru/products/moloko-selo-zelyonoe-32-950ml-446051_ST/",
    observedAt: "2026-09-30T21:10:31.368Z"
  });
});

test("rejects rows that imply stock or lose exact store provenance", () => {
  assert.equal(normalizeRetailRow(row({ availability: "available" })), null);
  assert.equal(normalizeRetailRow(row({ store_id: "other-store" })), null);
});

test("GLOBUS product survives a missing or untrusted photo with no image URL", () => {
  assert.equal(normalizeRetailRow(row({ image_url: null }))?.imageUrl, null);
  assert.equal(
    normalizeRetailRow(row({ image_url: "https://example.com/milk.jpg" }))?.imageUrl,
    null
  );
});

test("retail search scopes PostgREST to active GLOBUS Moscow rows", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify([row()]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.search("молоко", { limit: 8 });

  assert.equal(result.kind, "catalog");
  assert.equal(result.products.length, 1);
  assert.equal(requestedUrl.searchParams.get("retailer_id"), "eq.globus");
  assert.equal(requestedUrl.searchParams.get("store_id"), "eq.globus-pvz-2");
  assert.equal(requestedUrl.searchParams.get("locality_id"), "eq.city-moscow");
  assert.equal(requestedUrl.searchParams.get("active"), "eq.true");
  assert.equal(requestedUrl.searchParams.get("name"), "ilike.*молоко*");
  assert.equal(requestedUrl.searchParams.get("limit"), "8");
});

function lentaRow(overrides = {}) {
  return {
    retailer_id: "lenta",
    store_id: "lenta-public-web",
    store_name: "Лента · публичный каталог",
    locality_id: "country-ru-public-catalog",
    locality_name: "Россия",
    source_product_id: "709949",
    name: "Хлопья овсяные ЛЕНТА Экстра, 500г",
    price_minor: 4499,
    currency: "RUB",
    price_condition: "loyalty-card-1",
    availability: "unknown",
    product_url:
      "https://lenta.com/product/hlopya-ovsyanye-ekstra-rossiya-500g-709949/",
    image_url:
      "https://cdn.api.lenta.com/resample/webp/500x500/photo/709949/95d15bf2-0b16-4edf-86ca-4063391887d9.png",
    weight_text: "500 г",
    main_category_id: 37,
    source_url: "https://lenta.com/catalog/kashi-hlopya-myusli-37/",
    observed_at: "2026-10-01T08:50:00.000Z",
    ...overrides
  };
}

test("normalizes a public Lenta observation without inventing availability", () => {
  assert.deepEqual(normalizeRetailRow(lentaRow(), "lenta"), {
    id: "retail:lenta:lenta-public-web:709949",
    name: "Хлопья овсяные ЛЕНТА Экстра, 500г",
    unit: "500 г",
    category: "Лента · публичный каталог",
    catalogSource: "lenta",
    catalogDisplayOnly: true,
    retailerId: "lenta",
    retailerDisplayName: "Лента",
    storeName: "Лента · публичный каталог",
    sourceProductId: "709949",
    priceMinor: 4499,
    currency: "RUB",
    priceCondition: "loyalty-card-1",
    priceConditionLabel: "По Карте №1",
    availability: "unknown",
    mainCategoryId: 37,
    imageUrl:
      "https://cdn.api.lenta.com/resample/webp/500x500/photo/709949/95d15bf2-0b16-4edf-86ca-4063391887d9.png",
    sourceUrl: "https://lenta.com/catalog/kashi-hlopya-myusli-37/",
    productUrl:
      "https://lenta.com/product/hlopya-ovsyanye-ekstra-rossiya-500g-709949/",
    observedAt: "2026-10-01T08:50:00.000Z"
  });
});

test("Lenta adapter rejects stock claims but keeps rows without trusted photos", () => {
  assert.equal(
    normalizeRetailRow(lentaRow({ availability: "available" }), "lenta"),
    null
  );
  assert.equal(
    normalizeRetailRow(lentaRow({ image_url: null }), "lenta")?.imageUrl,
    null
  );
  assert.equal(
    normalizeRetailRow(
      lentaRow({ image_url: "https://example.com/product.png" }),
      "lenta"
    )?.imageUrl,
    null
  );
});

test("Lenta client scopes reads to the public catalog binding", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    retailerId: "lenta",
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify([lentaRow()]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.search("хлопья", { limit: 8 });

  assert.equal(result.kind, "catalog");
  assert.equal(result.products.length, 1);
  assert.equal(requestedUrl.searchParams.get("retailer_id"), "eq.lenta");
  assert.equal(requestedUrl.searchParams.get("store_id"), "eq.lenta-public-web");
  assert.equal(
    requestedUrl.searchParams.get("locality_id"),
    "eq.country-ru-public-catalog"
  );
  assert.equal(requestedUrl.searchParams.get("active"), "eq.true");
});

test("search query removes PostgREST filter punctuation", () => {
  assert.equal(cleanQuery("  молоко,*)  "), "молоко");
});


test("retail browse returns recent active GLOBUS rows without a fake search query", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify([row()]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.browse({ limit: 12 });

  assert.equal(result.kind, "catalog");
  assert.equal(result.products.length, 1);
  assert.equal(requestedUrl.searchParams.get("retailer_id"), "eq.globus");
  assert.equal(requestedUrl.searchParams.get("store_id"), "eq.globus-pvz-2");
  assert.equal(requestedUrl.searchParams.get("locality_id"), "eq.city-moscow");
  assert.equal(requestedUrl.searchParams.get("active"), "eq.true");
  assert.equal(requestedUrl.searchParams.has("name"), false);
  assert.equal(requestedUrl.searchParams.get("limit"), "12");
});


test("invalid retail search never degrades into an unfiltered browse", async () => {
  let calls = 0;
  const client = createRetailCatalogClient({
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    publishableKey: "publishable-test",
    fetchImpl: async () => {
      calls += 1;
      return new Response("[]", { status: 200 });
    }
  });

  const result = await client.search(" ,*) ", { limit: 8 });
  assert.equal(result.kind, "error");
  assert.equal(result.code, "invalid_request");
  assert.equal(calls, 0);
});


function categoryRow(overrides = {}) {
  return {
    retailer_id: "globus",
    store_id: "globus-pvz-2",
    category_id: 10118965,
    name: "Молочные продукты, сыр, яйца",
    parent_id: null,
    root_id: 10118965,
    depth: 0,
    source_url:
      "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965",
    product_count: 412,
    ...overrides
  };
}

test("normalizes official GLOBUS category metadata", () => {
  assert.deepEqual(normalizeRetailCategory(categoryRow()), {
    categoryId: 10118965,
    name: "Молочные продукты, сыр, яйца",
    parentId: null,
    rootId: 10118965,
    depth: 0,
    productCount: 412,
    sourceUrl:
      "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965"
  });
});

test("category tree reads stay scoped to GLOBUS store", async () => {
  const requested = [];
  const client = createRetailCatalogClient({
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    categoryEndpoint:
      "https://project.supabase.co/rest/v1/retail_catalog_categories",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requested.push(new URL(url));
      return new Response(JSON.stringify([
        categoryRow()
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const roots = await client.rootCategories();
  assert.equal(roots.kind, "categories");
  assert.equal(roots.categories.length, 1);
  assert.equal(requested[0].searchParams.get("depth"), "eq.0");
  assert.equal(requested[0].searchParams.get("store_id"), "eq.globus-pvz-2");

  requested.length = 0;
  await client.subcategories(10118965);
  assert.equal(requested[0].searchParams.get("parent_id"), "eq.10118965");
});

function lentaCategoryRow(overrides = {}) {
  return {
    retailer_id: "lenta",
    store_id: "lenta-public-web",
    category_id: 25,
    name: "Макароны, крупы, мука",
    parent_id: null,
    root_id: 25,
    depth: 0,
    source_url: "https://lenta.com/catalog/makarony-krupy-muka-25/",
    product_count: 3,
    ...overrides
  };
}

test("normalizes Lenta category metadata through the shared retail model", () => {
  assert.deepEqual(normalizeRetailCategory(lentaCategoryRow(), "lenta"), {
    categoryId: 25,
    name: "Макароны, крупы, мука",
    parentId: null,
    rootId: 25,
    depth: 0,
    productCount: 3,
    sourceUrl: "https://lenta.com/catalog/makarony-krupy-muka-25/"
  });
});

test("Lenta category reads use the selected retailer binding", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    retailerId: "lenta",
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    categoryEndpoint:
      "https://project.supabase.co/rest/v1/retail_catalog_categories",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify([lentaCategoryRow()]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.rootCategories();
  assert.equal(result.kind, "categories");
  assert.equal(result.categories.length, 1);
  assert.equal(requestedUrl.searchParams.get("retailer_id"), "eq.lenta");
  assert.equal(requestedUrl.searchParams.get("store_id"), "eq.lenta-public-web");
  assert.equal(requestedUrl.searchParams.get("depth"), "eq.0");
});

test("category product browse filters by source main category id", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify([row()]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.browseCategory(3979002, { limit: 20 });
  assert.equal(result.kind, "catalog");
  assert.equal(
    requestedUrl.searchParams.get("main_category_id"),
    "eq.3979002"
  );
  assert.equal(
    requestedUrl.searchParams.get("order"),
    "name.asc,source_product_id.asc"
  );
  assert.equal(requestedUrl.searchParams.get("offset"), "0");
});

test("GLOBUS root browse uses trusted category URL when product metadata is unmapped", async () => {
  let requestedUrl = null;
  let requestCount = 0;
  const client = createRetailCatalogClient({
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestCount += 1;
      requestedUrl = new URL(url);
      return new Response(JSON.stringify([row()]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const root = normalizeRetailCategory(categoryRow());
  const result = await client.browseCategory(root, {
    limit: 20,
    offset: 40
  });
  assert.equal(result.kind, "catalog");
  assert.equal(result.products.length, 1);
  assert.equal(requestedUrl.searchParams.get("main_category_id"), null);
  assert.equal(
    requestedUrl.searchParams.get("category_url"),
    "like.https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965*"
  );
  assert.equal(
    requestedUrl.searchParams.get("order"),
    "name.asc,source_product_id.asc"
  );
  assert.equal(requestedUrl.searchParams.get("offset"), "40");
  assert.equal(result.nextOffset, 41);
  assert.equal(result.pageSize, 1);

  const rejected = await client.browseCategory({
    ...root,
    sourceUrl: "https://example.com/catalog/molochnye-produkty-10118965"
  });
  assert.equal(rejected.kind, "error");
  assert.equal(rejected.code, "invalid_request");

  const invalidOffset = await client.browseCategory(root, { offset: -1 });
  assert.equal(invalidOffset.kind, "error");
  assert.equal(invalidOffset.code, "invalid_request");
  assert.equal(requestCount, 1);
});


function magnitRow(overrides = {}) {
  return {
    retailer_id: "magnit",
    store_id: "magnit-777312",
    store_name: "Магнит · г Москва, аллея Берёзовая, д 17 к 2",
    locality_id: "city-moscow",
    locality_name: "Москва",
    source_product_id: "1899800733",
    name: "Молоко Простоквашино пастеризованное 2.5% 930мл",
    price_minor: 7999,
    currency: "RUB",
    price_condition: "public-online",
    availability: "unknown",
    product_url:
      "https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=777312&shopType=1",
    image_url:
      "https://images-foodtech.magnit.ru/mh2_OKEYYqIHjORj4bhjtTE4vrTboOSV0rsLcK69sLA/rs:fit:1600:1600/plain/s3://img-dostavka/catalog/pim/goods/1899800733/image/0fc205ab9182ad7917a6f42ff4fc6b8b.jpeg@webp",
    weight_text: "930мл",
    main_category_id: 63963,
    source_url:
      "https://magnit.ru/catalog/63963-testmmmolochnyy_prilavok?shopCode=777312&shopType=1",
    observed_at: "2026-10-06T12:14:07.392Z",
    ...overrides
  };
}

test("normalizes official Magnit store-scoped public row without stock inference", () => {
  assert.deepEqual(normalizeRetailRow(magnitRow(), "magnit"), {
    id: "retail:magnit:magnit-777312:1899800733",
    basketProductId: "milk-25-900",
    name: "Молоко Простоквашино пастеризованное 2.5% 930мл",
    unit: "930 мл",
    category: "Магнит · аллея Берёзовая, д 17 к 2",
    catalogSource: "magnit",
    catalogDisplayOnly: true,
    retailerId: "magnit",
    retailerDisplayName: "Магнит",
    storeName: "Магнит · г Москва, аллея Берёзовая, д 17 к 2",
    sourceProductId: "1899800733",
    priceMinor: 7999,
    currency: "RUB",
    priceCondition: "public-online",
    priceConditionLabel: "Публичная онлайн-цена",
    availability: "unknown",
    mainCategoryId: 63963,
    imageUrl:
      "https://images-foodtech.magnit.ru/mh2_OKEYYqIHjORj4bhjtTE4vrTboOSV0rsLcK69sLA/rs:fit:1600:1600/plain/s3://img-dostavka/catalog/pim/goods/1899800733/image/0fc205ab9182ad7917a6f42ff4fc6b8b.jpeg@webp",
    sourceUrl:
      "https://magnit.ru/catalog/63963-testmmmolochnyy_prilavok?shopCode=777312&shopType=1",
    productUrl:
      "https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=777312&shopType=1",
    observedAt: "2026-10-06T12:14:07.392Z"
  });
});

test("Magnit adapter rejects stock claims and foreign product/image hosts", () => {
  assert.equal(
    normalizeRetailRow(magnitRow({ availability: "available" }), "magnit"),
    null
  );
  assert.equal(
    normalizeRetailRow(
      magnitRow({ product_url: "https://example.com/product/1899800733" }),
      "magnit"
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      magnitRow({ image_url: "https://example.com/milk.webp" }),
      "magnit"
    )?.imageUrl,
    null
  );
});

function magnitCategoryRow(overrides = {}) {
  return {
    retailer_id: "magnit",
    store_id: "magnit-777312",
    category_id: 63963,
    name: "Молочный прилавок",
    parent_id: null,
    root_id: 63963,
    depth: 0,
    source_url:
      "https://magnit.ru/catalog/63963-testmmmolochnyy_prilavok?shopCode=777312&shopType=1",
    product_count: 23,
    ...overrides
  };
}

test("Magnit category and reads stay pinned to the proved public store binding", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    retailerId: "magnit",
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    categoryEndpoint:
      "https://project.supabase.co/rest/v1/retail_catalog_categories",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      const payload = requestedUrl.pathname.includes("categories")
        ? [magnitCategoryRow()]
        : [magnitRow()];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const roots = await client.rootCategories();
  assert.equal(roots.kind, "categories");
  assert.equal(roots.categories.length, 1);
  assert.equal(requestedUrl.searchParams.get("retailer_id"), "eq.magnit");
  assert.equal(requestedUrl.searchParams.get("store_id"), "eq.magnit-777312");

  const catalog = await client.browseCategory(63963, { limit: 20 });
  assert.equal(catalog.kind, "catalog");
  assert.equal(catalog.products.length, 1);
  assert.equal(requestedUrl.searchParams.get("locality_id"), "eq.city-moscow");
  assert.equal(requestedUrl.searchParams.get("main_category_id"), "eq.63963");
});


function vkusvillRow(overrides = {}) {
  return {
    retailer_id: "vkusvill",
    store_id: "vkusvill-public-web",
    store_name: "ВкусВилл · публичный каталог",
    locality_id: "country-ru-public-catalog",
    locality_name: "Россия",
    source_product_id: "22658",
    name: "Яйцо куриное С0, 10 шт",
    price_minor: 13600,
    currency: "RUB",
    price_condition: "public-online",
    availability: "unknown",
    product_url: "https://vkusvill.ru/goods/yaytso-kurinoe-s0-22658/",
    image_url: "https://img.vkusvill.ru/pim/images/site_LargeWebP/22658.webp",
    weight_text: "10 шт",
    main_category_id: 920006,
    source_url: "https://vkusvill.ru/goods/molochnye-produkty-yaytso/",
    observed_at: "2026-10-02T15:30:00.000Z",
    ...overrides
  };
}

function vkusvillCategoryRow(overrides = {}) {
  return {
    retailer_id: "vkusvill",
    store_id: "vkusvill-public-web",
    category_id: 920006,
    name: "Молочные продукты, яйцо",
    parent_id: null,
    root_id: 920006,
    depth: 0,
    source_url: "https://vkusvill.ru/goods/molochnye-produkty-yaytso/",
    product_count: 24,
    ...overrides
  };
}

test("normalizes official public VkusVill catalog rows without store/stock inference", () => {
  assert.deepEqual(normalizeRetailRow(vkusvillRow(), "vkusvill"), {
    id: "retail:vkusvill:vkusvill-public-web:22658",
    name: "Яйцо куриное С0, 10 шт",
    unit: "10 шт",
    category: "ВкусВилл · публичный каталог",
    catalogSource: "vkusvill",
    catalogDisplayOnly: true,
    retailerId: "vkusvill",
    retailerDisplayName: "ВкусВилл",
    storeName: "ВкусВилл · публичный каталог",
    sourceProductId: "22658",
    priceMinor: 13600,
    currency: "RUB",
    priceCondition: "public-online",
    priceConditionLabel: "Публичная цена сайта",
    availability: "unknown",
    mainCategoryId: 920006,
    imageUrl: "https://img.vkusvill.ru/pim/images/site_LargeWebP/22658.webp",
    sourceUrl: "https://vkusvill.ru/goods/molochnye-produkty-yaytso/",
    productUrl: "https://vkusvill.ru/goods/yaytso-kurinoe-s0-22658/",
    observedAt: "2026-10-02T15:30:00.000Z"
  });
});

test("VkusVill adapter fails closed on foreign identity and stock claims", () => {
  assert.equal(
    normalizeRetailRow(vkusvillRow({ availability: "available" }), "vkusvill"),
    null
  );
  assert.equal(
    normalizeRetailRow(
      vkusvillRow({ product_url: "https://example.com/goods/yaytso-22658/" }),
      "vkusvill"
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      vkusvillRow({ image_url: "https://example.com/22658.webp" }),
      "vkusvill"
    )?.imageUrl,
    null
  );
});

test("VkusVill client scopes reads to the coarse public-catalog binding", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    retailerId: "vkusvill",
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    categoryEndpoint: "https://project.supabase.co/rest/v1/retail_catalog_categories",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      const payload = requestedUrl.pathname.includes("categories")
        ? [vkusvillCategoryRow()]
        : [vkusvillRow()];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const roots = await client.rootCategories();
  assert.equal(roots.kind, "categories");
  assert.equal(roots.categories.length, 1);
  assert.equal(requestedUrl.searchParams.get("retailer_id"), "eq.vkusvill");
  assert.equal(requestedUrl.searchParams.get("store_id"), "eq.vkusvill-public-web");

  const catalog = await client.browseCategory(920006, { limit: 20 });
  assert.equal(catalog.kind, "catalog");
  assert.equal(catalog.products.length, 1);
  assert.equal(
    requestedUrl.searchParams.get("locality_id"),
    "eq.country-ru-public-catalog"
  );
  assert.equal(requestedUrl.searchParams.get("main_category_id"), "eq.920006");
});


function perekrestokRow(overrides = {}) {
  return {
    retailer_id: "perekrestok",
    store_id: "perekrestok-yandex-3186917",
    store_name:
      "Перекрёсток · Москва, Большой Овчинниковский пер. 16 · Яндекс Еда",
    locality_id: "city-moscow",
    locality_name: "Москва",
    source_product_id: "62e2fc67-211d-485a-bd85-01ff6a40a53b",
    name:
      "Напиток молочный Пармалат Спокойной ночи безлактозный Липа 1.8% 1000 мл",
    price_minor: 15000,
    currency: "RUB",
    price_condition: "yandex-eda-promo",
    availability: "unknown",
    product_url:
      "https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w",
    image_url:
      "https://avatars.mds.yandex.net/get-eda/17742006/ac31f470aa6f9aa2cde56fc30ed66e70/500x500",
    weight_text: "1 л",
    main_category_id: 2910,
    source_url:
      "https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w",
    observed_at: "2026-10-02T17:06:07.257Z",
    ...overrides
  };
}

test("normalizes exact-store Perekrestok Yandex delivery price without stock inference", () => {
  assert.deepEqual(
    normalizeRetailRow(perekrestokRow(), "perekrestok"),
    {
      id:
        "retail:perekrestok:perekrestok-yandex-3186917:62e2fc67-211d-485a-bd85-01ff6a40a53b",
      name:
        "Напиток молочный Пармалат Спокойной ночи безлактозный Липа 1.8% 1000 мл",
      unit: "1 л",
      category: "Перекрёсток · Москва · Яндекс Еда",
      catalogSource: "perekrestok",
      catalogDisplayOnly: true,
      retailerId: "perekrestok",
      retailerDisplayName: "Перекрёсток",
      storeName:
        "Перекрёсток · Москва, Большой Овчинниковский пер. 16 · Яндекс Еда",
      sourceProductId: "62e2fc67-211d-485a-bd85-01ff6a40a53b",
      priceMinor: 15000,
      currency: "RUB",
      priceCondition: "yandex-eda-promo",
      priceConditionLabel: "Промо-цена доставки Яндекс Еды",
      availability: "unknown",
      mainCategoryId: 2910,
      imageUrl:
        "https://avatars.mds.yandex.net/get-eda/17742006/ac31f470aa6f9aa2cde56fc30ed66e70/500x500",
      sourceUrl:
        "https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w",
      productUrl:
        "https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w",
      observedAt: "2026-10-02T17:06:07.257Z"
    }
  );
});

test("Perekrestok adapter rejects wrong scope, stock claims and foreign URLs", () => {
  assert.equal(
    normalizeRetailRow(
      perekrestokRow({ store_id: "other" }),
      "perekrestok"
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      perekrestokRow({ availability: "available" }),
      "perekrestok"
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      perekrestokRow({ product_url: "https://example.com/x" }),
      "perekrestok"
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      perekrestokRow({ image_url: "https://example.com/x.jpg" }),
      "perekrestok"
    )?.imageUrl,
    null
  );
});

function perekrestokCategoryRow(overrides = {}) {
  return {
    retailer_id: "perekrestok",
    store_id: "perekrestok-yandex-3186917",
    category_id: 2910,
    name: "Молоко, яйца",
    parent_id: null,
    root_id: 2910,
    depth: 0,
    source_url:
      "https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w",
    product_count: 419,
    ...overrides
  };
}

test("Perekrestok category reads stay pinned to the Yandex delivery store binding", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    retailerId: "perekrestok",
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    categoryEndpoint:
      "https://project.supabase.co/rest/v1/retail_catalog_categories",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      const payload = requestedUrl.pathname.includes("categories")
        ? [perekrestokCategoryRow()]
        : [perekrestokRow()];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const roots = await client.rootCategories();
  assert.equal(roots.kind, "categories");
  assert.equal(roots.categories.length, 1);
  assert.equal(requestedUrl.searchParams.get("retailer_id"), "eq.perekrestok");
  assert.equal(
    requestedUrl.searchParams.get("store_id"),
    "eq.perekrestok-yandex-3186917"
  );
  assert.equal(requestedUrl.searchParams.get("limit"), "58");

  const products = await client.browseCategory(2910, { limit: 20 });
  assert.equal(products.kind, "catalog");
  assert.equal(products.products.length, 1);
  assert.equal(requestedUrl.searchParams.get("locality_id"), "eq.city-moscow");
  assert.equal(requestedUrl.searchParams.get("main_category_id"), "eq.2910");
});


function daRow(overrides = {}) {
  return {
    retailer_id: "da",
    store_id: "da-public-promo",
    store_name: "ДА! · публичный промо-каталог",
    locality_id: "network-da-public-promo",
    locality_name: "Сеть ДА!",
    source_product_id: "2026-10-01-da-59",
    name: "Голень куриная Семь Холмов",
    price_minor: 24990,
    currency: "RUB",
    price_condition: "public-promo",
    minimum_quantity: 1,
    quantity_semantics: {
      promo_valid_from: "2026-10-01",
      promo_valid_to: "2026-10-07"
    },
    availability: "unknown",
    product_url: "https://market-da.ru/sale.html",
    image_url:
      "https://market-da.ru/assets/cache/images/producti_pics/2026/10/01/140x140-da-59.f41.jpg",
    weight_text: "1 кг *С 1 по 7 октября",
    main_category_id: 940001,
    source_url: "https://market-da.ru/sale.html",
    observed_at: "2026-10-02T17:50:18.151Z",
    ...overrides
  };
}

function daCategoryRow(overrides = {}) {
  return {
    retailer_id: "da",
    store_id: "da-public-promo",
    category_id: 940001,
    name: "Текущий промо-каталог",
    parent_id: null,
    root_id: 940001,
    depth: 0,
    source_url: "https://market-da.ru/sale.html",
    product_count: 94,
    ...overrides
  };
}

test("normalizes current DA public promo price and exposes its end date", () => {
  const product = normalizeRetailRow(
    daRow(),
    "da",
    { nowMs: Date.parse("2026-10-02T12:00:00.000Z") }
  );

  assert.equal(product?.id, "retail:da:da-public-promo:2026-10-01-da-59");
  assert.equal(product?.retailerDisplayName, "ДА!");
  assert.equal(product?.priceMinor, 24990);
  assert.equal(product?.priceCondition, "public-promo");
  assert.equal(
    product?.priceConditionLabel,
    "Промо-цена каталога · до 07.10"
  );
  assert.equal(product?.availability, "unknown");
  assert.match(product?.imageUrl ?? "", /^https:\/\/market-da\.ru\/assets\//);
});

test("DA promo rows fail closed before or after their proven validity window", () => {
  assert.equal(
    normalizeRetailRow(
      daRow(),
      "da",
      { nowMs: Date.parse("2026-09-30T12:00:00.000Z") }
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      daRow(),
      "da",
      { nowMs: Date.parse("2026-10-08T12:00:00.000Z") }
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      daRow({ quantity_semantics: {} }),
      "da",
      { nowMs: Date.parse("2026-10-02T12:00:00.000Z") }
    ),
    null
  );
});

test("DA multibuy and weight-basis conditions remain visible with the observed price", () => {
  const multibuy = normalizeRetailRow(
    daRow({
      source_product_id: "2026-10-01-da-48",
      name: "Мороженое пломбир Село Зеленое",
      price_minor: 4495,
      minimum_quantity: 2,
      quantity_semantics: {
        kind: "multibuy",
        minimum_quantity: 2,
        promo_valid_from: "2026-10-01",
        promo_valid_to: "2026-10-14"
      }
    }),
    "da",
    { nowMs: Date.parse("2026-10-02T12:00:00.000Z") }
  );
  assert.equal(
    multibuy?.priceConditionLabel,
    "Промо-цена каталога · при покупке 2 шт. · до 14.10"
  );

  const weighted = normalizeRetailRow(
    daRow({
      minimum_quantity: 1,
      quantity_semantics: {
        kind: "weight-basis",
        basis_grams: 100,
        promo_valid_from: "2026-10-01",
        promo_valid_to: "2026-10-14"
      }
    }),
    "da",
    { nowMs: Date.parse("2026-10-02T12:00:00.000Z") }
  );
  assert.equal(
    weighted?.priceConditionLabel,
    "Промо-цена каталога · за 100 г · до 14.10"
  );
});

test("DA client stays scoped to the public network promo binding", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    retailerId: "da",
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    categoryEndpoint:
      "https://project.supabase.co/rest/v1/retail_catalog_categories",
    publishableKey: "publishable-test",
    nowMs: Date.parse("2026-10-02T12:00:00.000Z"),
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      const payload = requestedUrl.pathname.includes("categories")
        ? [daCategoryRow()]
        : [daRow()];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const roots = await client.rootCategories();
  assert.equal(roots.kind, "categories");
  assert.equal(roots.categories.length, 1);
  assert.equal(requestedUrl.searchParams.get("retailer_id"), "eq.da");
  assert.equal(requestedUrl.searchParams.get("store_id"), "eq.da-public-promo");
  assert.equal(requestedUrl.searchParams.get("limit"), "40");

  const products = await client.browseCategory(940001, { limit: 20 });
  assert.equal(products.kind, "catalog");
  assert.equal(products.products.length, 1);
  assert.equal(
    requestedUrl.searchParams.get("locality_id"),
    "eq.network-da-public-promo"
  );
  assert.equal(requestedUrl.searchParams.get("main_category_id"), "eq.940001");
  assert.match(
    requestedUrl.searchParams.get("select") ?? "",
    /minimum_quantity/
  );
  assert.match(
    requestedUrl.searchParams.get("select") ?? "",
    /quantity_semantics/
  );
});

test('DA connects a later explicitly dated issue without admitting old, future or undated offers', async () => {
  assert.ok(RETAIL_CATALOG_IDS.includes('da'));
  const definition = getRetailCatalogDefinition('da');
  assert.equal(definition.requiresPromoValidity, true);
  assert.equal(definition.catalogValidTo, undefined);
  assert.equal(definition.defaultProductCount, null);
  assert.doesNotMatch(definition.scopeLabel, /1–14|октябр/u);
  const current = daRow({ source_product_id: '2026-10-20-da-59', observed_at: '2026-10-22T11:00:00.000Z',
    quantity_semantics: { promo_valid_from: '2026-10-20', promo_valid_to: '2026-11-02' } });
  const client = createRetailCatalogClient({ retailerId: 'da', nowMs: Date.parse('2026-10-22T12:00:00.000Z'),
    includeComparisonEvidence: true, fetchImpl: async () => Response.json([daRow(), current,
      daRow({ quantity_semantics: {} }), daRow({ quantity_semantics: { promo_valid_from: '2026-10-23', promo_valid_to: '2026-11-02' } })]) });
  const result = await client.search('голень');
  assert.equal(result.kind, 'catalog'); assert.equal(result.products.length, 1);
  const product = result.products[0];
  assert.equal(product.sourceProductId, '2026-10-20-da-59');
  assert.equal(product.priceMinor, 24990); assert.equal(product.availability, 'unknown');
  assert.equal(product.catalogDisplayOnly, true); assert.equal(product.comparisonEvidence, undefined);
  assert.equal(product.basketProductId, undefined); assert.match(product.priceConditionLabel, /до 02\.11/u);
});


function auchanRow(overrides = {}) {
  return {
    retailer_id: "auchan",
    store_id: "auchan-msk-public-promo",
    store_name: "АШАН · Москва · публичный промо-каталог",
    locality_id: "city-moscow-promo",
    locality_name: "Москва",
    source_product_id: "promo-20261001-p04-01",
    name: "Сардельки МЯСНИЦКИЙ РЯД Каждому по вкусу, 360 г",
    price_minor: 13999,
    currency: "RUB",
    price_condition: "auchan-card-multibuy",
    minimum_quantity: 2,
    quantity_semantics: {
      kind: "multibuy",
      minimum_quantity: 2,
      requires_loyalty_card: "АШАН",
      article_ids: ["231891"],
      promo_valid_from: "2026-10-01",
      promo_valid_to: "2026-10-14"
    },
    availability: "unknown",
    product_url: "https://catalog.auchan.ru/60z9R061p97677",
    image_url: null,
    weight_text: null,
    main_category_id: 950001,
    source_url: "https://catalog.auchan.ru/60z9R061p97677",
    observed_at: "2026-10-02T16:56:31.480Z",
    ...overrides
  };
}

function auchanCategoryRow(overrides = {}) {
  return {
    retailer_id: "auchan",
    store_id: "auchan-msk-public-promo",
    category_id: 950001,
    name: "Промо 1–14 октября",
    parent_id: null,
    root_id: 950001,
    depth: 0,
    source_url: "https://catalog.auchan.ru/60z9R061p97677",
    product_count: 312,
    ...overrides
  };
}

test("normalizes current Auchan Moscow card multibuy without inventing stock or image", () => {
  const product = normalizeRetailRow(
    auchanRow(),
    "auchan",
    { nowMs: Date.parse("2026-10-02T12:00:00.000Z") }
  );

  assert.equal(
    product?.id,
    "retail:auchan:auchan-msk-public-promo:promo-20261001-p04-01"
  );
  assert.equal(product?.retailerDisplayName, "АШАН");
  assert.equal(product?.priceMinor, 13999);
  assert.equal(product?.priceCondition, "auchan-card-multibuy");
  assert.equal(
    product?.priceConditionLabel,
    "По карте АШАН · при покупке 2 шт. · до 14.10"
  );
  assert.equal(product?.availability, "unknown");
  assert.equal(product?.imageUrl, null);
  assert.equal(
    product?.sourceUrl,
    "https://catalog.auchan.ru/60z9R061p97677"
  );
});

test("Auchan promo rows fail closed outside the proven window or with lost scope truth", () => {
  assert.equal(
    normalizeRetailRow(
      auchanRow(),
      "auchan",
      { nowMs: Date.parse("2026-10-15T12:00:00.000Z") }
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      auchanRow({ quantity_semantics: {} }),
      "auchan",
      { nowMs: Date.parse("2026-10-02T12:00:00.000Z") }
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      auchanRow({ locality_id: "country-ru-public-catalog" }),
      "auchan",
      { nowMs: Date.parse("2026-10-02T12:00:00.000Z") }
    ),
    null
  );
  assert.equal(
    normalizeRetailRow(
      auchanRow({ availability: "available" }),
      "auchan",
      { nowMs: Date.parse("2026-10-02T12:00:00.000Z") }
    ),
    null
  );
});

test("Auchan client stays scoped to the dated Moscow promo binding", async () => {
  let requestedUrl;
  const client = createRetailCatalogClient({
    retailerId: "auchan",
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    categoryEndpoint:
      "https://project.supabase.co/rest/v1/retail_catalog_categories",
    publishableKey: "publishable-test",
    nowMs: Date.parse("2026-10-02T12:00:00.000Z"),
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      const payload = requestedUrl.pathname.includes("categories")
        ? [auchanCategoryRow()]
        : [auchanRow()];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const roots = await client.rootCategories();
  assert.equal(roots.kind, "categories");
  assert.equal(roots.categories.length, 1);
  assert.equal(requestedUrl.searchParams.get("retailer_id"), "eq.auchan");
  assert.equal(
    requestedUrl.searchParams.get("store_id"),
    "eq.auchan-msk-public-promo"
  );

  const products = await client.browseCategory(950001, { limit: 20 });
  assert.equal(products.kind, "catalog");
  assert.equal(products.products.length, 1);
  assert.equal(
    requestedUrl.searchParams.get("locality_id"),
    "eq.city-moscow-promo"
  );
  assert.equal(requestedUrl.searchParams.get("main_category_id"), "eq.950001");
});


test("Magnit client can be bound to a directory-verified Moscow address", async () => {
  const store = {
    shopCode: "303857",
    address: "119600, Москва г, 3 кв-л, дом № 6, корпус 1"
  };
  const exactRow = magnitRow({
    store_id: "magnit-303857",
    store_name: "Магнит · " + store.address,
    product_url:
      "https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=303857&shopType=1",
    source_url:
      "https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=303857&shopType=1"
  });
  let requestedUrl;
  const client = createRetailCatalogClient({
    retailerId: "magnit",
    store,
    endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
    publishableKey: "publishable-test",
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify([exactRow]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.search("молоко", { limit: 8 });
  assert.equal(result.kind, "catalog");
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].id, "retail:magnit:magnit-303857:1899800733");
  assert.equal(result.products[0].storeName, "Магнит · " + store.address);
  assert.equal(requestedUrl.searchParams.get("store_id"), "eq.magnit-303857");
  assert.equal(requestedUrl.searchParams.get("locality_id"), "eq.city-moscow");

  const wrongStore = normalizeRetailRow({
    ...exactRow,
    product_url: exactRow.product_url.replace("shopCode=303857", "shopCode=771878")
  }, { retailerId: "magnit", store: { ...store } });
  assert.equal(wrongStore, null);
});

test("Magnit client refuses addresses that do not match the official directory", () => {
  const client = createRetailCatalogClient({
    retailerId: "magnit",
    store: { shopCode: "303857", address: "Москва, выдуманный адрес" }
  });
  assert.equal(client.definition, null);
  assert.equal(client.definition, null);
});
