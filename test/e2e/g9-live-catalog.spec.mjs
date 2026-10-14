import { expect, test } from "@playwright/test";

function globusFixtureJson(value) {
  function migrate(row) {
    if (Array.isArray(row)) return row.map(migrate);
    if (!row || typeof row !== "object") return row;
    if (row.retailer_id !== "globus" || row.store_id !== "globus-store-5011") return row;
    if (!row.source_product_id) return row;
    const source = row.source_url?.includes("/catalog/") ? row.source_url
      : "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965";
    return { ...row, sales_channel: "store", scope_binding: "same-source", binding_id: "store:5011",
      location_label: "г. Москва, вн.тер.г. муниципальный округ Кунцево, Новорижское шоссе 22-й км, д. 1 стр. 1",
      source_url: source, scope_evidence_url: source };
  }
  return JSON.stringify(migrate(value));
}

const LIVE_MILK = {
  code: "4690363062485",
  product_name: "Молоко ультрапастеризованное",
  quantity: "1 l",
  brands: ["Каждый день"],
  categories: "Молочные продукты, Молоко"
};

function catalogPayload(products, partial = false) {
  return {
    kind: "catalog",
    partial,
    products
  };
}

async function routeRetailCatalog(page, rows = [], status = 200) {
  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(status === 200 ? rows : { code: "source_unavailable" })
    });
  });
}

async function routeRetailCategories(page) {
  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");
    let rows = [];

    if (depth === "eq.0") {
      rows = [{
        retailer_id: "globus",
        store_id: "globus-store-5011",
        category_id: 10118965,
        name: "Молочные продукты, сыр, яйца",
        parent_id: null,
        root_id: 10118965,
        depth: 0,
        source_url:
          "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965",
        product_count: 120
      }];
    } else if (parentId === "eq.10118965") {
      rows = [{
        retailer_id: "globus",
        store_id: "globus-store-5011",
        category_id: 2978998,
        name: "Молоко и молочные продукты",
        parent_id: 10118965,
        root_id: 10118965,
        depth: 1,
        source_url:
          "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965/moloko-i-molochnye-produkty-2978998",
        product_count: 65
      }];
    } else if (parentId === "eq.2978998") {
      rows = [{
        retailer_id: "globus",
        store_id: "globus-store-5011",
        category_id: 3979002,
        name: "Молоко",
        parent_id: 2978998,
        root_id: 10118965,
        depth: 2,
        source_url:
          "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965/moloko-i-molochnye-produkty-2978998/moloko-3979002",
        product_count: 18
      }];
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });
}

async function routeLiveCatalog(page, products = [LIVE_MILK]) {
  await page.route("**/functions/v1/catalog-search", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(catalogPayload(products))
    });
  });
}

test("manual search uses live catalog and adds confirmed GTIN identity", async ({ page }) => {
  await routeLiveCatalog(page);
  await routeRetailCatalog(page);
  await page.goto("/");

  const search = page.locator("#product-search");
  await search.fill("молоко");
  await search.press("Enter");

  await expect(page.locator("#catalog-eyebrow")).toHaveText(
    "Живой каталог · Open Food Facts"
  );
  await expect(page.locator("#catalog-note")).toContainText(
    "не подтверждает цену или наличие"
  );

  const card = page.locator('[data-product-id="gtin-04690363062485"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("Молоко ультрапастеризованное");
  await expect(card).toContainText("1 l");
  await expect(card).toContainText("Каталог · не наличие");
  await expect(card).not.toContainText("Тестовый товар");

  await card.getByRole("button", { name: /Добавить Молоко ультрапастеризованное/ }).click();
  await expect(page.locator("#basket-dock-copy")).toContainText("1 шт. · 1 поз.");
});

test("AI proposal receives exactly the confirmed identities from the live catalog", async ({ page }) => {
  await routeLiveCatalog(page);
  await routeRetailCatalog(page);

  let proposalRequest;
  await page.route("**/functions/v1/ai-basket-proposal", async (route) => {
    proposalRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson({
        kind: "proposal",
        proposal: {
          items: [{
            productId: "gtin-04690363062485",
            quantity: 2
          }]
        }
      })
    });
  });

  await page.goto("/");
  await page.locator("#basket-proposal-input").fill("посоветуй молоко");
  await page.locator("#basket-proposal-submit").click();

  await expect(page.locator("#basket-proposal-status")).toContainText(
    "Собрала вариант."
  );

  expect(proposalRequest).toEqual({
    text: "посоветуй молоко",
    catalog: [{
      id: "gtin-04690363062485",
      name: "Молоко ультрапастеризованное",
      unit: "1 l"
    }]
  });

  await page.getByRole("button", { name: "Добавить предложенное" }).click();
  await expect(page.locator("#basket-proposal-status")).toContainText(
    "Молоко ультрапастеризованное ×2"
  );
  await expect(page.locator("#basket-dock-copy")).toContainText("2 шт. · 1 поз.");
});

test("manual basket mutation invalidates a pending AI proposal before it can merge", async ({ page }) => {
  await routeLiveCatalog(page);
  await routeRetailCatalog(page);

  let releaseProposal;
  let proposalCalls = 0;
  const proposalGate = new Promise((resolve) => {
    releaseProposal = resolve;
  });

  await page.route("**/functions/v1/ai-basket-proposal", async (route) => {
    proposalCalls += 1;
    await proposalGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson({
        kind: "proposal",
        proposal: {
          items: [{
            productId: "gtin-04690363062485",
            quantity: 2
          }]
        }
      })
    });
  });

  await page.goto("/");
  await page.locator("#basket-proposal-input").fill("посоветуй молоко");
  await page.locator("#basket-proposal-submit").click();

  await expect.poll(() => proposalCalls).toBe(1);

  const search = page.locator("#product-search");
  await search.fill("молоко");
  await search.press("Enter");

  const card = page.locator('[data-product-id="gtin-04690363062485"]');
  await expect(card).toBeVisible();
  await card.getByRole("button", {
    name: /Добавить Молоко ультрапастеризованное/
  }).click();

  await expect(page.locator("#basket-dock-copy")).toContainText("1 шт. · 1 поз.");

  releaseProposal();

  await expect(page.locator("#basket-proposal-submit")).toBeEnabled();
  await expect(page.locator("#basket-dock-copy")).toContainText("1 шт. · 1 поз.");
  await expect(page.locator("#basket-proposal-status")).not.toContainText(
    "Корзина обновлена"
  );
});

test("catalog outage falls back explicitly to DEMO manual search without stale live products", async ({ page }) => {
  await page.route("**/functions/v1/catalog-search", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson({
        kind: "unavailable",
        code: "source_unavailable"
      })
    });
  });
  await routeRetailCatalog(page, [], 503);

  await page.goto("/");
  const search = page.locator("#product-search");
  await search.fill("молоко");
  await search.press("Enter");

  await expect(page.locator("#catalog-eyebrow")).toHaveText("Демо-каталог");
  await expect(page.locator("#catalog-note")).toContainText(
    "DEMO · MOCK fallback"
  );
  await expect(page.locator('[data-product-id="milk-25-900"]')).toBeVisible();
  await expect(page.locator('[data-product-id^="gtin-"]')).toHaveCount(0);
});

test("live catalog rows without confirmed package identity are not addable", async ({ page }) => {
  await routeLiveCatalog(page, [
    {
      code: "4607951981028",
      product_name: "Яйца куриные, столовые, C0",
      brands: ["Селяночка"]
    }
  ]);
  await routeRetailCatalog(page);

  await page.goto("/");
  const search = page.locator("#product-search");
  await search.fill("яйца");
  await search.press("Enter");

  await expect(page.locator("#catalog-eyebrow")).toHaveText(
    "Живой каталог · Open Food Facts"
  );
  await expect(page.locator("#product-grid")).toBeHidden();
  await expect(page.locator("#empty-search")).toBeVisible();
  await expect(page.locator("#empty-search-copy")).toContainText(
    "без подтверждённого штрихкода и размера упаковки"
  );
  await expect(page.getByRole("button", { name: /Добавить/ })).toHaveCount(0);
});


test("manual search displays sourced GLOBUS observation without enabling comparison", async ({ page }) => {
  await routeLiveCatalog(page, []);
  await routeRetailCatalog(page, [{
    retailer_id: "globus",
    store_id: "globus-store-5011",
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
    observed_at: "2026-09-30T21:10:31.368Z"
  }]);

  await page.goto("/");
  const search = page.locator("#product-search");
  await search.fill("молоко");
  await search.press("Enter");

  await expect(page.locator("#catalog-eyebrow")).toHaveText(
    "Живой каталог · Глобус + Open Food Facts"
  );
  const card = page.locator(
    '[data-product-id="retail:globus:globus-store-5011:000000000000446051_ST"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("122,99 ₽");
  await expect(card).toContainText("Глобус Красногорск · источник");
  await expect(card.getByRole("link", { name: /источник/ })).toHaveAttribute(
    "href",
    "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965"
  );
  await expect(card.getByRole("button")).toBeDisabled();
});

test("rapid identical live-search submits share one catalog request", async ({ page }) => {
  await routeRetailCatalog(page);
  let calls = 0;
  let release;
  const responseGate = new Promise((resolve) => {
    release = resolve;
  });

  await page.route("**/functions/v1/catalog-search", async (route) => {
    calls += 1;
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(catalogPayload([LIVE_MILK]))
    });
  });

  await page.goto("/");
  await page.locator("#product-search").fill("молоко");

  await page.locator("#search-form").evaluate((form) => {
    for (let index = 0; index < 10; index += 1) {
      form.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true
      }));
    }
  });

  await expect.poll(() => calls).toBe(1);
  release();

  await expect(page.locator("#catalog-eyebrow")).toHaveText(
    "Живой каталог · Open Food Facts"
  );
  expect(calls).toBe(1);
});

test("changed live-search query supersedes a slower older response", async ({ page }) => {
  await routeRetailCatalog(page);
  let releaseMilk;
  const milkGate = new Promise((resolve) => {
    releaseMilk = resolve;
  });

  await page.route("**/functions/v1/catalog-search", async (route) => {
    const body = route.request().postDataJSON();
    const query = body.queries?.[0];

    if (query === "молоко") {
      await milkGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: globusFixtureJson(catalogPayload([LIVE_MILK]))
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(catalogPayload([{
        code: "4820096260012",
        product_name: "Макароны",
        quantity: "450 г",
        brands: ["Тая"],
        categories: "Бакалея"
      }]))
    });
  });

  await page.goto("/");
  const search = page.locator("#product-search");

  await search.fill("молоко");
  await search.press("Enter");

  await search.fill("макароны");
  await search.press("Enter");

  await expect(
    page.locator('[data-product-id="gtin-04820096260012"]')
  ).toBeVisible();

  releaseMilk();

  await expect(
    page.locator('[data-product-id="gtin-04820096260012"]')
  ).toBeVisible();
  await expect(
    page.locator('[data-product-id="gtin-04690363062485"]')
  ).toHaveCount(0);
});


test("public observed shop opens with real GLOBUS products instead of demo pixel catalogue", async ({ page }) => {
  await routeLiveCatalog(page, []);
  await routeRetailCatalog(page, [{
    retailer_id: "globus",
    store_id: "globus-store-5011",
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
    observed_at: "2026-09-30T21:10:31.368Z"
  }]);

  await page.route("https://image.globus.ru/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  await expect(page.locator("#catalog-eyebrow")).toHaveText(
    "Живой каталог · Глобус"
  );
  const card = page.locator(
    '[data-product-id="retail:globus:globus-store-5011:000000000000446051_ST"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("Молоко Село Зелёное");
  await expect(card).toContainText("122,99 ₽");
  await expect(card.locator("img.product-photo")).toBeVisible();
  await expect(page.locator('[data-product-id^="milk-25-900"]')).toHaveCount(0);
});


test("store category path drills from GLOBUS to subcategory to real product", async ({ page }) => {
  await routeLiveCatalog(page, []);
  await routeRetailCategories(page);

  const milkRow = {
    retailer_id: "globus",
    store_id: "globus-store-5011",
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
    observed_at: "2026-09-30T21:10:31.368Z"
  };

  const rootOnlyRow = {
    ...milkRow,
    source_product_id: "globus-root-unmapped",
    name: "Товар Глобус с внутренней категорией",
    product_url: "https://www.globus.ru/products/root-unmapped/",
    main_category_id: 3220331
  };
  const rootRows = Array.from({ length: 120 }, (_, index) => (
    index === 0
      ? rootOnlyRow
      : {
          ...rootOnlyRow,
          source_product_id: `globus-root-unmapped-${index}`,
          name: `Товар Глобус root page ${String(index + 1).padStart(3, "0")}`,
          product_url: `https://www.globus.ru/products/root-unmapped-${index}/`
        }
  ));
  let rootSourceReads = 0;

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const categoryId = url.searchParams.get("main_category_id");
    const categoryUrl = url.searchParams.get("category_url");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    let rows;
    if (
      categoryUrl
      === "like.https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965*"
    ) {
      rootSourceReads += 1;
      rows = rootRows.slice(offset, offset + 40);
    } else {
      rows = categoryId && categoryId !== "eq.3979002"
        ? []
        : [milkRow];
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("https://image.globus.ru/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  await expect(page.locator("#retail-store-card")).toContainText(
    "Глобус Красногорск"
  );
  await expect(
    page.getByRole("button", { name: /Молочные продукты, сыр, яйца/ })
  ).toBeVisible();

  await page.getByRole(
    "button",
    { name: /Молочные продукты, сыр, яйца/ }
  ).click();
  await expect(
    page.getByRole("button", { name: /Молоко и молочные продукты/ })
  ).toBeVisible();
  await expect.poll(() => rootSourceReads).toBe(1);
  const rootFallbackCard = page.locator(
    '[data-product-id="retail:globus:globus-store-5011:globus-root-unmapped"]'
  );
  await expect(rootFallbackCard).toBeVisible();
  await expect(rootFallbackCard).toContainText(
    "Товар Глобус с внутренней категорией"
  );
  await expect(page.locator("#product-grid .product-card")).toHaveCount(40);
  await expect(page.locator("#search-status")).toHaveText(
    "Показано товаров: 40 из 120"
  );

  const loadMore = page.locator("#retail-load-more");
  await expect(loadMore).toBeVisible();
  await expect(loadMore).toHaveText("Показать ещё");
  await loadMore.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect.poll(() => rootSourceReads).toBe(2);
  await expect(page.locator("#product-grid .product-card")).toHaveCount(80);

  await page.locator("#retail-load-more").click();
  await expect.poll(() => rootSourceReads).toBe(3);
  await expect(page.locator("#product-grid .product-card")).toHaveCount(120);
  await expect(page.locator("#retail-load-more")).toHaveCount(0);

  await page.getByRole(
    "button",
    { name: /Молоко и молочные продукты/ }
  ).click();
  await expect(rootFallbackCard).toHaveCount(0);
  const categoryGrid = page.locator("#retail-category-grid");
  await expect(
    categoryGrid.getByRole("button", { name: /^Молоко(?:\s|$)/ })
  ).toBeVisible();

  await categoryGrid.getByRole(
    "button",
    { name: /^Молоко(?:\s|$)/ }
  ).click();

  const card = page.locator(
    '[data-product-id="retail:globus:globus-store-5011:000000000000446051_ST"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("122,99 ₽");
  await expect(card.locator("img.product-photo")).toBeVisible();
  await expect(page.locator("#catalog-note")).toContainText("Молоко");
});


test("retail catalog owns stale requests, browser history and large mobile-safe category switches", async ({ page }) => {
  await routeLiveCatalog(page, []);

  let releaseDairyChildren;
  let dairyChildrenCalls = 0;
  let dairyChildrenFulfilled = 0;
  const dairyChildrenGate = new Promise((resolve) => {
    releaseDairyChildren = resolve;
  });

  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");
    let rows = [];

    if (depth === "eq.0") {
      rows = [
        {
          retailer_id: "globus",
          store_id: "globus-store-5011",
          category_id: 10118965,
          name: "Молочные продукты, сыр, яйца",
          parent_id: null,
          root_id: 10118965,
          depth: 0,
          source_url: "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965",
          product_count: 120
        },
        {
          retailer_id: "globus",
          store_id: "globus-store-5011",
          category_id: 20100001,
          name: "Хлеб и выпечка",
          parent_id: null,
          root_id: 20100001,
          depth: 0,
          source_url: "https://www.globus.ru/catalog/hleb-i-vypechka-20100001",
          product_count: 96
        },
        {
          retailer_id: "globus",
          store_id: "globus-store-5011",
          category_id: 30100001,
          name: "Пустой раздел",
          parent_id: null,
          root_id: 30100001,
          depth: 0,
          source_url: "https://www.globus.ru/catalog/pustoj-razdel-30100001",
          product_count: 0
        }
      ];
    } else if (parentId === "eq.10118965") {
      dairyChildrenCalls += 1;
      if (dairyChildrenCalls === 1) {
        await dairyChildrenGate;
      }
      rows = [{
        retailer_id: "globus",
        store_id: "globus-store-5011",
        category_id: 2978998,
        name: "Молоко и молочные продукты",
        parent_id: 10118965,
        root_id: 10118965,
        depth: 1,
        source_url: "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965/moloko-i-molochnye-produkty-2978998",
        product_count: 65
      }];
      dairyChildrenFulfilled += 1;
    } else if (parentId === "eq.2978998") {
      rows = [{
        retailer_id: "globus",
        store_id: "globus-store-5011",
        category_id: 3979002,
        name: "Молоко",
        parent_id: 2978998,
        root_id: 10118965,
        depth: 2,
        source_url: "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965/moloko-i-molochnye-produkty-2978998/moloko-3979002",
        product_count: 18
      }];
    } else if (parentId === "eq.20100001") {
      rows = [{
        retailer_id: "globus",
        store_id: "globus-store-5011",
        category_id: 5002001,
        name: "Хлеб",
        parent_id: 20100001,
        root_id: 20100001,
        depth: 1,
        source_url: "https://www.globus.ru/catalog/hleb-i-vypechka-20100001/hleb-5002001",
        product_count: 35
      }];
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  const milkRow = {
    retailer_id: "globus",
    store_id: "globus-store-5011",
    store_name: "Глобус Красногорск",
    locality_id: "city-moscow",
    locality_name: "Москва",
    source_product_id: "milk-stale-proof",
    name: "Молоко тест стабильности 950 мл",
    price_minor: 12300,
    currency: "RUB",
    price_condition: "regular",
    availability: "unknown",
    product_url: "https://www.globus.ru/products/moloko-stability/",
    image_url: "https://image.globus.ru/mobile/stability/milk.png",
    weight_text: "950 мл",
    main_category_id: 3979002,
    observed_at: "2026-10-01T08:00:00.000Z"
  };

  const breadRows = Array.from({ length: 35 }, (_, index) => ({
    retailer_id: "globus",
    store_id: "globus-store-5011",
    store_name: "Глобус Красногорск",
    locality_id: "city-moscow",
    locality_name: "Москва",
    source_product_id: `bread-stability-${index}`,
    name: index === 0
      ? "Хлеб ремесленный цельнозерновой с семенами подсолнечника и льна очень длинное название упаковки 500 г"
      : `Хлеб тест стабильности ${index + 1}`,
    price_minor: 9000 + index,
    currency: "RUB",
    price_condition: "regular",
    availability: "unknown",
    product_url: `https://www.globus.ru/products/bread-stability-${index}/`,
    image_url: index === 0
      ? null
      : index === 1
        ? "https://image.globus.ru/broken-stability.jpg"
        : `https://image.globus.ru/mobile/stability/bread-${index}.png`,
    weight_text: "500 г",
    main_category_id: 5002001,
    observed_at: "2026-10-01T08:00:00.000Z"
  }));

  let releaseMilkProducts;
  let milkProductCalls = 0;
  let milkProductFulfilled = 0;
  const milkProductGate = new Promise((resolve) => {
    releaseMilkProducts = resolve;
  });

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const categoryId = url.searchParams.get("main_category_id");
    const categoryUrl = url.searchParams.get("category_url");
    let rows;

    if (categoryId === "eq.3979002") {
      milkProductCalls += 1;
      if (milkProductCalls === 1) {
        await milkProductGate;
      }
      rows = [milkRow];
      milkProductFulfilled += 1;
    } else if (categoryId === "eq.5002001") {
      rows = breadRows;
    } else if (
      categoryUrl
      === "like.https://www.globus.ru/catalog/pustoj-razdel-30100001*"
    ) {
      rows = [];
    } else if (categoryId || categoryUrl) {
      // Root-category requests now use the trusted category_url prefix.
      // Keep the mock explicit so an unrelated root never invents products.
      rows = [];
    } else {
      // Deliberately show one product on initial browse. Entering a category
      // must remove it immediately rather than letting an old card linger.
      rows = [milkRow];
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("https://image.globus.ru/**", async (route) => {
    if (route.request().url().includes("broken-stability")) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const productGrid = page.locator("#product-grid");
  const categoryGrid = page.locator("#retail-category-grid");
  const milkCard = page.locator(
    '[data-product-id="retail:globus:globus-store-5011:milk-stale-proof"]'
  );

  await expect(milkCard).toBeVisible();

  const dairyRoot = categoryGrid.getByRole("button", {
    name: /Молочные продукты, сыр, яйца/
  });
  await expect(dairyRoot).toBeVisible();

  // A detached-node double tap must still own exactly one request.
  await dairyRoot.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect.poll(() => dairyChildrenCalls).toBe(1);
  await expect(milkCard).toHaveCount(0);

  // Back during the delayed request supersedes it. The late response must
  // never repaint the old child path.
  await page.locator("#retail-category-back").click();
  await expect(page.locator("#retail-category-title")).toHaveText("Категории");
  await expect(dairyRoot).toBeVisible();

  releaseDairyChildren();
  await expect.poll(() => dairyChildrenFulfilled).toBe(1);
  await expect(page.locator("#retail-category-title")).toHaveText("Категории");
  await expect(
    categoryGrid.getByRole("button", { name: /Молоко и молочные продукты/ })
  ).toHaveCount(0);

  // Normal drill after the stale response was discarded.
  await dairyRoot.click();
  await categoryGrid.getByRole("button", {
    name: /Молоко и молочные продукты/
  }).click();
  const milkLeaf = categoryGrid.getByRole("button", {
    name: /^Молоко(?:\s|$)/
  });
  await expect(milkLeaf).toBeVisible();
  await milkLeaf.click();
  await expect.poll(() => milkProductCalls).toBe(1);

  // Product response A arrives after the user has already gone Back.
  await page.locator("#retail-category-back").click();
  await expect(milkLeaf).toBeVisible();
  releaseMilkProducts();
  await expect.poll(() => milkProductFulfilled).toBe(1);
  await expect(milkCard).toHaveCount(0);

  // Enter leaf again: current request wins.
  await milkLeaf.click();
  await expect(milkCard).toBeVisible();
  await expect(page.locator("#retail-category-note")).toHaveText(
    "Конечный раздел. Товары показаны ниже."
  );

  // Same-document browser history restores parent/leaf state without stale
  // cards, and forward reloads the leaf product.
  await page.goBack();
  await expect(milkLeaf).toBeVisible();
  await expect(milkCard).toHaveCount(0);

  await page.goForward();
  await expect(milkCard).toBeVisible();

  // Switch to a different root and a 30+ product leaf.
  await page.locator("#retail-breadcrumbs").getByRole("button", {
    name: "Категории"
  }).click();
  const breadRoot = categoryGrid.getByRole("button", {
    name: /Хлеб и выпечка/
  });
  await expect(breadRoot).toBeVisible();
  await breadRoot.click();

  const breadLeaf = categoryGrid.getByRole("button", {
    name: /^Хлеб(?:\s|$)/
  });
  await expect(breadLeaf).toBeVisible();
  await breadLeaf.click();

  await expect(productGrid.locator(".product-card")).toHaveCount(35);
  await expect(milkCard).toHaveCount(0);

  const missingPhotoCard = page.locator(
    '[data-product-id="retail:globus:globus-store-5011:bread-stability-0"]'
  );
  await expect(missingPhotoCard).toContainText(
    "Хлеб ремесленный цельнозерновой"
  );
  await expect(missingPhotoCard.locator("img.product-photo")).toHaveCount(0);
  await expect(missingPhotoCard.locator(".product-visual")).toHaveText(
    "Фото товара"
  );
  await expect(missingPhotoCard.locator(".product-visual svg")).toHaveCount(0);

  const failedPhotoCard = page.locator(
    '[data-product-id="retail:globus:globus-store-5011:bread-stability-1"]'
  );
  await expect(failedPhotoCard).toBeVisible();
  await expect(failedPhotoCard.locator("img.product-photo")).toHaveCount(0);
  await expect(failedPhotoCard.locator(".product-visual")).toHaveText(
    "Фото товара"
  );

  // Empty retail leaves keep the selected retailer identity.
  await page.locator("#retail-breadcrumbs").getByRole("button", {
    name: "Категории"
  }).click();
  const emptyRoot = categoryGrid.getByRole("button", {
    name: /Пустой раздел/
  });
  await expect(emptyRoot).toBeVisible();
  await emptyRoot.click();
  await expect(page.locator("#catalog-eyebrow")).toHaveText(
    "Живой каталог · Глобус"
  );
  await expect(page.locator("#empty-search-copy")).toHaveText(
    "В этой категории Глобус сейчас нет товаров."
  );
  await expect(page.locator("#product-grid .product-card")).toHaveCount(0);

  // Back is real history traversal and must restore the full root state,
  // including the retailer's initial product browse.
  await page.locator("#retail-category-back").click();
  await expect(breadRoot).toBeVisible();
  await expect(milkCard).toBeVisible();
  await breadRoot.click();
  await categoryGrid.getByRole("button", { name: /^Хлеб(?:\s|$)/ }).click();
  await expect(productGrid.locator(".product-card")).toHaveCount(35);

  // Reload must preserve the category path in history.state.
  await page.reload();
  await expect(productGrid.locator(".product-card")).toHaveCount(35);
  await expect(page.locator("#retail-category-title")).toHaveText("Хлеб");
  await expect(page.locator("#retail-breadcrumbs")).toContainText(
    "Хлеб и выпечка"
  );
});

test("basket reload keeps retail category and browser forward history", async ({ page }) => {
  await routeLiveCatalog(page, []);
  await routeRetailCatalog(page, []);
  await routeRetailCategories(page);

  await page.addInitScript(() => {
    localStorage.setItem("checkni.surface.basket.v1", JSON.stringify([{
      id: "milk-25-900",
      name: "Молоко 2,5%",
      unit: "900 мл",
      quantity: 1
    }]));
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const categoryGrid = page.locator("#retail-category-grid");
  await categoryGrid.getByRole("button", {
    name: /Молочные продукты, сыр, яйца/
  }).click();
  await categoryGrid.getByRole("button", {
    name: /Молоко и молочные продукты/
  }).click();
  await categoryGrid.getByRole("button", {
    name: /^Молоко(?:\s|$)/
  }).click();

  await expect(page.locator("#retail-category-title")).toHaveText("Молоко");
  await expect(page.locator("#retail-breadcrumbs")).toContainText(
    "Молочные продукты, сыр, яйца"
  );

  await page.locator("#open-basket").click();
  await expect(page).toHaveURL(/#basket$/);
  await expect(page.locator("#basket-content")).toContainText("Молоко 2,5%");

  await page.reload();
  await expect(page).toHaveURL(/#basket$/);
  await expect(page.locator("#basket-content")).toContainText("Молоко 2,5%");

  await page.locator("#back-to-shop").click();
  await expect(page).toHaveURL(/#shop$/);
  await expect(page.locator("#retail-category-title")).toHaveText("Молоко");
  await expect(page.locator("#retail-breadcrumbs")).toContainText(
    "Молочные продукты, сыр, яйца"
  );

  await page.goForward();
  await expect(page).toHaveURL(/#basket$/);
  await expect(page.locator("#basket-content")).toContainText("Молоко 2,5%");

  await page.goBack();
  await expect(page).toHaveURL(/#shop$/);
  await expect(page.locator("#retail-category-title")).toHaveText("Молоко");
});

test("store category path drills from Lenta to sourced observed product", async ({ page }) => {
  await routeLiveCatalog(page, []);

  const lentaRow = {
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
    observed_at: "2026-10-01T08:50:00.000Z"
  };

  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");
    let rows = [];

    if (retailer === "eq.lenta" && depth === "eq.0") {
      rows = [{
        retailer_id: "lenta",
        store_id: "lenta-public-web",
        category_id: 25,
        name: "Макароны, крупы, мука",
        parent_id: null,
        root_id: 25,
        depth: 0,
        source_url: "https://lenta.com/catalog/makarony-krupy-muka-25/",
        product_count: 19
      }];
    } else if (retailer === "eq.lenta" && parentId === "eq.25") {
      rows = [{
        retailer_id: "lenta",
        store_id: "lenta-public-web",
        category_id: 37,
        name: "Каши, хлопья, мюсли",
        parent_id: 25,
        root_id: 25,
        depth: 1,
        source_url: "https://lenta.com/catalog/kashi-hlopya-myusli-37/",
        product_count: 1
      }];
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const categoryId = url.searchParams.get("main_category_id");
    const rows = retailer === "eq.lenta"
      && (!categoryId || categoryId === "eq.37")
      ? [lentaRow]
      : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("https://cdn.api.lenta.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const lentaStore = page.locator("#retail-store-card-lenta");
  await expect(lentaStore).toBeVisible();
  await expect(lentaStore).toContainText("Лента · публичный каталог");
  await expect(lentaStore).toContainText("наличие неизвестно");
  await expect(lentaStore).toContainText("22 категории · 64 товара");
  await expect(lentaStore).toHaveAttribute("aria-pressed", "false");
  await lentaStore.click();
  await expect(lentaStore).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#retail-store-card")).toHaveAttribute(
    "aria-pressed",
    "false"
  );

  await expect(
    page.getByRole("button", { name: /Макароны, крупы, мука/ })
  ).toBeVisible();
  await page.getByRole(
    "button",
    { name: /Макароны, крупы, мука/ }
  ).click();

  await expect(
    page.getByRole("button", { name: /Каши, хлопья, мюсли/ })
  ).toBeVisible();
  await page.getByRole(
    "button",
    { name: /Каши, хлопья, мюсли/ }
  ).click();

  const card = page.locator(
    '[data-product-id="retail:lenta:lenta-public-web:709949"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("Хлопья овсяные ЛЕНТА Экстра, 500г");
  await expect(card).toContainText("500 г");
  await expect(card).toContainText("44,99 ₽");
  await expect(card).toContainText("По Карте №1");
  await expect(card).toContainText("Лента · публичный каталог · источник");
  await expect(card.locator("img.product-photo")).toBeVisible();
  await expect(card.locator("img.product-photo")).toHaveAttribute(
    "src",
    /cdn\.api\.lenta\.com/
  );
  await expect(card.locator(".product-price")).toHaveAttribute(
    "title",
    /наличие не подтверждено/
  );
  await expect(card.getByRole("button")).toBeDisabled();
  await expect(page.locator("#catalog-note")).toContainText(
    "Каши, хлопья, мюсли"
  );
});


test("store category path drills from Magnit to official public product", async ({ page }) => {
  await routeLiveCatalog(page, []);

  const magnitRow = {
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
    observed_at: "2026-10-01T12:55:00.000Z"
  };

  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");
    const rows = retailer === "eq.magnit" && depth === "eq.0"
      ? [{
          retailer_id: "magnit",
          store_id: "magnit-777312",
          category_id: 63963,
          name: "Молочный прилавок",
          parent_id: null,
          root_id: 63963,
          depth: 0,
          source_url:
            "https://magnit.ru/catalog/63963-testmmmolochnyy_prilavok?shopCode=777312&shopType=1",
          product_count: 23
        }]
      : retailer === "eq.magnit" && parentId === "eq.63963"
        ? []
        : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const categoryId = url.searchParams.get("main_category_id");
    const rows = retailer === "eq.magnit"
      && (!categoryId || categoryId === "eq.63963")
      ? [magnitRow]
      : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("https://images-foodtech.magnit.ru/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const store = page.locator("#retail-store-card-magnit");
  await expect(store).toBeVisible();
  await expect(store).toContainText("Магнит · г Москва, аллея Берёзовая, д 17 к 2");
  await expect(store).toContainText("17 категорий · 291 товар");
  await expect(store).toContainText("наличие неизвестно");
  await store.click();
  await expect(store).toHaveAttribute("aria-pressed", "true");

  const category = page.getByRole("button", { name: /Молочный прилавок/ });
  await expect(category).toBeVisible();
  await category.click();

  const card = page.locator(
    '[data-product-id="retail:magnit:magnit-777312:1899800733"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText(
    "Молоко Простоквашино пастеризованное 2.5% 930мл"
  );
  await expect(card).toContainText("930мл");
  await expect(card).toContainText("79,99 ₽");
  await expect(card).toContainText("Публичная онлайн-цена");
  await expect(card).toContainText(
    "Магнит · г Москва, аллея Берёзовая, д 17 к 2 · источник"
  );
  await expect(card.locator("img.product-photo")).toHaveAttribute(
    "src",
    /images-foodtech\.magnit\.ru/
  );
  await expect(card.locator(".product-price")).toHaveAttribute(
    "title",
    /наличие не подтверждено/
  );
  await expect(card.getByRole("button")).toBeEnabled();
  await card.getByRole("button").click();
  await expect(card.getByRole("button")).toContainText("1 в корзине");
  await expect(page.locator("#catalog-note")).toContainText(
    "Молочный прилавок"
  );
});


test("METRO exact pickup store drills from categories to official product price", async ({ page }) => {
  await routeLiveCatalog(page, []);

  const metroRow = {
    retailer_id: "metro",
    store_id: "metro-address-c5gsqz",
    store_name: "METRO · Москва, Ленинградское ш. 71Г",
    locality_id: "city-moscow",
    locality_name: "Москва",
    source_product_id: "100822",
    name: "Тунец Вкусные консервы Экстра полосатый рубленый натуральный, 185г",
    price_minor: 19100,
    currency: "RUB",
    price_condition: "regular",
    sales_channel: "online",
    minimum_quantity: 1,
    quantity_semantics: null,
    availability: "unknown",
    product_url:
      "https://online.metro-cc.ru/products/185g-tunets-vkusnye-konservy-ekstra-polosatyy-rublenyy-natur",
    image_url:
      "https://cdn.metro-cc.ru/ru/ru_pim_567098001001_01.png?width=230",
    weight_text: "185г",
    main_category_id: 9845,
    source_url:
      "https://online.metro-cc.ru/dynamic/rybnye-konservy-v-banke-9845",
    location_label: "125445, г. Москва, Ленинградское ш., д.71Г",
    scope_binding: "same-source",
    binding_id: "metro-address-c5gsqz",
    scope_evidence_url:
      "https://online.metro-cc.ru/dynamic/rybnye-konservy-v-banke-9845",
    observed_at: "2026-10-05T03:40:06.552Z"
  };

  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");
    const rows = retailer === "eq.metro" && depth === "eq.0"
      ? [{
          retailer_id: "metro",
          store_id: "metro-address-c5gsqz",
          category_id: 9845,
          name: "Рыбные консервы в банке",
          parent_id: null,
          root_id: 9845,
          depth: 0,
          source_url:
            "https://online.metro-cc.ru/dynamic/rybnye-konservy-v-banke-9845",
          product_count: 1
        }]
      : retailer === "eq.metro" && parentId === "eq.9845"
        ? []
        : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const categoryId = url.searchParams.get("main_category_id");
    const rows = retailer === "eq.metro"
      && (!categoryId || categoryId === "eq.9845")
      ? [metroRow]
      : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("https://cdn.metro-cc.ru/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const store = page.locator("#retail-store-card-metro");
  await expect(store).toBeVisible();
  await expect(store).toContainText("METRO · Москва, Ленинградское ш. 71Г");
  await expect(store).toContainText("51 категория");
  await expect(store).toContainText("329 товаров");
  await expect(store).toContainText("наличие неизвестно");
  await store.click();
  await expect(store).toHaveAttribute("aria-pressed", "true");

  const category = page.getByRole("button", { name: /Рыбные консервы в банке/ });
  await expect(category).toBeVisible();
  await category.click();

  const card = page.locator(
    '[data-product-id="retail:metro:metro-address-c5gsqz:100822"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText(
    "Тунец Вкусные консервы Экстра полосатый рубленый натуральный, 185г"
  );
  await expect(card).toContainText("185г");
  await expect(card).toContainText("191,00 ₽");
  await expect(card).toContainText("Обычная онлайн-цена");
  await expect(card).toContainText(
    "METRO · Москва, Ленинградское ш. 71Г · источник"
  );
  await expect(card.locator("img.product-photo")).toHaveAttribute(
    "src",
    /cdn\.metro-cc\.ru/
  );
  await expect(card.locator(".product-price")).toHaveAttribute(
    "title",
    /наличие не подтверждено/
  );
  await expect(card.getByRole("button")).toBeDisabled();
  await expect(page.locator("#catalog-note")).toContainText(
    "Рыбные консервы в банке"
  );
});



test("METRO address picker exposes 22 directory points and switches exact-store price", async ({ page }) => {
  await routeLiveCatalog(page, []);

  const stores = {
    "metro-address-c5gsqz": {
      category: {
        retailer_id: "metro",
        store_id: "metro-address-c5gsqz",
        category_id: 939331493,
        name: "Творог брикетный",
        parent_id: null,
        root_id: 939331493,
        depth: 0,
        source_url: "https://online.metro-cc.ru/dynamic/tvorog-briketnyj-60303",
        product_count: 1
      },
      row: {
        retailer_id: "metro",
        store_id: "metro-address-c5gsqz",
        store_name: "METRO · 125445, г. Москва, Ленинградское шоссе 71Г",
        locality_id: "city-moscow",
        locality_name: "Москва",
        source_product_id: "109122",
        name: "Творог рассыпчатый Вкуснотеево 9%, 350г",
        price_minor: 20400,
        currency: "RUB",
        price_condition: "regular",
        sales_channel: "online",
        minimum_quantity: 1,
        quantity_semantics: {},
        availability: "unknown",
        product_url: "https://online.metro-cc.ru/products/vkusnoteevo-9-350g-109122",
        image_url: "https://cdn.metro-cc.ru/ru/ru_pim_95746001001_01.png?width=230",
        weight_text: null,
        main_category_id: 939331493,
        source_url: "https://online.metro-cc.ru/dynamic/tvorog-briketnyj-60303",
        location_label: "125445, г. Москва, Ленинградское ш., д.71Г",
        scope_binding: "same-source",
        binding_id: "metro-address-c5gsqz",
        scope_evidence_url: "https://online.metro-cc.ru/dynamic/tvorog-briketnyj-60303",
        observed_at: "2026-10-07T18:20:45.427Z"
      }
    },
    "metro-address-17mcpb2": {
      category: {
        retailer_id: "metro",
        store_id: "metro-address-17mcpb2",
        category_id: 934760628,
        name: "Йогурт фруктовый",
        parent_id: null,
        root_id: 934760628,
        depth: 0,
        source_url: "https://online.metro-cc.ru/dynamic/jogurt-fruktovyj-61668",
        product_count: 1
      },
      row: {
        retailer_id: "metro",
        store_id: "metro-address-17mcpb2",
        store_name: "METRO · 142204, Московская область, г. Серпухов, городской округ Серпухов, бульвар 65 лет Победы, д.4",
        locality_id: "region-moscow-oblast",
        locality_name: "Московская область",
        source_product_id: "275436",
        name: "Биойогурт Актибио с манго 3%, 220г",
        price_minor: 6991,
        currency: "RUB",
        price_condition: "regular",
        sales_channel: "online",
        minimum_quantity: 1,
        quantity_semantics: {},
        availability: "unknown",
        product_url: "https://online.metro-cc.ru/products/220g-bioyogurt-3-aktibio-mango-bzmzh",
        image_url: "https://cdn.metro-cc.ru/ru/ru_pim_254217001001_01.png?width=230",
        weight_text: null,
        main_category_id: 934760628,
        source_url: "https://online.metro-cc.ru/dynamic/jogurt-fruktovyj-61668",
        location_label: "Серпухов, бул. 65 лет Победы, 4",
        scope_binding: "same-source",
        binding_id: "metro-address-17mcpb2",
        scope_evidence_url: "https://online.metro-cc.ru/dynamic/jogurt-fruktovyj-61668",
        observed_at: "2026-10-07T18:20:45.427Z"
      }
    }
  };

  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("retailer_id") !== "eq.metro") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    const storeId = url.searchParams.get("store_id")?.replace(/^eq\./u, "");
    const fixture = stores[storeId];
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");
    const rows = fixture && depth === "eq.0"
      ? [fixture.category]
      : fixture && parentId === `eq.${fixture.category.category_id}`
        ? []
        : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("retailer_id") !== "eq.metro") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    const storeId = url.searchParams.get("store_id")?.replace(/^eq\./u, "");
    const fixture = stores[storeId];
    const categoryId = url.searchParams.get("main_category_id");
    const rows = fixture && (!categoryId || categoryId === `eq.${fixture.category.category_id}`)
      ? [fixture.row]
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("https://cdn.metro-cc.ru/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const storeCard = page.locator("#retail-store-card-metro");
  await storeCard.click();

  const picker = page.locator("#metro-store-picker");
  await expect(picker).toBeVisible();
  await expect(picker.locator("option")).toHaveCount(22);
  await expect(picker.locator('option[value="49"]')).toBeEnabled();
  await expect(picker.locator('option[value="49"]')).toContainText("Ново-Переделкино");
  await expect(picker.locator('option[value="1307"]')).toBeEnabled();
  await expect(picker.locator('option[value="1307"]')).toContainText("Новые Псарьки");

  const select = picker.locator("#metro-store-address");
  await select.selectOption("1317");

  await expect(storeCard).toContainText("Серпухов");
  await expect(storeCard).toContainText("1 товар");
  await expect(select).toHaveValue("1317");

  const category = page.getByRole("button", { name: /Йогурт фруктовый/ });
  await expect(category).toBeVisible();
  await category.click();

  const card = page.locator(
    '[data-product-id="retail:metro:metro-address-17mcpb2:275436"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("Биойогурт Актибио с манго 3%, 220г");
  await expect(card).toContainText("69,91 ₽");
  await expect(card).toContainText("Обычная онлайн-цена");
  await expect(card).toContainText("Серпухов");

  await page.reload();
  await expect(page.locator("#retail-store-card-metro")).toContainText("Серпухов");
  await expect(page.locator("#metro-store-address")).toHaveValue("1317");
});

test("retailer switch owns delayed category and product responses across history", async ({ page }) => {
  await routeLiveCatalog(page, []);

  const globusRoot = {
    retailer_id: "globus",
    store_id: "globus-store-5011",
    category_id: 10118965,
    name: "Молочные продукты, сыр, яйца",
    parent_id: null,
    root_id: 10118965,
    depth: 0,
    source_url:
      "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965",
    product_count: 1
  };
  const lentaRoot = {
    retailer_id: "lenta",
    store_id: "lenta-public-web",
    category_id: 25,
    name: "Макароны, крупы, мука",
    parent_id: null,
    root_id: 25,
    depth: 0,
    source_url: "https://lenta.com/catalog/makarony-krupy-muka-25/",
    product_count: 1
  };
  const staleGlobusChild = {
    retailer_id: "globus",
    store_id: "globus-store-5011",
    category_id: 2978998,
    name: "СТАРЫЙ ОТВЕТ ГЛОБУСА",
    parent_id: 10118965,
    root_id: 10118965,
    depth: 1,
    source_url:
      "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965/moloko-i-molochnye-produkty-2978998",
    product_count: 1
  };

  const globusProduct = {
    retailer_id: "globus",
    store_id: "globus-store-5011",
    store_name: "Глобус Красногорск",
    locality_id: "city-moscow",
    locality_name: "Москва",
    source_product_id: "globus-stale-product",
    name: "СТАРЫЙ ТОВАР ГЛОБУСА",
    price_minor: 11100,
    currency: "RUB",
    price_condition: "regular",
    availability: "unknown",
    product_url: "https://www.globus.ru/products/globus-stale-product/",
    image_url: null,
    weight_text: "1 шт",
    main_category_id: 10118965,
    source_url: "https://www.globus.ru/products/globus-stale-product/",
    observed_at: "2026-10-02T12:00:00.000Z"
  };
  const lentaProduct = {
    retailer_id: "lenta",
    store_id: "lenta-public-web",
    store_name: "Лента · публичный каталог",
    locality_id: "country-ru-public-catalog",
    locality_name: "Россия",
    source_product_id: "lenta-current-product",
    name: "ТЕКУЩИЙ ТОВАР ЛЕНТЫ",
    price_minor: 22200,
    currency: "RUB",
    price_condition: "loyalty-card-1",
    availability: "unknown",
    product_url:
      "https://lenta.com/product/hlopya-ovsyanye-ekstra-rossiya-500g-709949/",
    image_url: null,
    weight_text: "500 г",
    main_category_id: 25,
    source_url: "https://lenta.com/catalog/makarony-krupy-muka-25/",
    observed_at: "2026-10-02T12:00:00.000Z"
  };

  let releaseGlobusChildren;
  const globusChildrenGate = new Promise((resolve) => {
    releaseGlobusChildren = resolve;
  });
  let globusChildrenCalls = 0;

  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");
    let rows = [];

    if (retailer === "eq.globus" && depth === "eq.0") {
      rows = [globusRoot];
    } else if (retailer === "eq.lenta" && depth === "eq.0") {
      rows = [lentaRoot];
    } else if (retailer === "eq.globus" && parentId === "eq.10118965") {
      globusChildrenCalls += 1;
      if (globusChildrenCalls === 1) {
        await globusChildrenGate;
        rows = [staleGlobusChild];
      }
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  let releaseGlobusProduct;
  const globusProductGate = new Promise((resolve) => {
    releaseGlobusProduct = resolve;
  });
  let globusProductCalls = 0;

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const categoryId = url.searchParams.get("main_category_id");
    const categoryUrl = url.searchParams.get("category_url");
    let rows = [];

    if (retailer === "eq.lenta") {
      rows = [lentaProduct];
    } else if (
      retailer === "eq.globus"
      && (
        categoryId === "eq.10118965"
        || categoryUrl
          === "like.https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965*"
      )
    ) {
      globusProductCalls += 1;
      if (globusProductCalls === 1) {
        await globusProductGate;
      }
      rows = [globusProduct];
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const categoryGrid = page.locator("#retail-category-grid");
  const globusStore = page.locator("#retail-store-card");
  const lentaStore = page.locator("#retail-store-card-lenta");

  const globusRootButton = categoryGrid.getByRole("button", {
    name: /Молочные продукты, сыр, яйца/
  });
  await expect(globusRootButton).toBeVisible();
  await globusRootButton.click();
  await expect.poll(() => globusChildrenCalls).toBe(1);

  await lentaStore.click();
  await expect(lentaStore).toHaveAttribute("aria-pressed", "true");
  await expect(categoryGrid.getByRole("button", {
    name: /Макароны, крупы, мука/
  })).toBeVisible();

  releaseGlobusChildren();
  await expect(categoryGrid.getByRole("button", {
    name: /СТАРЫЙ ОТВЕТ ГЛОБУСА/
  })).toHaveCount(0);
  await expect(page.locator(
    '[data-product-id="retail:lenta:lenta-public-web:lenta-current-product"]'
  )).toBeVisible();

  await globusStore.click();
  await expect(globusStore).toHaveAttribute("aria-pressed", "true");
  await categoryGrid.getByRole("button", {
    name: /Молочные продукты, сыр, яйца/
  }).click();
  await expect.poll(() => globusProductCalls).toBe(1);

  await lentaStore.click();
  await expect(lentaStore).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(
    '[data-product-id="retail:lenta:lenta-public-web:lenta-current-product"]'
  )).toBeVisible();

  releaseGlobusProduct();
  await expect(page.locator(
    '[data-product-id="retail:globus:globus-store-5011:globus-stale-product"]'
  )).toHaveCount(0);
  await expect(page.locator("#catalog-eyebrow")).toHaveText(
    "Живой каталог · Лента"
  );

  await page.goBack();
  await expect(globusStore).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(
    '[data-product-id="retail:globus:globus-store-5011:globus-stale-product"]'
  )).toBeVisible();

  await page.goForward();
  await expect(lentaStore).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(
    '[data-product-id="retail:lenta:lenta-public-web:lenta-current-product"]'
  )).toBeVisible();
  await expect(page.locator(
    '[data-product-id="retail:globus:globus-store-5011:globus-stale-product"]'
  )).toHaveCount(0);

  await page.reload();
  await expect(lentaStore).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(
    '[data-product-id="retail:lenta:lenta-public-web:lenta-current-product"]'
  )).toBeVisible();
  await expect(page.locator("#catalog-eyebrow")).toHaveText(
    "Живой каталог · Лента"
  );
});


test("store category path drills from VkusVill to public catalog product", async ({ page }) => {
  await routeLiveCatalog(page, []);

  const row = {
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
    image_url: "https://img.vkusvill.ru/test/22658.webp",
    weight_text: "10 шт",
    main_category_id: 920006,
    source_url: "https://vkusvill.ru/goods/molochnye-produkty-yaytso/",
    observed_at: "2026-10-02T15:30:00.000Z"
  };

  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");
    const rows = retailer === "eq.vkusvill" && depth === "eq.0"
      ? [{
          retailer_id: "vkusvill",
          store_id: "vkusvill-public-web",
          category_id: 920006,
          name: "Молочные продукты, яйцо",
          parent_id: null,
          root_id: 920006,
          depth: 0,
          source_url: "https://vkusvill.ru/goods/molochnye-produkty-yaytso/",
          product_count: 24
        }]
      : retailer === "eq.vkusvill" && parentId === "eq.920006"
        ? []
        : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const categoryId = url.searchParams.get("main_category_id");
    const rows = retailer === "eq.vkusvill"
      && (!categoryId || categoryId === "eq.920006")
      ? [row]
      : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("https://img.vkusvill.ru/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const store = page.locator("#retail-store-card-vkusvill");
  await expect(store).toBeVisible();
  await expect(store).toContainText("ВкусВилл · публичный каталог");
  await expect(store).toContainText("цена может зависеть от региона");
  await store.click();
  await expect(store).toHaveAttribute("aria-pressed", "true");

  const category = page.getByRole("button", { name: /Молочные продукты, яйцо/ });
  await expect(category).toBeVisible();
  await category.click();

  const card = page.locator(
    '[data-product-id="retail:vkusvill:vkusvill-public-web:22658"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("Яйцо куриное С0, 10 шт");
  await expect(card).toContainText("136,00 ₽");
  await expect(card).toContainText("Публичная цена сайта");
  await expect(card).toContainText("ВкусВилл · публичный каталог · источник");
  await expect(card.locator("img.product-photo")).toHaveAttribute(
    "src",
    /img\.vkusvill\.ru/
  );
  await expect(card.locator(".product-price")).toHaveAttribute(
    "title",
    /наличие не подтверждено/
  );
  await expect(card.getByRole("button")).toBeDisabled();
});


test("store category path drills from Perekrestok to Yandex delivery price", async ({ page }) => {
  await routeLiveCatalog(page, []);

  const perekrestokRow = {
    retailer_id: "perekrestok",
    store_id: "perekrestok-yandex-3186917",
    store_name:
      "Перекрёсток · Москва, Большой Овчинниковский пер. 16 · Яндекс Еда",
    locality_id: "city-moscow",
    locality_name: "Москва",
    source_product_id: "62e2fc67-211d-485a-bd85-01ff6a40a53b",
    name:
      "Напиток молочный Пармалат (Parmalat) Спокойной ночи безлактозный Липа 1.8% 1000 мл",
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
    observed_at: "2026-10-02T17:06:07.257Z"
  };

  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");
    const requestedLimit = Number(url.searchParams.get("limit") ?? "0");
    const rootRows = Array.from({ length: 58 }, (_, index) => ({
      retailer_id: "perekrestok",
      store_id: "perekrestok-yandex-3186917",
      category_id: index === 0 ? 2910 : 500000 + index,
      name: index === 0 ? "Молоко, яйца" : `Категория ${index + 1}`,
      parent_id: null,
      root_id: index === 0 ? 2910 : 500000 + index,
      depth: 0,
      source_url:
        "https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w",
      product_count: index === 0 ? 280 : 1
    }));
    const rows = retailer === "eq.perekrestok" && depth === "eq.0"
      ? rootRows.slice(0, requestedLimit || 40)
      : retailer === "eq.perekrestok" && parentId === "eq.2910"
        ? []
        : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const retailer = url.searchParams.get("retailer_id");
    const categoryId = url.searchParams.get("main_category_id");
    const rows = retailer === "eq.perekrestok"
      && (!categoryId || categoryId === "eq.2910")
      ? [perekrestokRow]
      : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("https://avatars.mds.yandex.net/get-eda/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const store = page.locator("#retail-store-card-perekrestok");
  await expect(store).toBeVisible();
  await expect(store).toContainText("Перекрёсток");
  await expect(store).toContainText("Яндекс Еда");
  await expect(store).toContainText(/58 категорий/);
  await expect(store).toContainText(/5.?460 товаров/);
  await expect(store).toContainText("наличие неизвестно");
  await store.click();
  await expect(store).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#retail-category-grid .retail-category-button:not(.is-loading)")).toHaveCount(58);

  const category = page.getByRole("button", { name: /Молоко, яйца/ });
  await expect(category).toBeVisible();
  await category.click();

  const card = page.locator(
    '[data-product-id="retail:perekrestok:perekrestok-yandex-3186917:62e2fc67-211d-485a-bd85-01ff6a40a53b"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("Пармалат");
  await expect(card).toContainText("1 л");
  await expect(card).toContainText("150,00 ₽");
  await expect(card).toContainText("Промо-цена доставки Яндекс Еды");
  await expect(card).toContainText("Перекрёсток");
  const officialPhoto = card.locator("img.product-photo");
  if (await officialPhoto.count()) {
    await expect(officialPhoto).toHaveAttribute(
      "src",
      /(?:avatars\.mds\.yandex\.net\/get-eda\/|eda\.yandex\/images\/)/
    );
  } else {
    await expect(card.locator(".product-visual")).toContainText("Фото товара");
  }
  await expect(card.locator(".product-price")).toHaveAttribute(
    "title",
    /наличие не подтверждено/
  );
  await expect(card.getByRole("button")).toBeDisabled();
  await expect(page.locator("#catalog-eyebrow")).toHaveText(
    "Живой каталог · Перекрёсток"
  );
});

test("failed GLOBUS subcategory keeps retry and parent escape visible", async ({ page }) => {
  await routeLiveCatalog(page, []);

  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const depth = url.searchParams.get("depth");
    const parentId = url.searchParams.get("parent_id");

    if (depth === "eq.0") {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: globusFixtureJson([{
          retailer_id: "globus",
          store_id: "globus-store-5011",
          category_id: 10118965,
          name: "Молочные продукты, сыр, яйца",
          parent_id: null,
          root_id: 10118965,
          depth: 0,
          source_url:
            "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965",
          product_count: 120
        }])
      });
      return;
    }

    if (parentId === "eq.10118965") {
      await route.fulfill({
        status: 503,
        contentType: "application/json; charset=utf-8",
        body: globusFixtureJson({ code: "source_unavailable" })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: "[]"
    });
  });

  await routeRetailCatalog(page);
  await page.goto("/?comparison=observed&catalog=retail");

  await page.getByRole("button", {
    name: /Молочные продукты, сыр, яйца/
  }).click();

  await expect(page.getByRole("button", {
    name: "Повторить загрузку"
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Вернуться ко всем категориям"
  })).toBeVisible();

  await page.getByRole("button", {
    name: "Вернуться ко всем категориям"
  }).click();

  await expect(page.locator("#retail-category-title")).toHaveText("Категории");
  await expect(page.getByRole("button", {
    name: /Молочные продукты, сыр, яйца/
  })).toBeVisible();
});

test("DA promo catalog keeps multibuy truth visible on desktop and mobile-safe retail flow", async ({ page }) => {
  // This scenario asserts a dated fixture, independently of the runner's day.
  await page.clock.setFixedTime(new Date("2026-10-02T18:00:00Z"));
  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const retailerId = url.searchParams.get("retailer_id");
    const rows = retailerId === "eq.da"
      ? [{
          retailer_id: "da",
          store_id: "da-public-promo",
          category_id: 940001,
          name: "Текущий промо-каталог",
          parent_id: null,
          root_id: 940001,
          depth: 0,
          source_url: "https://market-da.ru/sale.html",
          product_count: 94
        }]
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const retailerId = url.searchParams.get("retailer_id");
    const rows = retailerId === "eq.da"
      ? [{
          retailer_id: "da",
          store_id: "da-public-promo",
          store_name: "ДА! · публичный промо-каталог",
          locality_id: "network-da-public-promo",
          locality_name: "Сеть ДА!",
          source_product_id: "2026-10-01-da-48",
          name: "Мороженое пломбир Село Зеленое",
          price_minor: 4495,
          currency: "RUB",
          price_condition: "public-promo",
          minimum_quantity: 2,
          quantity_semantics: {
            kind: "multibuy",
            minimum_quantity: 2,
            promo_valid_from: "2026-10-01",
            promo_valid_to: "2026-10-14"
          },
          availability: "unknown",
          product_url: "https://market-da.ru/sale.html",
          image_url:
            "https://market-da.ru/assets/cache/images/producti_pics/2026/10/01/140x140-da-48.f41.jpg",
          weight_text:
            "ваниль/шоколад, 15%, 90 г *44,95 руб. – за 1 шт. при покупке 2 шт.",
          main_category_id: 940001,
          source_url: "https://market-da.ru/sale.html",
          observed_at: "2026-10-02T17:50:18.151Z"
        }]
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("https://market-da.ru/assets/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const store = page.locator("#retail-store-card-da");
  await expect(store).toBeVisible();
  await expect(store).toContainText("ДА! · публичный промо-каталог");
  await expect(store).toContainText("Промо 1–14 октября");
  await expect(store).toContainText("1 категория · 94 товара");

  await store.click();
  await expect(
    page.getByRole("button", { name: /Текущий промо-каталог/ })
  ).toBeVisible();

  await page.getByRole(
    "button",
    { name: /Текущий промо-каталог/ }
  ).click();

  const card = page.locator(
    '[data-product-id="retail:da:da-public-promo:2026-10-01-da-48"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("Мороженое пломбир Село Зеленое");
  await expect(card).toContainText("44,95 ₽");
  await expect(card).toContainText(
    "Промо-цена каталога · при покупке 2 шт. · до 14.10"
  );
  await expect(card).toContainText("ДА! · публичный промо-каталог · источник");
  await expect(card.locator("img.product-photo")).toBeVisible();

  const add = card.getByRole("button");
  await expect(add).toBeDisabled();
  await expect(add).toContainText(
    "Сопоставление для сравнения ещё не подтверждено"
  );
});


test("Auchan promo catalog keeps card and multibuy truth visible on desktop and mobile", async ({ page }) => {
  // Keep the fixture inside its original 1–14 October promotional period.
  await page.clock.setFixedTime(new Date("2026-10-02T18:00:00Z"));
  await page.route("**/rest/v1/retail_catalog_categories**", async (route) => {
    const url = new URL(route.request().url());
    const retailerId = url.searchParams.get("retailer_id");
    const rows = retailerId === "eq.auchan"
      ? [{
          retailer_id: "auchan",
          store_id: "auchan-msk-public-promo",
          category_id: 950001,
          name: "Промо 1–14 октября",
          parent_id: null,
          root_id: 950001,
          depth: 0,
          source_url: "https://catalog.auchan.ru/60z9R061p97677",
          product_count: 312
        }]
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.route("**/rest/v1/retail_catalog_items**", async (route) => {
    const url = new URL(route.request().url());
    const retailerId = url.searchParams.get("retailer_id");
    const rows = retailerId === "eq.auchan"
      ? [{
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
          observed_at: "2026-10-02T16:56:31.480Z"
        }]
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: globusFixtureJson(rows)
    });
  });

  await page.goto("/?comparison=observed&catalog=retail");

  const store = page.locator("#retail-store-card-auchan");
  await expect(store).toBeVisible();
  await expect(store).toContainText("АШАН · Москва · публичный промо-каталог");
  await expect(store).toContainText("Москва · промо 1–14 октября");
  await expect(store).toContainText("1 категория · 312 товаров");

  await store.click();
  const promo = page.locator("#retail-category-grid").getByRole("button", { name: /Промо 1–14 октября/ });
  await expect(promo).toBeVisible();
  await promo.click();

  const card = page.locator(
    '[data-product-id="retail:auchan:auchan-msk-public-promo:promo-20261001-p04-01"]'
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText(
    "Сардельки МЯСНИЦКИЙ РЯД Каждому по вкусу, 360 г"
  );
  await expect(card).toContainText("139,99 ₽");
  await expect(card).toContainText(
    "По карте АШАН · при покупке 2 шт. · до 14.10"
  );
  await expect(card).toContainText(
    "АШАН · Москва · публичный промо-каталог · источник"
  );

  const add = card.getByRole("button");
  await expect(add).toBeDisabled();
  await expect(add).toContainText(
    "Сопоставление для сравнения ещё не подтверждено"
  );
});
