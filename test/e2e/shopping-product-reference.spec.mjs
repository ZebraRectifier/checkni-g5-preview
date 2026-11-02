import { test, expect } from "@playwright/test";

const submit = async (page, text) => {
  await page.locator("#basket-proposal-input").fill(text);
  await page.locator("#basket-proposal-submit").click();
};
const status = page => page.locator("#basket-proposal-status");
const sources = page => status(page).locator(".shopping-dialogue-sources a");
const savedBasket = page => page.evaluate(() => localStorage.getItem("checkni.surface.basket.v1"));

test("grounded cheese dialogue retains sources, changes no basket and clears provenance on a card question", async ({ page }) => {
  let calls = 0;
  await page.route("**/functions/v1/ai-basket-proposal", route => { calls++; return route.abort(); });
  await page.goto("/?comparison=demo#shop");
  await page.locator('[data-product-id="milk-25-900"]').getByRole("button").click();
  const before = await savedBasket(page);
  await submit(page, "Как выбрать сыр?");
  await expect(status(page)).toContainText("выбери формат");
  await expect(sources(page)).toHaveCount(2);
  await expect(sources(page).first()).toHaveAttribute("href", "https://dairyprocessinghandbook.tetrapak.com/chapter/cheese");
  await expect(sources(page).first()).toHaveAttribute("rel", "noopener noreferrer");
  await submit(page, "для бутербродов");
  await expect(status(page)).toContainText("намазка или ломтики");
  await submit(page, "а другой?");
  await expect(status(page)).toContainText("другой формат");
  const history = page.locator("#shopping-dialogue-history");
  await expect(history.locator(".shopping-dialogue-sources a")).toHaveCount(4);
  await expect(history.getByRole("button")).toHaveCount(0);
  await submit(page, "а какой состав?");
  await expect(status(page)).toContainText("нужна этикетка");
  await expect(sources(page)).toHaveCount(0);
  await expect(status(page).getByRole("button", { name: /Добавить|Применить/u })).toHaveCount(0);
  await submit(page, "го");
  await expect(status(page)).toContainText("Черновика для подтверждения сейчас нет");
  expect(calls).toBe(0);
  expect(await savedBasket(page)).toBe(before);
  await page.locator("#open-basket").click();
  await page.locator("#compare-basket").click();
  await expect(page.locator("#comparison-output")).not.toBeEmpty();
  await page.goBack();
  await page.reload();
  await expect(page.locator("#shopping-dialogue")).toBeHidden();
  expect(await savedBasket(page)).toBe(before);
});

test("dairy differences and label-based storage work with no model or fabricated numerical rule", async ({ page }) => {
  let calls = 0;
  await page.route("**/functions/v1/ai-basket-proposal", route => { calls++; return route.abort(); });
  await page.goto("/?comparison=demo#shop");
  for (const [question, answer, count] of [
    ["Чем молоко отличается от кефира?", "сквашиванием молока", 2],
    ["Чем пастеризованное молоко отличается от ультрапастеризованного?", "более высокой температуры", 2],
    ["Чем кефир отличается от йогурта?", "закваски различаются", 2],
    ["Чем твёрдый сыр отличается от мягкого?", "влагой и текстурой", 1],
    ["Сколько хранить сыр после открытия?", "отдельные указания производителя", 1]
  ]) {
    await submit(page, question);
    await expect(status(page)).toContainText(answer);
    await expect(sources(page)).toHaveCount(count);
    await expect(status(page)).not.toContainText(/Автоматический совет|доступен только|от 2 месяцев|храни 5 дней/u);
    await expect(page.locator("#basket-proposal-input")).toHaveValue("");
  }
  expect(calls).toBe(0);
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("an uncovered advice question rejects invented assortment, foreign phrases, shelf life and provider sources", async ({ page }) => {
  let response, calls = 0;
  await page.route("**/functions/v1/ai-basket-proposal", route => { calls++; return route.fulfill({ json: response }); });
  await page.goto("/?comparison=demo#shop");
  for (response of [
    { kind: "advice", message: "Из каталога доступен только полутвёрдый сыр." },
    { kind: "advice", message: "Выбирай выдержку от 2 месяцев." },
    { kind: "advice", message: "Открытое молоко храни 5 дней." },
    { kind: "advice", message: "Из готового фарша в списке нет, но можно сделать его самому из филе." },
    { kind: "advice", message: "Используй Meat grinder или блендер." },
    { kind: "advice", message: "Проверь упаковку.", referenceKey: "cheese-selection", sources: [{ url: "https://evil.test" }] }
  ]) {
    await submit(page, "Как выбрать рыбу для запекания?");
    await expect(status(page)).toContainText("Автоматический совет сейчас недоступен");
    await expect(status(page)).not.toContainText(/доступен только|от 2 месяцев|храни 5 дней|в списке нет|Meat grinder/u);
    await expect(sources(page)).toHaveCount(0);
    await expect(status(page).getByRole("button", { name: /Добавить|Применить/u })).toHaveCount(0);
  }
  expect(calls).toBe(6);
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
});

test("storage follow-ups keep the dairy subject and dialogue reset removes the source and subject", async ({ page }) => {
  let calls = 0;
  await page.route("**/functions/v1/ai-basket-proposal", route => { calls++; return route.abort(); });
  await page.goto("/?comparison=demo#shop");
  await submit(page, "Чем кефир отличается от молока?");
  await expect(status(page)).toContainText("сквашиванием молока");
  await submit(page, "а как их хранить?");
  await expect(status(page)).toContainText("именно твоей упаковки");
  await expect(sources(page)).toHaveCount(1);
  await submit(page, "после открытия?");
  await expect(status(page)).toContainText("отдельные указания производителя");
  await page.locator("#shopping-dialogue-clear").click();
  await expect(page.locator(".shopping-dialogue-sources")).toHaveCount(0);
  await submit(page, "а как хранить?");
  await expect(status(page)).toContainText("О каком продукте");
  await expect(sources(page)).toHaveCount(0);
  expect(calls).toBe(0);
});
