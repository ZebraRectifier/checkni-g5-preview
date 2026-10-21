import { openHory, closeHory, selectStore, openStoreDetails } from './helpers/pixel-surface.mjs';
import{test,expect}from'@playwright/test';
test.setTimeout(60000);
const say=async(page,text)=>{await openHory(page);await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
async function isolate(page){
  await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await page.route('**/rest/v1/**',r=>r.fulfill({json:[]}));
}
test('address consent → candidate → radius → agreed store → household intake preserves basket and forgets location on reload',async({page})=>{
  await isolate(page);let addressCalls=0,ai=0;
  await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
  await page.route('**/functions/v1/nearby-address',r=>{addressCalls++;expect(r.request().postDataJSON()).toEqual({query:'Пушкино, Красноармейское шоссе, 105',consent:true});
    return r.fulfill({json:{version:1,candidates:[{lat:56.01942,lon:37.885139,label:'Московская область, Пушкино, Красноармейское шоссе, 105',precision:'house'}]}});});
  await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page);await openStoreDetails(page);
  const nearby=page.locator('#nearby-shopping');await nearby.getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
  await page.locator('#nearby-address').fill('Пушкино, Красноармейское шоссе, 105');expect(addressCalls).toBe(0);
  await page.locator('#nearby-address-search').click();
  await page.locator('#nearby-address-candidates').getByRole('button').click();
  await expect(page.locator('#nearby-status')).toContainText('до 5 км');
  await expect(page.locator('#nearby-connected-only')).toBeChecked();
  await page.locator('#nearby-connected-only').uncheck();
  await expect(page.locator('#nearby-results')).toContainText('Каталог этого адреса пока не подключён');
  await page.locator('#nearby-connected-only').check();
  await expect(page.locator('#nearby-results')).toContainText('Глобус Пушкино');
  await page.locator('#nearby-results article').filter({hasText:'Глобус Пушкино'}).getByRole('button',{name:'Выбрать магазин',exact:true}).click();
  await expect(page.locator('#nearby-selected-store')).toContainText('Глобус Пушкино');
  await expect(page.locator('#globus-store-address')).toHaveValue('5014');
  await page.getByRole('button',{name:'Собрать корзину здесь',exact:true}).click();
  await openHory(page);
  const output=page.locator('#basket-proposal-status');await expect(output).toContainText('На сколько человек');
  await say(page,'На троих');await say(page,'На неделю');await expect(output).toContainText('Какие продукты исключить');
  await say(page,'Ограничений нет');await expect(output).toContainText('Ещё нужно подобрать');
  await expect(output.getByRole('button',{name:'Добавить найденное',exact:true})).toHaveCount(0);
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  const stored=await page.evaluate(()=>({storage:JSON.stringify({...localStorage}),history:JSON.stringify(history.state)}));
  expect(stored.storage).not.toContain('56.01942');expect(stored.storage).not.toContain('Красноармейское шоссе, 105');
  expect(stored.history).not.toContain('56.01942');expect(ai).toBe(0);expect(addressCalls).toBe(1);
  await page.reload();await openStoreDetails(page);await nearby.getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
  await expect(page.locator('#nearby-results')).toBeEmpty();await expect(page.locator('#nearby-address')).toHaveValue('');
});
test('denied geolocation and an unavailable address service leave manual recovery and the existing basket usable',async({page})=>{
  await isolate(page);await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(s,f){f({code:1});}},configurable:true}));
  await page.route('**/functions/v1/nearby-address',r=>r.fulfill({status:503,json:{version:1,error:'source_unavailable'}}));
  await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page);await openStoreDetails(page);await say(page,'Собери недорогую корзину на неделю для троих');
  await expect(page.locator('#basket-proposal-status')).toContainText('Где закупаемся');
  await say(page,'Найти магазины рядом');await closeHory(page);await openStoreDetails(page);await page.locator('#nearby-locate').click();
  await expect(page.locator('#nearby-status')).toContainText('Доступ к геолокации закрыт');
  await page.locator('#nearby-address').fill('Москва, Тверская, 7');await page.locator('#nearby-address-search').click();
  await expect(page.locator('#nearby-status')).toContainText('Адрес не удалось найти');
  await page.locator('#nearby-shopping').getByRole('button',{name:'Выбрать точку на карте',exact:true}).click();
  await page.locator('.stores-map').press('Enter');await page.locator('#nearby-connected-only').check();
  await expect(page.locator('#nearby-status')).toContainText('Точка на карте');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
});

test('clearing the nearby place cancels a pending map device callback in both views',async({page})=>{
  await isolate(page);await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){window.__nearbyLateDevice=ok;}}}));
  await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page);await openStoreDetails(page);
  await page.locator('#stores-locate').click();
  await page.locator('#nearby-shopping').getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
  await page.locator('#nearby-shopping').getByRole('button',{name:'Убрать моё место',exact:true}).click();
  await page.evaluate(()=>window.__nearbyLateDevice({coords:{latitude:55.75,longitude:37.61,accuracy:15},timestamp:Date.now()}));
  await expect(page.locator('#nearby-results')).toBeEmpty();await expect(page.locator('.stores-user-pin')).toHaveCount(0);
  await expect(page.locator('#stores-location-status')).toContainText('Место ещё не указано');
  await expect(page.locator('#nearby-selected-store')).toBeHidden();
});

test('a full spoken goal keeps people and period while the precise address stays outside AI and preference storage',async({page})=>{
  await isolate(page);let ai=0;await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
  await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page);await openStoreDetails(page);
  await say(page,'Собери недорогую корзину на неделю для троих, я живу в Пушкино, до 10 км');
  await expect(page.locator('#nearby-address')).toHaveValue('в Пушкино');await expect(page.locator('#nearby-radius')).toHaveValue('10');
  await closeHory(page);await openStoreDetails(page);
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));expect(stored).not.toContain('Пушкино');
  await page.locator('#stores-manual-location').click();await page.locator('.stores-map').press('Enter');
  await page.locator('#nearby-radius').selectOption('20');await page.locator('#nearby-connected-only').check();
  const choose=page.locator('#nearby-results article').first().getByRole('button',{name:'Выбрать магазин',exact:true});
  await choose.click();await page.getByRole('button',{name:'Собрать корзину здесь',exact:true}).click();
  await openHory(page);
  await expect(page.locator('#basket-proposal-status')).toContainText('для 3 человек, на 7 дн.');
  await expect(page.locator('#basket-proposal-status')).toContainText('Какие продукты исключить');expect(ai).toBe(0);
});
