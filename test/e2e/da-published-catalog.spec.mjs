// Synthetic DA issues only. No live price/source evidence.
import { test, expect } from "@playwright/test";
const globusFixtureJson = value => JSON.stringify(value);

for (const issue of [
  { from: "2026-10-01", until: "2026-10-14", now: "2026-10-02T18:00:00Z", observedAt: "2026-10-02T17:50:18.151Z", count: 94, countText: "94 товара" },
  { from: "2026-10-22", until: "2026-11-04", now: "2026-10-23T09:00:00Z", observedAt: "2026-10-23T08:30:00Z", count: 71, countText: "71 товар" }
]) test(`DA promo catalog keeps multibuy truth visible on desktop and mobile-safe retail flow (${issue.from})`, async ({ page }) => {
  // Synthetic, explicitly dated old/new issues; neither fixture claims live prices.
  await page.clock.setFixedTime(new Date(issue.now));
  const unexpectedExternal = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    unexpectedExternal.push(url.origin + url.pathname);
    await route.abort("blockedbyclient");
  });
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
          product_count: issue.count
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
          source_product_id: `${issue.from}-da-48`,
          name: "Мороженое пломбир Село Зеленое",
          price_minor: 4495,
          currency: "RUB",
          price_condition: "public-promo",
          minimum_quantity: 2,
          quantity_semantics: {
            kind: "multibuy",
            minimum_quantity: 2,
            promo_valid_from: issue.from,
            promo_valid_to: issue.until
          },
          availability: "unknown",
          product_url: "https://market-da.ru/sale.html",
          image_url:
            `https://market-da.ru/assets/cache/images/producti_pics/${issue.from.replaceAll("-", "/")}/140x140-da-48.f41.jpg`,
          weight_text:
            "ваниль/шоколад, 15%, 90 г *44,95 руб. – за 1 шт. при покупке 2 шт.",
          main_category_id: 940001,
          source_url: "https://market-da.ru/sale.html",
          observed_at: issue.observedAt
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
  await expect(store.locator("strong")).toHaveText("ДА!");
  await expect(store).toHaveAttribute("aria-label", "ДА!: Публичный промо-каталог · наличие зависит от магазина");
  await expect(store).toContainText("Публичный промо-каталог");
  await expect(store).not.toContainText("1 категория · 94 товара");

  await store.click();
  await expect(store).toContainText(`1 категория · ${issue.countText}`);
  await expect(
    page.getByRole("button", { name: /Текущий промо-каталог/ })
  ).toBeVisible();

  await page.getByRole(
    "button",
    { name: /Текущий промо-каталог/ }
  ).click();

  const card = page.locator(
    `[data-product-id="retail:da:da-public-promo:${issue.from}-da-48"]`
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText("Мороженое пломбир Село Зеленое");
  await expect(card).toContainText("44,95 ₽");
  await expect(card).toContainText(
    `Промо-цена каталога · при покупке 2 шт. · до ${issue.until.slice(8, 10)}.${issue.until.slice(5, 7)}`
  );
  await expect(card).toContainText("ДА! · публичный промо-каталог · источник");
  await expect(card.locator("img.product-photo")).toBeVisible();

  const add = card.locator(".add-button");
  await expect(add).toBeDisabled();
  await expect(add).toHaveAttribute(
    "title",
    "Сопоставление для сравнения ещё не подтверждено"
  );
  expect(unexpectedExternal).toEqual([]);
});
