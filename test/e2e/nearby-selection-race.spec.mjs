import { test, expect } from '@playwright/test';

for(const failure of ['transient','persistent'])test(`address ${failure} failure recovers without retyping or guessing a home`,async({page})=>{
 let requests=0;
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('**/rest/v1/**',route=>route.fulfill({json:[]}));
 await page.route('**/functions/v1/nearby-address',route=>{
  requests++;
  return failure==='persistent'||requests===1?route.fulfill({status:503,json:{error:'source_unavailable'}})
   :route.fulfill({json:{version:1,candidates:[{lat:55.802136,lon:37.299144,label:'Глобус Красногорск',precision:'street'}]}});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await page.locator('#nearby-address').fill('Глобус Красногорск');
 await page.locator('#nearby-address').press('Enter');
 await expect(page.locator('#nearby-address-candidates button').first()).toBeVisible();
 expect(requests).toBe(2);
 await expect(page.locator('#nearby-address')).toHaveValue('Глобус Красногорск');
 if(failure==='persistent')await expect(page.locator('#nearby-status')).toContainText('Это адрес магазина, не твоя геолокация');
 await page.locator('#nearby-address-candidates button').first().click();
 const card=page.locator('#nearby-results article').filter({hasText:'Глобус Красногорск'});
 await card.getByRole('button',{name:'Выбрать магазин'}).click();
 await expect(page.locator('#globus-store-address')).toHaveValue('5011');
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('latest nearby store choice owns the visible action and basket target', async ({ page }) => {
  await page.route('**/audit-nearby-selection', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html lang="ru"><head></head><body></body></html>'
  }));
  await page.goto('/audit-nearby-selection');

  await page.evaluate(async () => {
    const { createNearbyShopping } = await import('/src/components/NearbyShopping.mjs');
    const directory = await fetch('/src/data/nearbyGroceryStores.json').then(response => response.json());
    const ids = ['osm:node:11434441301', 'osm:node:2301677502'];
    const stores = ids.map(id => directory.stores.find(store => store.id === id));
    if (stores.some(store => !store?.catalogBinding)) throw Error('Exact linked stores required');

    let onLocationChange;
    const locationController = {
      subscribe(callback) { onLocationChange = callback; },
      setManual(position) { onLocationChange({ status: 'ready', position: { ...position, source: 'manual' } }); },
      clear() { onLocationChange({ status: 'idle', position: null }); },
      request() {}
    };
    const probe = { calls: [], currentStore: null, buildPoint: null, releaseFirst: null };
    window.__nearbyChoiceProbe = probe;
    const component = createNearbyShopping({
      port: { directory: async () => ({ ...directory, stores }) },
      locationController,
      onChoose: (_catalog, point, isCurrent) => {
        probe.currentStore = point.id;
        probe.calls.push(point.id);
        if (probe.calls.length === 1) return new Promise(resolve => {
          probe.releaseFirst = () => resolve(isCurrent());
        });
        return Promise.resolve(isCurrent());
      },
      onBuild: (_catalog, point) => { probe.buildPoint = point.id; }
    });
    document.body.append(component.element);
    component.open();
    component.setPosition({ lat: stores[0].lat, lon: stores[0].lon });
  });

  const cards = page.locator('#nearby-results article');
  await expect(cards).toHaveCount(2);
  await cards.nth(0).getByRole('button', { name: 'Выбрать магазин' }).click();
  await page.waitForFunction(() => typeof window.__nearbyChoiceProbe.releaseFirst === 'function');
  await cards.nth(1).getByRole('button', { name: 'Выбрать магазин' }).click();
  await expect(page.locator('#nearby-selected-store')).toContainText('Открытое шоссе, 2 к12');

  await page.evaluate(async () => {
    window.__nearbyChoiceProbe.releaseFirst();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  const selected = page.locator('#nearby-selected-store');
  await expect(selected.getByRole('button', { name: 'Собрать корзину здесь' })).toHaveCount(1);
  await expect(selected).toContainText('Открытое шоссе, 2 к12');
  await expect(selected).not.toContainText('Просторная улица, 11');

  await selected.getByRole('button', { name: 'Собрать корзину здесь' }).click();
  const result = await page.evaluate(() => ({ ...window.__nearbyChoiceProbe, releaseFirst: undefined }));
  expect(result.calls).toEqual(['osm:node:11434441301', 'osm:node:2301677502']);
  expect(result.buildPoint).toBe(result.currentStore);
  expect(result.currentStore).toBe('osm:node:2301677502');
});
