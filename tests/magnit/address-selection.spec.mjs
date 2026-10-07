import { test, expect } from "@playwright/test";

async function fixture(page, { delayFirst = false } = {}) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstRequested = false;
  const seen = [];
  await page.route("**/functions/v1/catalog-search", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({kind:"catalog",products:[],partial:false})
  }));
  await page.route("**/rest/v1/retail_catalog_categories**", route => {
    const url = new URL(route.request().url());
    const code = (url.searchParams.get("store_id") ?? "").replace("eq.magnit-", "");
    const rows = ["777312", "303857"].includes(code) && url.searchParams.get("depth") === "eq.0"
      ? [{ retailer_id:"magnit",store_id:"magnit-"+code,category_id:63963,name:"Молочный прилавок",
           parent_id:null,root_id:63963,depth:0,product_count:1,
           source_url:"https://magnit.ru/catalog/63963-milk?shopCode="+code+"&shopType=1" }]
      : [];
    return route.fulfill({ contentType:"application/json",body:JSON.stringify(rows) });
  });
  await page.route("**/rest/v1/retail_catalog_items**", async route => {
    const url = new URL(route.request().url());
    const code = (url.searchParams.get("store_id") ?? "").replace("eq.magnit-", "");
    seen.push(code);
    if (code === "777312" && delayFirst) { firstRequested = true; await gate; }
    const rows = ["777312","303857"].includes(code) ? [{
      retailer_id:"magnit",store_id:"magnit-"+code,store_name:"Магнит",locality_id:"city-moscow",locality_name:"Москва",
      source_product_id:"1899800733",name:"Молоко Простоквашино 930мл",price_minor:code==="777312"?7999:14999,
      currency:"RUB",price_condition:"public-online",availability:"unknown",main_category_id:63963,
      product_url:"https://magnit.ru/product/1899800733-moloko?shopCode="+code+"&shopType=1",
      source_url:"https://magnit.ru/product/1899800733-moloko?shopCode="+code+"&shopType=1",
      image_url:"https://images-foodtech.magnit.ru/test-product.png",weight_text:"930мл",
      observed_at:new Date().toISOString()
    }] : [];
    await route.fulfill({contentType:"application/json",body:JSON.stringify(rows)});
  });
  await page.route("https://images-foodtech.magnit.ru/**", route => route.fulfill({
    contentType:"image/png",
    body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")
  }));
  return { seen, release, requested: () => firstRequested };
}
const card = (page, code) => page.locator('[data-product-id="retail:magnit:magnit-'+code+':1899800733"]');

test("Magnit address changes prices, persists on reload, and restores on Back without fallback", async ({page}) => {
  await fixture(page);
  await page.goto("/?comparison=observed&catalog=retail#shop");
  await page.locator("#retail-store-card-magnit").click();
  const picker = page.locator("#magnit-store-address");
  await expect(picker).toBeVisible();
  await expect(card(page,"777312")).toContainText("79,99 ₽");
  await picker.selectOption("303857");
  await expect(card(page,"303857")).toContainText("149,99 ₽");
  await expect(card(page,"777312")).toHaveCount(0);
  await page.reload();
  await expect(picker).toHaveValue("303857");
  await expect(card(page,"303857")).toContainText("149,99 ₽");
  await picker.selectOption("908621");
  await expect(card(page,"303857")).toHaveCount(0);
  await expect(page.locator("#magnit-store-note")).toHaveText("Каталог по этому адресу ещё не загружен.");
  await page.goBack();
  await expect(picker).toHaveValue("303857");
  await expect(card(page,"303857")).toContainText("149,99 ₽");
  await expect(page.locator("#retail-store-card-magnit")).toContainText("3 кв-л");
});

test("late response from the previous Magnit address cannot replace the selected address", async ({page}) => {
  const control = await fixture(page, {delayFirst:true});
  await page.goto("/?comparison=observed&catalog=retail#shop");
  await page.locator("#retail-store-card-magnit").click();
  await expect.poll(control.requested).toBe(true);
  await page.locator("#magnit-store-address").selectOption("303857");
  await expect(card(page,"303857")).toContainText("149,99 ₽");
  control.release();
  await expect(card(page,"777312")).toHaveCount(0);
  await expect(card(page,"303857")).toContainText("149,99 ₽");
  expect(control.seen).toContain("303857");
});
