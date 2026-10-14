import { test, expect } from "@playwright/test";

// Controlled browser regression data only, never evidence of current prices.
// SKU, official URL and pack are the existing independently reviewed identity.
const source = "https://online.metro-cc.ru/products/moloko-prostokvashino-pasterizovannoye-2-5-930ml";
const cardId = "retail:metro:metro-address-fjag7i:241097";

async function isolateCatalogue(page, baseURL) {
  const exactReads = [];
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === new URL(baseURL).origin) {
      return route.continue();
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/src/ports/observedOffersPort.mjs", route => route.fulfill({
    status: 200, contentType: "text/javascript",
    body: "export const BETA_RETAIL_PRICE_MAX_AGE_MS = 5 * 60 * 1000; export const observedOffersPort = { load: async () => [] };"
  }));
  await page.route("**/rest/v1/retail_catalog_categories**", route => route.fulfill({
    status: 200, contentType: "application/json", body: "[]"
  }));
  await page.route("**/rest/v1/retail_catalog_items**", route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has("source_product_id")) exactReads.push(Object.fromEntries(query));
    const rows = query.get("retailer_id") === "eq.metro"
      && query.get("store_id") === "eq.metro-address-fjag7i" ? [{
      retailer_id: "metro", store_id: "metro-address-fjag7i",
      store_name: "METRO · просп. Мира, 211, корп.1", locality_id: "city-moscow", locality_name: "Москва",
      source_product_id: "241097", name: "Молоко Простоквашино пастеризованное 2.5%, 930мл",
      weight_text: null, price_minor: 10000, currency: "RUB", price_condition: "regular",
      sales_channel: "online", minimum_quantity: 1, quantity_semantics: {}, availability: "unknown",
      product_url: source, source_url: source, scope_evidence_url: source, scope_binding: "same-source",
      binding_id: "metro-address-fjag7i", location_label: "129226, г. Москва, пр-кт Мира, д.211, корп.1",
      observed_at: new Date().toISOString()
    }] : [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  await page.route("**/functions/v1/catalog-search", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ kind: "catalog", products: [] })
  }));
  await page.route("**/functions/v1/beta-retail-prices", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ kind: "insufficient", refreshedAt: new Date().toISOString(), offers: [] })
  }));
  return { exactReads };
}

test("catalogue add preserves a conflicting saved pack until the user removes it, then compares the exact pack", async ({ page, baseURL }, testInfo) => {
  if (testInfo.project.name === "chromium-mobile") {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  const { exactReads } = await isolateCatalogue(page, baseURL);

  // A legitimate basket retained from DEMO must not silently become another SKU.
  await page.goto("/?comparison=demo#shop");
  await page.locator('[data-product-id="milk-25-900"]').getByRole("button").click();
  await page.goto("/?comparison=observed&catalog=retail#shop");
  await page.locator("#retail-store-card-metro").click();
  await page.getByLabel("Адрес METRO", { exact: true }).selectOption("11");
  const search = page.locator("#product-search");
  await search.fill("Молоко Простоквашино");
  await search.press("Enter");
  const card = page.locator(`[data-product-id="${cardId}"]`);
  await expect(card).toContainText("930 мл");
  await expect(card.getByRole("button")).toHaveText("Добавить");
  await expect(card.getByRole("button")).not.toHaveClass(/is-added/);
  await card.getByRole("button").click();
  await expect(page.locator("#toast-region")).toHaveText(
    "В корзине уже другой товар или упаковка. Сначала проверьте его в корзине."
  );
  await expect(page.locator("#basket-dock-copy")).toContainText("1 шт. · 1 поз.");
  await expect(card.getByRole("button")).toHaveText("Добавить");
  await expect(card.getByRole("button")).not.toHaveClass(/is-added/);
  await page.locator("#open-basket").click();
  await expect(page.locator(".basket-item-info")).toContainText("Молоко 2,5%");
  await expect(page.locator(".basket-item-info")).toContainText("900 мл");
  await page.locator("#compare-basket").click();
  const result = page.getByLabel("Результат по наблюдаемым ценам");
  await expect(result).toContainText("Недостаточно данных");
  const identityPrompt = page.getByLabel("Проверка реальных цен в Москве");
  await expect(identityPrompt.getByRole("button", { name: "Выбрать эти товары и сравнить", exact: true })).toBeVisible();
  expect(exactReads).toHaveLength(0);

  // Rejecting another click must not invalidate the existing basket or result.
  await page.locator("#back-to-shop").click();
  await expect(card.getByRole("button")).toHaveText("Добавить");
  await card.getByRole("button").click();
  await expect(card.getByRole("button")).toHaveText("Добавить");
  await expect(card.getByRole("button")).not.toHaveClass(/is-added/);
  await expect(page.locator("#toast-region")).not.toContainText("добавлено");
  await page.locator("#open-basket").click();
  await expect(result).toContainText("Недостаточно данных");
  await expect(identityPrompt.getByRole("button", { name: "Выбрать эти товары и сравнить", exact: true })).toBeVisible();
  await expect(page.locator(".basket-summary")).toContainText("1 шт. · 1 позиция");
  await expect(page.locator(".basket-item-info")).toContainText("900 мл");
  await page.reload();
  await expect(page.locator(".basket-item-info")).toContainText("900 мл");
  await expect(page.locator(".basket-summary")).toContainText("1 шт. · 1 позиция");

  // Replacing a pack is a user action, followed by an ordinary catalogue add.
  await page.getByRole("button", { name: "Удалить Молоко 2,5% из корзины", exact: true }).click();
  await page.locator("#back-to-shop").click();
  await page.locator("#retail-store-card-metro").click();
  await expect(page.getByLabel("Адрес METRO", { exact: true })).toHaveValue("11");
  await search.fill("Молоко Простоквашино");
  await search.press("Enter");
  await expect(card.getByRole("button")).toHaveText("Добавить");
  await card.getByRole("button").click();
  await expect(page.locator("#toast-region")).toContainText("добавлено");
  await expect(card.getByRole("button")).toHaveText("Добавить ещё · 1 в корзине");
  await expect(card.getByRole("button")).toHaveClass(/is-added/);
  await page.locator("#open-basket").click();
  await expect(page.locator(".basket-item-info")).toContainText("930 мл");
  await expect(page.locator(".basket-item-info")).not.toContainText("900 мл");
  await expect(page.locator(".basket-summary")).toContainText("1 шт. · 1 позиция");
  await page.locator("#compare-basket").click();
  await page.getByRole("button", { name: "Подтвердить товары и сравнить", exact: true }).click();
  await expect(result).toContainText("METRO");
  await expect(result).toContainText("100,00 ₽");
  await expect(result).not.toContainText("Экономия");
  expect(exactReads).toHaveLength(1);
  expect(exactReads[0].source_product_id).toBe("in.(241097)");
  expect(exactReads[0].store_id).toBe("eq.metro-address-fjag7i");
  await page.reload();
  await expect(page.locator(".basket-item-info")).toContainText("930 мл");
  await expect(page.locator(".basket-summary")).toContainText("1 шт. · 1 позиция");
  await page.locator("#back-to-shop").click();
  await page.locator("#retail-store-card-metro").click();
  await search.fill("Молоко Простоквашино");
  await search.press("Enter");
  await expect(card.getByRole("button")).toHaveText("Добавить ещё · 1 в корзине");
  await expect(card.getByRole("button")).toHaveClass(/is-added/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("catalogue add counts an already reviewed saved alias and preserves its exact metadata", async ({ page, baseURL }, testInfo) => {
  if (testInfo.project.name === "chromium-mobile") {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await isolateCatalogue(page, baseURL);
  await page.goto("/?comparison=observed&catalog=retail#shop");
  // This short name is an existing reviewed proof-product alias, not a new
  // fuzzy match. Bootstrap only the retained basket, then use ordinary UI.
  await page.evaluate(() => {
    localStorage.setItem("checkni.surface.basket.v1", JSON.stringify([{
      id: "milk-25-900", name: "Молоко Простоквашино", unit: "930 мл", quantity: 1
    }]));
  });
  await page.reload();
  await page.locator("#retail-store-card-metro").click();
  await page.getByLabel("Адрес METRO", { exact: true }).selectOption("11");
  const search = page.locator("#product-search");
  await search.fill("Молоко Простоквашино");
  await search.press("Enter");
  const card = page.locator(`[data-product-id="${cardId}"]`);
  await expect(card.getByRole("button")).toHaveText("Добавить ещё · 1 в корзине");
  await card.getByRole("button").click();
  await expect(page.locator("#toast-region")).toContainText("добавлено");
  await expect(card.getByRole("button")).toHaveText("Добавить ещё · 2 в корзине");
  await page.locator("#open-basket").click();
  await expect(page.locator(".basket-item-info h2")).toHaveText("Молоко Простоквашино");
  await expect(page.locator(".basket-item-info")).toContainText("930 мл");
  await expect(page.locator(".basket-summary")).toContainText("2 шт. · 1 позиция");
  await page.reload();
  await expect(page.locator(".basket-item-info h2")).toHaveText("Молоко Простоквашино");
  await expect(page.locator(".basket-item-info")).toContainText("930 мл");
  await expect(page.locator(".basket-summary")).toContainText("2 шт. · 1 позиция");
  await page.locator("#back-to-shop").click();
  await page.locator("#retail-store-card-metro").click();
  await search.fill("Молоко Простоквашино");
  await search.press("Enter");
  await expect(card.getByRole("button")).toHaveText("Добавить ещё · 2 в корзине");
  await expect(card.getByRole("button")).toHaveClass(/is-added/);
});
