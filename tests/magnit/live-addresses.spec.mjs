import {test,expect} from "@playwright/test";
test("real Magnit cards are scoped to each imported Moscow address",async({page})=>{
 const responses = new Map();
 page.on("response",async response=>{
  const u=new URL(response.url());
  if(!u.pathname.endsWith("/rest/v1/retail_catalog_items") || u.searchParams.get("retailer_id")!=="eq.magnit" || response.status()!==200)return;
  try{responses.set(u.searchParams.get("store_id"),await response.json());}catch{}
 });
 await page.goto("./?comparison=observed&catalog=retail#shop");
 await page.locator("#retail-store-card-magnit").click();
 for(const code of ["777312","303857","908621","771878"]){
  await page.locator("#magnit-store-address").selectOption(code);
  const cards=page.locator('[data-product-id^="retail:magnit:magnit-'+code+':"]');
  await expect(cards.first()).toBeVisible({timeout:30000});
  await expect.poll(()=>responses.get("eq.magnit-"+code)?.length??0).toBeGreaterThan(0);
  const rows=responses.get("eq.magnit-"+code);
  expect(rows.every(r=>r.store_id==="magnit-"+code&&new URL(r.product_url).searchParams.get("shopCode")===code)).toBe(true);
  const id=(await cards.first().getAttribute("data-product-id")).split(":").at(-1);
  const row=rows.find(r=>String(r.source_product_id)===id);
  expect(row).toBeTruthy();
  await expect(cards.first()).toContainText(row.name);
  await expect(cards.first()).toContainText((row.price_minor/100).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}));
  await expect(cards.first().locator("img")).toHaveAttribute("src",row.image_url);
  await expect.poll(()=>cards.first().locator("img").evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(page.locator('[data-product-id^="retail:magnit:"]:not([data-product-id^="retail:magnit:magnit-'+code+':"])')).toHaveCount(0);
  console.log(JSON.stringify({address:code,cards:rows.length,product:id,priceMinor:row.price_minor,officialImage:true}));
 }
 await page.reload();
 await expect(page.locator("#magnit-store-address")).toHaveValue("771878");
 await expect(page.locator('[data-product-id^="retail:magnit:magnit-771878:"]').first()).toBeVisible();
 const width=await page.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth}));
 expect(width.body).toBeLessThanOrEqual(width.viewport+1);
});
