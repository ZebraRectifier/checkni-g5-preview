import {test,expect} from '@playwright/test';

test('lazy SDK map supports marker card, store choice, keyboard search and touch-sized controls',async({page})=>{
  const vendor=[];page.on('request',request=>{if(request.url().includes('/vendor/maplibre'))vendor.push(request.url());});
  await page.goto('/test/support/store-map-harness.html?lazy');
  await page.waitForFunction(()=>window.harnessReady);
  expect(vendor).toHaveLength(0);
  await page.evaluate(()=>{window.mapHarness.stores.hidden=false;window.mapHarness.stores.openNearbyMap();window.mapHarness.geo.setManual({lat:55.928776,lon:38.003613});});
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({timeout:15000});
  const marker=page.locator('.stores-pin[data-store-location-id="globus-store-5001"]');
  try{await expect(marker).toBeVisible({timeout:15000});}catch(error){throw new Error(error.message+' SDK errors: '+JSON.stringify(await page.evaluate(()=>window.mapErrors)));}
  const box=await marker.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  await marker.click();await expect(page.locator('.stores-pin-card')).toContainText('Пролетарский');
  await expect(page.locator('.stores-pin-card a')).toHaveAttribute('href',/https:\/\/yandex\.ru\/maps\/\?rtext=/u);
  await page.locator('.stores-pin-card').getByRole('button',{name:'Открыть товары',exact:true}).click();
  await expect(page.locator('#selection')).toHaveText('selected:globus-store-5001');
  await page.locator('.stores-map').press('ArrowRight');
  await page.getByRole('button',{name:'Искать здесь',exact:true}).click();
  const point=await page.evaluate(()=>window.mapHarness.geo.getSnapshot().position);expect(point.lon).toBeGreaterThan(38.003613);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('WebGL failure keeps list selection, while region changes clear Moscow points and never invent catalogue access',async({page})=>{
  await page.goto('/test/support/store-map-harness.html?fail');
  await page.waitForFunction(()=>window.harnessReady);
  await page.evaluate(()=>window.mapHarness.stores.openNearbyMap());
  await expect(page.locator('#stores-tile-status')).toContainText('Магазины можно выбрать');
  await page.locator('#stores-known-locations').getByRole('button',{name:'Открыть товары',exact:true}).click();
  await expect(page.locator('#selection')).toHaveText('selected:globus-store-5001');
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('checkni:nearby-map-context',{detail:{revision:1,state:'loading',stores:[],radiusKm:3,position:{lat:55.79,lon:49.12}}})));
  await expect(page.locator('#stores-known-locations li')).toHaveCount(0);
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('checkni:nearby-map-context',{detail:{revision:2,state:'ready',radiusKm:3,position:{lat:55.79,lon:49.12},stores:[{id:'test:kazan',name:'Магнит',address:'Казань, тестовый адрес',lat:55.79,lon:49.12,retailerId:'magnit'}]}})));
  await expect(page.locator('#stores-known-locations')).toContainText('Казань');
  await expect(page.locator('#stores-known-locations').getByRole('button',{name:'Открыть товары',exact:true})).toHaveCount(0);
  await page.locator('#stores-known-locations').getByRole('button',{name:'Магнит',exact:true}).click();
  await expect(page.locator('.stores-pin-card')).toContainText('Каталог адреса пока не подключён');
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('checkni:nearby-map-context',{detail:{revision:3,state:'unsupported',stores:[],radiusKm:3,position:{lat:43.6,lon:39.7}}})));
  await expect(page.locator('#stores-known-locations li')).toHaveCount(0);await expect(page.locator('.stores-pin-card')).toBeHidden();
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('checkni:nearby-map-context',{detail:{revision:2,state:'ready',stores:[{id:'old',name:'Москва',lat:55,lon:37}]}})));
  await expect(page.locator('#stores-known-locations li')).toHaveCount(0);
});
