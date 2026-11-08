import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const data=JSON.parse(await readFile(new URL('../../src/data/nearby-regions/novosibirsk.json',import.meta.url)));
const point=data.stores.find(row=>row.id==='derived:maria-ra:novosibirsk:7ea826f098f0fa0cd855');

test('Novosibirsk Maria-Ra address stays an honest map landmark without a Moscow catalogue',async({page},info)=>{
  expect(data.stores).toHaveLength(551);expect(point).toBeTruthy();
  let aiCalls=0;const addresses=[];
  await page.route(/^https?:\/\/(?!(?:127\.0\.0\.1|localhost)(?::\d+)?\/)/u,route=>route.abort());
  await page.route('**/rest/v1/**',route=>route.fulfill({json:[]}));
  await page.route('**/functions/v1/ai-basket-proposal',route=>{aiCalls++;return route.abort();});
  await page.route('**/functions/v1/nearby-address',route=>{
    addresses.push(route.request().postDataJSON());
    return route.fulfill({json:{version:1,candidates:[{lat:55.75,lon:37.61,label:'Москва, Тверская, 1',precision:'house'}]}});
  });
  await page.route('https://tiles.openfreemap.org/**',route=>new URL(route.request().url()).pathname==='/styles/liberty'
    ?route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e5e8de'}}]}}):route.abort());
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-checkni-boot','ready',{timeout:20000});
  await page.locator('#nearby-address').fill('Новосибирск');await page.locator('#nearby-address').press('Enter');
  const city=page.locator('#nearby-address-candidates button');await expect(city).toContainText('центр');await city.click();
  await expect(page.locator('.pixel-location')).toHaveText('⌖ Новосибирск');
  await page.locator('#nearby-address').fill('Плющихинская 6');await page.locator('#nearby-address').press('Enter');
  const landmark=page.locator('#nearby-address-candidates button').filter({hasText:'Мария-Ра'});
  await expect(landmark).toContainText('магазин-ориентир');await expect(landmark).toContainText(point.address);
  await expect(page.locator('#nearby-address-candidates')).not.toContainText('Москва');await landmark.click();
  expect(addresses.at(-1)).toEqual({query:'Новосибирск, Плющихинская 6',consent:true});
  await page.locator('#nearby-radius').selectOption('1');
  const card=page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
  await expect(card).toContainText('Каталог этого адреса пока не подключён. Цены неизвестны.');
  await expect(card.getByRole('button',{name:'Открыть товары'})).toHaveCount(0);
  await expect(card.getByRole('link',{name:'Источник адреса'})).toHaveAttribute('href','https://www.maria-ra.ru/');
  await expect(page.locator('#nearby-results')).not.toContainText('Москва');
  await card.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('maria-ra-cards.png')});
  await page.locator('#nearby-shopping').getByRole('button',{name:'Выбрать точку на карте',exact:true}).click();
  const mapRow=page.locator(`#stores-known-locations li[data-store-location-id="${point.id}"]`);
  await mapRow.getByRole('button',{name:'Мария-Ра',exact:true}).click();
  const mapCard=page.locator('.stores-pin-card');
  await expect(mapCard).toContainText(point.address);await expect(mapCard).toContainText('Каталог адреса пока не подключён');
  await expect(mapCard.getByRole('button',{name:'Открыть товары'})).toHaveCount(0);
  await expect(mapCard.getByRole('link',{name:'Маршрут'})).toHaveAttribute('href',/yandex\.ru\/maps/u);
  await mapCard.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('maria-ra-map.png')});
  await page.getByRole('button',{name:'К списку магазинов',exact:true}).click();
  await expect(card).toBeVisible();await expect(page.locator('#nearby-radius')).toHaveValue('1');
  await page.locator('#nearby-connected-only').check();await expect(page.locator('#nearby-results article')).toHaveCount(0);
  await expect(page.locator('#nearby-status')).toContainText('покажи все магазины');
  await page.locator('#nearby-connected-only').uncheck();await expect(card).toBeVisible();
  expect(aiCalls).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
