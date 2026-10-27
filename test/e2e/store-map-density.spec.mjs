import { test, expect } from "@playwright/test";
import { selectStore, openStoreDetails } from "./helpers/pixel-surface.mjs";

test("store map shows one network at a time while keeping every address in the list", async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      ? route.continue() : route.abort();
  });
  await page.goto("/?comparison=observed&catalog=retail#shop", { waitUntil: "domcontentloaded" });
  await selectStore(page, "globus");
  await openStoreDetails(page);
  await page.locator("#stores-section").scrollIntoViewIfNeeded();
  await expect.poll(async () => Number((await page.locator(".stores-location-directory > summary").textContent())?.match(/\d+/u)?.[0]))
    .toBeGreaterThanOrEqual(64);
  const allAddressCount = await page.locator("#stores-known-locations li").count();
  const filter = page.locator("#stores-map-network");
  await expect(filter).toHaveValue("all");
  await page.locator(".stores-map").scrollIntoViewIfNeeded();
  const visibleLabels = async () => page.locator(".stores-pin-label").evaluateAll(nodes =>
    nodes.filter(label => getComputedStyle(label).visibility !== "hidden").length);
  expect(await visibleLabels()).toBeLessThanOrEqual(2);

  await filter.selectOption("metro");
  await expect(page.locator('.stores-pin[data-store-location-id="metro-leningradskoe"]')).toHaveCount(1);
  await expect(page.locator('.stores-pin[data-store-location-id^="magnit-"]')).toHaveCount(0);
  await expect(page.locator('.stores-pin[data-store-location-id^="globus-"]')).toHaveCount(0);
  expect(await page.locator("#stores-known-locations li").count()).toBe(allAddressCount);

  await filter.selectOption("magnit");
  await expect(page.locator('.stores-pin[data-store-location-id^="magnit-bound-"]').first()).toBeVisible();
  await expect(page.locator('.stores-pin[data-store-location-id="metro-leningradskoe"]')).toHaveCount(0);
  expect(await visibleLabels()).toBeLessThanOrEqual(2);
});
