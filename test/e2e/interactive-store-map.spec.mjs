import {test,expect} from '@playwright/test';
import {selectStore,openStoreDetails} from './helpers/pixel-surface.mjs';

test('lazy SDK map supports marker card, store choice, keyboard search and touch-sized controls',async({page})=>{
  const vendor=[];page.on('request',request=>{if(request.url().includes('/vendor/maplibre'))vendor.push(request.url());});
  await page.goto('/test/support/store-map-harness.html?lazy');
  await page.waitForFunction(()=>window.harnessReady);
  expect(vendor).toHaveLength(0);
  await page.evaluate(()=>{window.mapHarness.stores.hidden=false;window.mapHarness.stores.openNearbyMap();window.mapHarness.geo.setManual({lat:55.928776,lon:38.003613});});
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({timeout:15000});
  await expect(page.locator('.stores-location-directory')).toBeHidden();
  const marker=page.locator('.stores-pin[data-store-location-id="globus-store-5001"]');
  try{await expect(marker).toBeVisible({timeout:15000});}catch(error){throw new Error(error.message+' SDK errors: '+JSON.stringify(await page.evaluate(()=>window.mapErrors)));}
  const box=await marker.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  await marker.click();await expect(marker).toHaveClass(/stores-pin-focused/u);await expect(marker).toHaveAttribute('aria-current','true');
  await expect(page.locator('.stores-pin-card')).toContainText('Пролетарский');
  await expect(page.locator('.stores-location-directory')).toBeHidden();
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
  await expect(page.locator('.stores-location-directory')).toBeVisible();
  await expect(page.locator('.stores-location-directory')).toHaveAttribute('open','');
  await expect(page.locator('#stores-known-locations li')).toHaveCount(1);
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

test('compact map mode offers a keyboard-only store route without duplicating the list by default',async({page})=>{
  await page.setViewportSize({width:320,height:800});
  await page.goto('/test/support/store-map-harness.html?lazy');
  await page.waitForFunction(()=>window.harnessReady);
  await page.evaluate(()=>{window.mapHarness.stores.hidden=false;window.mapHarness.stores.openNearbyMap();});
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({timeout:15000});
  const directory=page.locator('.stores-location-directory');
  const toggle=page.getByRole('button',{name:'Магазины списком',exact:true});
  await expect(directory).toBeHidden();
  await expect(toggle).toBeVisible();
  await toggle.focus();await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(directory).toBeVisible();await expect(directory).toHaveAttribute('open','');
  await expect(directory.locator(':scope > summary')).toBeHidden();
  const firstStore=page.locator('#stores-known-locations li button').first();
  await expect(firstStore).toBeFocused();
  const focusedBox=await firstStore.boundingBox();expect(focusedBox.y).toBeGreaterThanOrEqual(0);expect(focusedBox.y+focusedBox.height).toBeLessThanOrEqual(800);
  await page.keyboard.press('Enter');
  await expect(page.locator('.stores-pin-card')).toBeVisible();
  await expect(page.locator('.stores-pin-card')).toContainText('Пролетарский');
});

test('map centre and radius survive opening a catalogue and returning to stores',async({page,context})=>{
  test.setTimeout(90000);
  await page.route(/^https?:\/\/(?!(?:127\.0\.0\.1|localhost)(?::\d+)?\/)/u,route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='tiles.openfreemap.org')return route.abort();
    if(url.pathname==='/styles/liberty')return route.fulfill({json:{version:8,
      glyphs:new URL('/test/support/map-test-fonts/',page.url()).href+'{fontstack}/{range}.pbf',
      sources:{fixture:{type:'geojson',data:{type:'FeatureCollection',features:[]},attribution:'CHECKNI offline map fixture'}},
      layers:[{id:'background',type:'background',paint:{'background-color':'#e5e8de'}}]}});
    return route.abort();
  });
  await page.route('**/rest/v1/**',route=>route.fulfill({json:[]}));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({latitude:55.802136,longitude:37.299144,accuracy:10});
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-checkni-boot','ready',{timeout:20000});
  await selectStore(page,'globus');await openStoreDetails(page);
  await page.locator('#nearby-locate').click();await page.locator('#nearby-radius').selectOption('10');
  await page.locator('#nearby-shopping .nearby-location-actions button').filter({hasText:'На карте'}).click();
  const map=page.locator('.stores-map');await expect(map).toBeFocused();
  await map.press('ArrowRight');await page.getByRole('button',{name:'Искать здесь',exact:true}).click();
  await expect(page.locator('#nearby-radius')).toHaveValue('10');
  await expect(page.locator('#nearby-status')).toContainText('Точка на карте · до 10 км');
  await expect(page.getByRole('button',{name:'Искать здесь',exact:true})).toBeDisabled();
  const marker=page.locator('.stores-pin').first();
  await expect(marker).toBeVisible({timeout:15000});await marker.click();
  await page.locator('.stores-pin-card').getByRole('button',{name:'Открыть товары',exact:true}).click();
  await expect(page.locator('#pixel-storefront')).toBeVisible();
  await page.locator('[data-pixel-action="stores"]').click();
  await expect(page.locator('#pixel-store-home')).toBeVisible();
  await expect(page.locator('#nearby-radius')).toHaveValue('10');
  await page.locator('#nearby-shopping .nearby-location-actions button').filter({hasText:'На карте'}).click();
  await expect(map).toBeVisible();
  await expect(page.getByRole('button',{name:'Искать здесь',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
