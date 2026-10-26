import { selectStore, openHory, openBasket } from './helpers/pixel-surface.mjs';
import { test, expect } from "@playwright/test";

// Synthetic source rows prove behavior/provenance gates, not live prices.
const reviewed = {
  retailer_id: "magnit", store_id: "magnit-777312", store_name: "Магнит · Берёзовая аллея, 17к2",
  locality_id: "city-moscow", locality_name: "Москва", source_product_id: "1899800689",
  name: "Кефир Простоквашино 2.5% 930г", weight_text: "930 г", price_minor: 7999, currency: "RUB",
  price_condition: "public-online", availability: "unknown", main_category_id: 63963,
  product_url: "https://magnit.ru/product/1899800689-kefir_prostokvashino_2_5_930g?shopCode=777312&shopType=1",
  source_url: "https://magnit.ru/catalog/63963-molochnyy_prilavok?shopCode=777312&shopType=1",
  image_url: null, observed_at: "2026-10-10T06:30:00Z"
};
const unreviewed = { ...reviewed, source_product_id: "other", name: "Кефир Другая марка 2.5% 900г", weight_text: "900 г", price_minor: 5999,
  product_url: "https://magnit.ru/product/other?shopCode=777312&shopType=1" };
const submit = async (page, text) => {
  await openHory(page);
  await page.locator("#basket-proposal-input").fill(text);
  await page.locator("#basket-proposal-submit").click();
};
async function setup(page, rows = [reviewed, unreviewed]) {
  let modelCalls = 0;
  await page.route("**/functions/v1/ai-basket-proposal", route => { modelCalls++; return route.abort(); });
  await page.route("**/rest/v1/retail_catalog_categories**", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/retail_catalog_items**", route => {
    const retailer = new URL(route.request().url()).searchParams.get("retailer_id");
    return route.fulfill({ json: retailer === "eq.magnit" ? rows : [] });
  });
  await page.goto("/?comparison=observed&catalog=retail#shop");
  await selectStore(page, 'magnit');
  return () => modelCalls;
}

test("kefir need → actual source choices → two bottles → reviewed exact pack → confirmation and reload", async ({ page }) => {
  const calls = await setup(page);
  await submit(page, "Я хочу кефир");
  const cards = page.locator(".shopping-selection-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Кефир Простоквашино 2.5% 930г");
  await expect(cards.nth(0)).toContainText("10.10.2026");
  await expect(cards.nth(0).getByRole("link", { name: "Источник" })).toHaveAttribute("href", reviewed.source_url);
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
  await submit(page, "две бутылки");
  await expect(page.locator("#basket-proposal-status")).toContainText("Количество: 2 уп.");
  await cards.nth(0).getByRole("button", { name: "Выбрать вариант 1" }).click();
  await expect(page.locator("#basket-proposal-status")).toContainText("930 г ×2");
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
  await submit(page, "го");
  await expect(page.locator("#basket-dock-copy")).toContainText("2 шт.");
  await submit(page, "нет, лучше три");
  await expect(page.locator("#basket-proposal-status")).toContainText("930 г ×3");
  await submit(page, "го");
  await expect(page.locator("#basket-dock-copy")).toContainText("3 шт.");
  await submit(page, "хлеб не надо");
  await expect(page.locator("#basket-proposal-status")).toContainText("930 г");
  await submit(page, "го");
  await expect(page.locator("#basket-dock-copy")).toContainText("3 шт.");
  await page.reload(); await openBasket(page);
  await expect(page.locator("#basket-content")).toContainText("Простоквашино");
  await expect(page.locator("#basket-content")).toContainText("930 г");
  await expect(page.locator("#basket-content")).not.toContainText("1 л");
  expect(calls()).toBe(0);
});

test("unreviewed cheaper source card remains read-only and an archived choice has no actions", async ({ page }) => {
  const calls = await setup(page);
  await submit(page, "хочу кефир");
  await submit(page, "тот подешевле");
  const cards = page.locator(".shopping-selection-card");
  await expect(cards.nth(0)).toContainText("Другая марка");
  await cards.nth(0).getByRole("button").click();
  await expect(page.locator("#basket-proposal-status")).toContainText("пока нельзя безопасно добавить");
  await expect(page.locator("#basket-proposal-status").getByRole("button", { name: "Применить изменения", exact: true })).toHaveCount(0);
  await submit(page, "го");
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
  await expect(page.locator("#shopping-dialogue-history").getByRole("button")).toHaveCount(0);
  await expect(page.locator("#shopping-dialogue-history").locator("img")).toHaveCount(0);
  expect(calls()).toBe(0);
});

test("retail catalog outage preserves an empty basket and never adds canonical kefir", async ({ page }) => {
  const calls = await setup(page, []);
  await submit(page, "Я хочу кефир");
  await expect(page.locator("#basket-proposal-status")).toContainText("не означает, что товара нет");
  await expect(page.locator(".shopping-selection-card")).toHaveCount(0);
  await submit(page, "го");
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
  expect(calls()).toBe(0);
});
