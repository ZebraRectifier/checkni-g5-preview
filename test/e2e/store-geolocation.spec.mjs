import { expect, test } from "@playwright/test";

// These tests exercise the public journey with synthetic device callbacks.
// No retailer, tile, image, AI or live price service is contacted.
async function isolateNetwork(page) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      ? route.continue() : route.abort();
  });
  await page.route("**/rest/v1/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS"
    },
    body: "[]"
  }));
  await page.route("**/src/ports/observedOffersPort.mjs", route => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: "export const observedOffersPort = { async load() { return []; } };"
  }));
  await page.route("**/functions/v1/catalog-photos", route => route.abort());
}

async function stubDevice(page, mode) {
  await page.addInitScript(({ mode }) => {
    window.__checkniGeoProbe = { requests: [], callbacks: [] };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success, failure, options) {
          const probe = window.__checkniGeoProbe;
          probe.requests.push({ ...options });
          probe.callbacks.push({ success, failure });
          if (mode === "denied") failure({ code: 1 });
          if (mode === "success") success({
            coords: {
              latitude: 55.887168, longitude: 37.639079, accuracy: 24
            },
            timestamp: Date.now()
          });
        }
      }
    });
  }, { mode });
}

async function basketSnapshot(page) {
  return page.evaluate(() => localStorage.getItem("checkni.surface.basket.v1"));
}

async function fireLateSuccess(page, index) {
  await page.evaluate(index => {
    window.__checkniGeoProbe.callbacks[index].success({
      coords: { latitude: 59.9386, longitude: 30.3141, accuracy: 5 },
      timestamp: Date.now()
    });
  }, index);
}

test("device location is explicit, keeps the demo basket result and is forgotten on reload", async ({ page }) => {
  await isolateNetwork(page);
  await stubDevice(page, "success");
  await page.goto("/?comparison=demo#shop");

  const locate = page.locator("#stores-locate");
  await expect(locate).toBeVisible();
  expect(await page.evaluate(() => window.__checkniGeoProbe.requests)).toEqual([]);
  await expect(page.locator(".stores-user-pin")).toHaveCount(0);

  for (const id of ["milk-25-900", "eggs-c1-10", "apples-1kg"]) {
    await page.locator(`[data-product-id="${id}"]`).getByRole("button").click();
  }
  await page.locator("#open-basket").click();
  await page.locator("#compare-basket").click();
  const result = page.getByLabel("Лучший вариант покупки");
  await expect(result).toContainText("Mock Beta");
  await expect(result).toContainText("369,70 ₽");
  const resultBeforeLocation = await result.textContent();
  const basketBeforeLocation = await basketSnapshot(page);
  expect(basketBeforeLocation).not.toBeNull();
  await page.locator("#back-to-shop").click();

  await locate.click();
  await expect(page.locator("#stores-location-status")).toContainText("Точность устройства: ≈ 24 м");
  await expect(page.getByRole("img", { name: "Ваше место", exact: true })).toBeVisible();
  await expect(page.locator(".stores-user-pin")).toContainText("Вы здесь");
  const requests = await page.evaluate(() => window.__checkniGeoProbe.requests);
  expect(requests).toHaveLength(1);
  expect(requests[0].enableHighAccuracy).toBe(false);
  expect(requests[0].maximumAge).toBe(0);
  expect(requests[0].timeout).toBeGreaterThan(0);
  expect(requests[0].timeout).toBeLessThanOrEqual(10_000);
  await page.locator(".stores-location-directory > summary").click();
  await expect(page.locator("#stores-known-locations")).toContainText("км по прямой");
  expect(await basketSnapshot(page)).toBe(basketBeforeLocation);
  await page.locator("#open-basket").click();
  await expect(result).toHaveText(resultBeforeLocation);
  await page.locator("#back-to-shop").click();

  await page.reload();
  await expect(locate).toBeVisible();
  await expect(page.locator(".stores-user-pin")).toHaveCount(0);
  await expect(page.locator("#stores-location-status")).toContainText("Место ещё не указано");
  expect(await page.evaluate(() => window.__checkniGeoProbe.requests)).toEqual([]);
  expect(await basketSnapshot(page)).toBe(basketBeforeLocation);
});

test("device location leaves an explicitly selected observed GLOBUS pair unchanged", async ({ page }) => {
  await isolateNetwork(page);
  await stubDevice(page, "success");
  await page.goto("/?comparison=observed&catalog=retail#shop");

  const primary = page.locator("#globus-store-address");
  const peer = page.locator("#globus-compare-address");
  await expect(primary).toHaveValue("5011");
  await peer.selectOption("5020");
  const selected = page.locator("#stores-selected-addresses");
  await expect(selected.locator("li")).toHaveCount(2);
  await expect(selected).toContainText("Новорижское шоссе");
  await expect(selected).toContainText("Широкая, 2а");
  await expect(selected).not.toContainText("METRO");
  await expect(selected).not.toContainText("Магнит");
  const basketBeforeLocation = await basketSnapshot(page);

  expect(await page.evaluate(() => window.__checkniGeoProbe.requests)).toEqual([]);
  await page.locator("#stores-locate").click();
  await expect(page.locator(".stores-user-pin")).toContainText("Вы здесь");
  await expect(primary).toHaveValue("5011");
  await expect(peer).toHaveValue("5020");
  await expect(selected.locator("li")).toHaveCount(2);
  await expect(selected).toContainText("Новорижское шоссе");
  await expect(selected).toContainText("Широкая, 2а");
  await expect(selected).toContainText("км по прямой");
  expect(await basketSnapshot(page)).toBe(basketBeforeLocation);

  await page.reload();
  await expect(primary).toHaveValue("5011");
  await expect(peer).toHaveValue("5020");
  await expect(selected.locator("li")).toHaveCount(2);
  await expect(page.locator(".stores-user-pin")).toHaveCount(0);
  expect(await page.evaluate(() => window.__checkniGeoProbe.requests)).toEqual([]);
});

test("denied device access recovers through a keyboard-picked manual point and clear", async ({ page }) => {
  await isolateNetwork(page);
  await stubDevice(page, "denied");
  await page.goto("/?comparison=demo#shop");

  const status = page.locator("#stores-location-status");
  const manual = page.locator("#stores-manual-location");
  const clear = page.locator("#stores-clear-location");
  await page.locator("#stores-locate").click();
  await expect(status).toContainText("Доступ к геопозиции запрещён");
  await expect(page.locator(".stores-user-pin")).toHaveCount(0);
  await expect(page.locator("#stores-locate")).toBeEnabled();

  await manual.click();
  await expect(manual).toHaveAttribute("aria-pressed", "true");
  await expect(status).toContainText("Enter выбирает центр");
  const map = page.locator(".stores-map");
  await expect(map).toBeFocused();
  await map.press("Enter");
  await expect(status).toHaveText("Ориентир указан вручную.");
  await expect(page.locator(".stores-user-pin")).toContainText("Ваш ориентир");
  await expect(manual).toHaveAttribute("aria-pressed", "false");
  await expect(clear).toBeEnabled();
  expect(await page.evaluate(() => window.__checkniGeoProbe.requests.length)).toBe(1);

  await clear.click();
  await expect(status).toContainText("Место ещё не указано");
  await expect(page.locator(".stores-user-pin")).toHaveCount(0);
  await expect(clear).toBeDisabled();
  await expect(page.getByRole("button", { name: "К моему месту", exact: true })).toBeDisabled();
});

test("manual choice and clear reject late device callbacks while a request is pending", async ({ page }) => {
  await isolateNetwork(page);
  await stubDevice(page, "pending");
  await page.goto("/?comparison=demo#shop");

  const locate = page.locator("#stores-locate");
  const status = page.locator("#stores-location-status");
  const manual = page.locator("#stores-manual-location");
  const clear = page.locator("#stores-clear-location");
  await locate.click();
  await expect(locate).toBeDisabled();
  await expect(status).toContainText("Определяем место");
  await expect(clear).toBeEnabled();
  expect(await page.evaluate(() => window.__checkniGeoProbe.requests.length)).toBe(1);

  await manual.click();
  const map = page.locator(".stores-map");
  await map.press("ArrowRight");
  await map.press("Enter");
  await expect(status).toHaveText("Ориентир указан вручную.");
  const marker = page.locator(".stores-user-pin");
  await expect(marker).toContainText("Ваш ориентир");
  const manualMarkerStyle = await marker.getAttribute("style");
  await expect(locate).toBeEnabled();
  await fireLateSuccess(page, 0);
  await expect(status).toHaveText("Ориентир указан вручную.");
  await expect(marker).toContainText("Ваш ориентир");
  await expect(marker).toHaveAttribute("style", manualMarkerStyle);

  await locate.click();
  await expect(locate).toBeDisabled();
  await expect(status).toContainText("Определяем место");
  expect(await page.evaluate(() => window.__checkniGeoProbe.requests.length)).toBe(2);
  await clear.click();
  await expect(locate).toBeEnabled();
  await expect(status).toContainText("Место ещё не указано");
  await expect(marker).toHaveCount(0);
  await fireLateSuccess(page, 1);
  await expect(status).toContainText("Место ещё не указано");
  await expect(marker).toHaveCount(0);
  await expect(manual).toHaveAttribute("aria-pressed", "false");
  await expect(clear).toBeDisabled();
});
