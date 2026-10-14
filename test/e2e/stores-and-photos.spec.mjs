import { expect, test } from "@playwright/test";

test("stores section shows observed pins, honest network rows and OSM attribution", async ({ page }) => {
  // No live tiles in CI: registered points and controls remain usable.
  await page.route("**/tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/");

  const section = page.locator("#stores-section");
  await expect(section).toBeVisible();
  await expect(section).toContainText("Магазины и ваше место");
  await expect(section).toContainText("точка на карте приблизительная");

  // Official registered points and dated observed points get distinct pins.
  await expect(section.locator(".stores-pin")).toHaveCount(18);
  await expect(section).toContainText("125445, г. Москва, Ленинградское шоссе 71Г");
  await expect(section).toContainText("официального справочника");
  await expect(section).toContainText("конкретный магазин не привязан");
  await expect(
    section.locator(".stores-map-attribution a")
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
});

test("catalogue renders fully when the photos edge is unreachable", async ({ page }) => {
  await page.route("**/functions/v1/catalog-photos", (route) => route.abort());
  await page.goto("/");

  const cards = page.locator("#product-grid .product-card");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(50);
  await expect(page.locator("#product-grid .product-photo")).toHaveCount(0);
});

const PHOTO_PROBE_CODE = "46000001";
const PHOTO_PROBE_URL =
  "https://images.openfoodfacts.org/images/products/461/000/000/0001/front_ru.4.200.jpg";
const PHOTO_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, apikey",
  "access-control-allow-methods": "POST, OPTIONS"
};

async function routePhotoProbe(page, handler) {
  await page.route("**/functions/v1/catalog-photos", async route => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: PHOTO_CORS });
      return;
    }
    const body = route.request().postDataJSON();
    if (!body?.requests?.some(request => request.code === PHOTO_PROBE_CODE)) {
      await route.abort();
      return;
    }
    await handler(route);
  });
}

async function returnProbePhoto(route) {
  await route.fulfill({
    status: 200,
    headers: PHOTO_CORS,
    contentType: "application/json",
    body: JSON.stringify({
      kind: "photos",
      photos: [{ key: "c:" + PHOTO_PROBE_CODE, url: PHOTO_PROBE_URL }]
    })
  });
}

test("photo recovery uses the browser port without reload and preserves the shopping journey", async ({ page }) => {
  let online = false;
  let requests = 0;
  await routePhotoProbe(page, async route => {
    requests += 1;
    if (!online) await route.abort();
    else await returnProbePhoto(route);
  });
  await page.goto("/");

  const failures = await page.evaluate(async code => {
    const { createProductPhotoLoader } = await import("/src/runtime/productPhotos.mjs");
    const { requestCatalogPhotos } = await import("/src/ports/catalogPhotosPort.mjs");
    window.__photoProbeTime = 1000;
    window.__photoProbeLoader = createProductPhotoLoader({
      requestPhotos: requestCatalogPhotos,
      now: () => window.__photoProbeTime,
      batchIntervalMs: 0,
      setTimeoutImpl: fn => { queueMicrotask(fn); return 0; }
    });
    return [
      await window.__photoProbeLoader.load({ code }),
      await window.__photoProbeLoader.load({ code }),
      await window.__photoProbeLoader.load({ code })
    ];
  }, PHOTO_PROBE_CODE);
  expect(failures).toEqual([null, null, null]);
  expect(requests).toBe(3);

  for (const id of ["milk-25-900", "eggs-c1-10", "apples-1kg"]) {
    await page.locator('[data-product-id="' + id + '"]').getByRole("button").click();
  }
  await page.locator("#open-basket").click();
  await page.locator("#compare-basket").click();
  const result = page.getByLabel("Лучший вариант покупки");
  await expect(result).toContainText("Mock Beta");
  await expect(result).toContainText("369,70 ₽");
  await expect(result).toContainText("3 из 3 позиций");
  const basket = await page.evaluate(() => localStorage.getItem("checkni.surface.basket.v1"));

  online = true;
  const resumed = await page.evaluate(async code => {
    window.__photoProbeTime += 60_000;
    return window.__photoProbeLoader.load({ code });
  }, PHOTO_PROBE_CODE);
  expect(resumed).toBe(PHOTO_PROBE_URL);
  expect(requests).toBe(4);
  expect(await page.evaluate(() => localStorage.getItem("checkni.surface.basket.v1"))).toBe(basket);
  await expect(result).toContainText("369,70 ₽");

  await page.locator("#back-to-shop").click();
  await expect(page).toHaveURL(/#shop$/);
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem("checkni.surface.basket.v1"))).toBe(basket);
});

test("browser photo lookup rejects a poisoned cache and fetches a trusted replacement", async ({ page }) => {
  let requests = 0;
  await routePhotoProbe(page, async route => {
    requests += 1;
    await returnProbePhoto(route);
  });
  await page.goto("/");
  const photo = await page.evaluate(async code => {
    const { createProductPhotoLoader } = await import("/src/runtime/productPhotos.mjs");
    const { requestCatalogPhotos } = await import("/src/ports/catalogPhotosPort.mjs");
    localStorage.setItem("checkni.productPhotos.v1", JSON.stringify({
      ["c:" + code]: { at: 999, url: "https://wrong.example/corrupt.jpg" }
    }));
    const loader = createProductPhotoLoader({
      requestPhotos: requestCatalogPhotos,
      storage: localStorage,
      now: () => 1000,
      batchIntervalMs: 0,
      setTimeoutImpl: fn => { queueMicrotask(fn); return 0; }
    });
    return loader.load({ code });
  }, PHOTO_PROBE_CODE);
  expect(photo).toBe(PHOTO_PROBE_URL);
  expect(requests).toBe(1);
  const cached = await page.evaluate(code =>
    JSON.parse(localStorage.getItem("checkni.productPhotos.v1"))["c:" + code],
    PHOTO_PROBE_CODE
  );
  expect(cached).toEqual({ at: 1000, url: PHOTO_PROBE_URL });
});

