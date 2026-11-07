import { test, expect } from "@playwright/test";
import { selectStore, openStoreDetails } from "./helpers/pixel-surface.mjs";

test("store map filters and paginates the address list even when the basemap is unavailable", async ({ page }) => {
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
  await page.locator('.stores-location-directory').evaluate(node=>{node.open=true;});
  await expect(page.locator('#stores-known-locations li')).toHaveCount(5);
  const filter = page.locator("#stores-map-network");
  await expect(filter).toHaveValue("all");
  await filter.selectOption("metro");
  await expect(page.locator('#stores-known-locations li')).toHaveCount(1);
  await expect(page.locator('#stores-known-locations')).toContainText('METRO');
  await expect(page.locator('#stores-known-locations')).not.toContainText('Глобус');
  await filter.selectOption("magnit");
  await expect(page.locator('#stores-known-locations li')).toHaveCount(5);
  await page.getByRole('button',{name:'Показать ещё магазины',exact:true}).click();
  await expect(page.locator('#stores-known-locations li')).toHaveCount(15);
  await expect(page.locator('#stores-known-locations')).not.toContainText('METRO');
  await expect(page.locator('#stores-known-locations li[data-store-location-id^="magnit-bound-"]').first()).toBeVisible();
});
