import { test, expect } from "@playwright/test";

const submit = async (page, text) => {
  await page.locator("#basket-proposal-input").fill(text);
  await page.locator("#basket-proposal-submit").click();
};
const status = page => page.locator("#basket-proposal-status");
const sources = page => status(page).locator(".shopping-dialogue-sources a");
const savedBasket = page => page.evaluate(() => localStorage.getItem("checkni.surface.basket.v1"));

test("mince choice accepts a bare purpose, shows general sources and preserves the confirmed shopping flow", async ({ page }) => {
  let calls = 0;
  await page.route("**/functions/v1/ai-basket-proposal", route => { calls++; return route.abort(); });
  await page.goto("/?comparison=demo#shop");
  await page.locator('[data-product-id="milk-25-900"]').getByRole("button").click();
  const before = await savedBasket(page);
  await submit(page, "Как выбрать куриный фарш?");
  await expect(status(page)).toContainText("из какого мяса");
  await expect(sources(page)).toHaveCount(2);
  await expect(sources(page).first()).toHaveAttribute("href", "https://zpp.rospotrebnadzor.ru/news/federal/248504");
  await submit(page, "котлеты");
  await expect(status(page)).toContainText("Для котлет");
  await submit(page, "а как хранить?");
  await expect(status(page)).toContainText("именно этой упаковки");
  await expect(sources(page)).toHaveCount(1);
  await submit(page, "а какой состав?");
  await expect(status(page)).toContainText("этикетка");
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
  expect(await savedBasket(page)).toBe(before);
});

test("ready-food choice and short heating replies stay read-only without an AI request", async ({ page }) => {
  let calls = 0;
  await page.route("**/functions/v1/ai-basket-proposal", route => { calls++; return route.abort(); });
  await page.goto("/?comparison=demo#shop");
  const before = await savedBasket(page);
  for (const [text, answer] of [["Как выбрать готовую еду без готовки?", "сырые"], ["только разогреть", "микроволновке"],
    ["без разогрева", "без разогрева"], ["а другой?", "готовое блюдо"]]) {
    await submit(page, text);
    await expect(status(page)).toContainText(new RegExp(answer, "iu"));
    await expect(sources(page)).toHaveCount(2);
    await expect(status(page).getByRole("button", { name: /Добавить|Применить/u })).toHaveCount(0);
    await expect(status(page)).not.toContainText(/Изменения после подтверждения|Автоматический совет|филе|Meat grinder/u);
    await expect(page.locator("#basket-proposal-input")).toHaveValue("");
  }
  await submit(page, "го");
  await expect(status(page)).toContainText("Черновика для подтверждения сейчас нет");
  expect(calls).toBe(0);
  expect(await savedBasket(page)).toBe(before);
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("ready-versus-raw and storage explanations retain the subject only until dialogue reset", async ({ page }) => {
  let calls = 0;
  await page.route("**/functions/v1/ai-basket-proposal", route => { calls++; return route.abort(); });
  await page.goto("/?comparison=demo#shop");
  await submit(page, "Чем готовое блюдо отличается от сырого полуфабриката?");
  await expect(status(page)).toContainText("нужно приготовить");
  await expect(sources(page)).toHaveCount(2);
  await submit(page, "а как хранить?");
  await expect(status(page)).toContainText("указания производителя");
  await expect(sources(page)).toHaveCount(1);
  await submit(page, "после открытия?");
  await expect(status(page)).toContainText("срок закрытой упаковки");
  await page.locator("#shopping-dialogue-clear").click();
  await submit(page, "а как хранить?");
  await expect(status(page)).toContainText("О каком продукте");
  await expect(sources(page)).toHaveCount(0);
  expect(calls).toBe(0);
  await expect(page.locator("#basket-dock-copy")).toContainText("Пока пусто");
});
