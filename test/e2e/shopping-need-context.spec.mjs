import { test, expect } from "@playwright/test";
import { openBasket, openHory, selectStore } from "./helpers/pixel-surface.mjs";

// Synthetic observations establish behavior only, never live retailer prices.
const base = { retailer_id: "magnit", store_id: "magnit-777312", store_name: "Магнит · Берёзовая аллея, 17к2",
  locality_id: "city-moscow", locality_name: "Москва", currency: "RUB", price_condition: "public-online",
  availability: "unknown", main_category_id: 63963, image_url: null, observed_at: "2026-10-10T06:30:00Z",
  source_url: "https://magnit.ru/catalog/63963-molochnyy_prilavok?shopCode=777312&shopType=1" };
const kefir = { ...base, source_product_id: "1899800689", name: "Кефир Простоквашино 2.5% 930г", weight_text: "930 г", price_minor: 7999,
  product_url: "https://magnit.ru/product/1899800689-kefir_prostokvashino_2_5_930g?shopCode=777312&shopType=1" };
const milk = { ...base, source_product_id: "1899800733", name: "Молоко Простоквашино пастеризованное 2.5% 930мл", weight_text: "930 мл", price_minor: 8999,
  product_url: "https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=777312&shopType=1" };
const submit = async (page, text) => {
  await openHory(page);
  await page.locator("#basket-proposal-input").fill(text);
  await page.locator("#basket-proposal-input").press("Enter");
};
async function setup(page) {
  const searches = []; let modelCalls = 0;
  await page.route("**/functions/v1/ai-basket-proposal", route => { modelCalls++; return route.abort(); });
  await page.route("**/functions/v1/beta-retail-prices", route => route.fulfill({ json: { kind: "insufficient", refreshedAt: new Date().toISOString(), offers: [] } }));
  await page.route("**/rest/v1/retail_catalog_categories**", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/retail_catalog_items**", route => {
    const query = new URL(route.request().url()).searchParams;
    const term = query.get("name")?.replace(/^ilike\.\*|\*$/gu, "").toLocaleLowerCase("ru-RU");
    if (term) searches.push(term);
    return route.fulfill({ json: query.get("retailer_id") === "eq.magnit"
      ? [kefir, milk].filter(row => !term || row.name.toLocaleLowerCase("ru-RU").includes(term)) : [] });
  });
  await page.goto("/?comparison=observed&catalog=retail#shop");
  await selectStore(page, "magnit");
  return { searches, modelCalls: () => modelCalls };
}

test("weekly household list keeps exact reviewed packs through confirmation, compare, Back and reload", async ({ page }) => {
  const calls = await setup(page), output = page.locator("#basket-proposal-status");
  await submit(page, "Хочу два кефира и три молока на неделю на двоих");
  await expect(output).toContainText("для 2 чел. на 7 дней");
  await expect(output).toContainText("Количество упаковок выберем отдельно");
  await expect(output).toContainText("Количество: 2 уп.");
  await expect(page.locator(".shopping-selection-card")).toHaveCount(1);
  await page.locator(".shopping-selection-card").getByRole("button").click();
  await expect(output).toContainText("930 г ×2");
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
  await submit(page, "го");
  await output.getByRole("button", { name: "Следующий товар", exact: true }).click();
  await expect(output).toContainText("Товар 2/2");
  await expect(output).toContainText("на 7 дней");
  await expect(output).toContainText("Количество: 3 уп.");
  await page.locator(".shopping-selection-card").getByRole("button").click();
  await expect(output).toContainText("930 мл ×3");
  await submit(page, "го");
  await expect(page.locator("#basket-dock-copy")).toContainText("5 шт. · 2 поз.");
  await openBasket(page);
  await expect(page.locator("#basket-content")).toContainText("930 г");
  await expect(page.locator("#basket-content")).toContainText("930 мл");
  await page.locator("#compare-basket").click();
  await page.getByRole("button", { name: "Подтвердить товары и сравнить", exact: true }).click();
  await expect(page.getByLabel("Результат по наблюдаемым ценам")).toContainText("Недостаточно данных");
  await page.locator("#back-to-shop").click(); await page.reload();
  await expect(page.locator("#basket-dock-copy")).toContainText("5 шт. · 2 поз.");
  await submit(page, "го");
  await expect(page.locator("#basket-dock-copy")).toContainText("5 шт. · 2 поз.");
  expect(calls.searches).toEqual(expect.arrayContaining(["кефир", "молоко"]));
  expect(calls.searches.some(term => /недел|двоих/u.test(term))).toBe(false);
  expect(calls.modelCalls()).toBe(0);
});

test("meat-free meal keeps its household and entire-week budget before real source selection", async ({ page }) => {
  const calls = await setup(page), output = page.locator("#basket-proposal-status");
  await submit(page, "Ужин на двоих без мяса до 700 ₽");
  await expect(output).toContainText("700 ₽ на всех");
  await expect(output).toContainText("Хочешь быстро приготовить");
  await expect(output).not.toContainText("Не распознала");
  await output.getByRole("button", { name: "Без готовки", exact: true }).click();
  await expect(output).toContainText("Бутерброды с сыром и томатами");
  await submit(page, "Ужин на двоих на неделю без мяса до 1300 ₽");
  await expect(output).toContainText("на 7 дней");
  await expect(output).toContainText("1300 ₽ на весь период");
  await expect(output).toContainText("Полное меню на этот срок ещё не составлено");
  await submit(page, "кефир");
  await expect(page.locator(".shopping-selection-card")).toHaveCount(1);
  await expect(output).toContainText("для 2 чел. на 7 дней");
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
  await submit(page, "что ты помнишь?");
  await expect(output).toContainText("мясо и птица");
  await expect(output).toContainText("на 7 дней");
  expect(calls.modelCalls()).toBe(0);
});

test("ambiguous household and unknown composition conditions cannot apply an old draft on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await setup(page), output = page.locator("#basket-proposal-status");
  await submit(page, "Хочу кефир");
  await page.locator(".shopping-selection-card").getByRole("button").click();
  await expect(output).toContainText("930 г ×1");
  await submit(page, "на 2-3 человека");
  await expect(output).toContainText("одно целое число от 1 до 12");
  await submit(page, "го");
  await expect(output).toContainText("Черновика для подтверждения сейчас нет");
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
  await submit(page, "Хочу кефир на неделю без сахара");
  await expect(output).toContainText("Не распознала: без сахара");
  await expect(page.locator(".shopping-selection-card")).toHaveCount(0);
  await submit(page, "что ты помнишь?");
  await expect(output).toContainText("на 7 дней");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls.modelCalls()).toBe(0);
});
