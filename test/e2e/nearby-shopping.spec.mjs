import { openHory, closeHory, selectStore, openStoreDetails } from './helpers/pixel-surface.mjs';
import{test,expect}from'@playwright/test';
import fs from 'node:fs';
const joinedDirectory = JSON.parse(fs.readFileSync(new URL('../../src/data/nearbyGroceryStores.json',import.meta.url),'utf8'));
test.setTimeout(60000);
test('confirmed METRO points open and retain their own pickup catalogue', async ({page}) => {
  await isolate(page);
  let point;
  await page.route('**/functions/v1/nearby-address', route => route.fulfill({json:{version:1,candidates:[{
    lat:point.lat,lon:point.lon,label:point.address,precision:'house'
  }]}}));
  for (const street of ['Маршала Прошлякова', 'Ленинградское шоссе, 71Г', 'Новые Псарьки']) {
    point=joinedDirectory.stores.find(store=>store.retailerId==='metro'&&store.address?.includes(street));
    await page.goto('/?comparison=observed&catalog=retail#shop');
    await page.locator('#nearby-address').fill(point.address);
    await page.locator('#nearby-address').press('Enter');
    await page.locator('#nearby-address-candidates button').click();
    const card=page.locator('#nearby-results article').filter({hasText:point.address});
    await card.getByRole('button',{name:'Открыть товары'}).click({timeout:7000});
    await expect(page.locator('#pixel-storefront')).toBeVisible();
    const visibleAddress = street.includes('71Г') ? 'Ленинградское ш., д.71Г' : street;
    await expect(page.locator('#pixel-storefront')).toContainText(visibleAddress);
    await page.reload();
    await expect(page.locator('#pixel-storefront')).toContainText(visibleAddress);
  }
});
test('Moscow shows nearby stores directly and an unmatched address offers recovery', async ({page}) => {
  await isolate(page);
  await page.route('**/functions/v1/nearby-address', route => route.fulfill({json:{version:1,candidates:[]}}));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  const input=page.locator('#nearby-address');
  const cards=page.locator('#nearby-results article');
  await input.fill('Москва');
  await input.press('Enter');
  await expect(page.locator('#nearby-status')).toContainText('Москва · центр (примерно)');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeLessThanOrEqual(5);
  await input.fill('Москва, Несуществующая улица, 99999');
  await input.press('Enter');
  await expect(page.locator('#nearby-status')).toContainText('выбери точку на карте');
  await expect(cards).toHaveCount(0);
});
test('home address → nearest exact card → own catalogue; location remains voluntary and recoverable', async ({page}) => {
  await isolate(page); let addressCalls = 0;
  const point = joinedDirectory.stores.find(p => p.catalogBinding?.shopCode === '699415');
  await page.route('**/functions/v1/nearby-address', route => {
    addressCalls++;
    return route.fulfill({json:{version:1,candidates:[{lat:point.lat,lon:point.lon,label:point.address,precision:'house'}]}});
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await expect(page.locator('#nearby-address')).toBeVisible();
  await expect(page.locator('#pixel-storefront')).toBeHidden();
  expect(addressCalls).toBe(0);
  await page.locator('#nearby-address').fill(point.address);
  await page.locator('#nearby-address').press('Enter');
  await page.locator('#nearby-address-candidates button').click();
  const card = page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
  await expect.poll(() => page.locator('#nearby-results article').count()).toBeGreaterThan(0);
  expect(await page.locator('#nearby-results article').count()).toBeLessThanOrEqual(5);
  await expect(card).toContainText('Каталог доступен');
  await page.locator('.nearby-extra > summary').click();
  await page.locator('#nearby-radius').selectOption('1');
  await page.locator('.nearby-network-filters button[data-network="magnit"]').click();
  await card.getByRole('button',{name:'Открыть товары'}).click();
  await expect(page.locator('#pixel-storefront')).toBeVisible();
  await expect(page.locator('#magnit-store-address')).toHaveValue('699415');
  await expect(page.locator('#nearby-selected-store')).toBeHidden();
  await page.reload();
  await expect(page.locator('#magnit-store-address')).toHaveValue('699415');
  await expect(page.locator('#nearby-address')).toHaveValue(point.address);
  await expect(page.locator('#nearby-radius')).toHaveValue('1');
  await expect(page.locator('.nearby-network-filters button[data-network="magnit"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#nearby-results article').filter({hasText:point.address})).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(addressCalls).toBe(1);
});
const say=async(page,text)=>{await openHory(page);await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
async function isolate(page){
  await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await page.route('**/rest/v1/**',r=>r.fulfill({json:[]}));
}

test('exact newly connected Moscow and regional addresses select their own Magnit catalogue without AI', async ({page}) => {
  await isolate(page); let ai = 0;
  await page.route('**/functions/v1/ai-basket-proposal', r => { ai++; return r.abort(); });
  let point;
  await page.route('**/functions/v1/nearby-address', r => r.fulfill({json:{version:1,candidates:[{
    lat:point.lat,lon:point.lon,label:point.address,precision:'house'
  }]}}));
  for (const shopCode of ['699415','834496']) {
    point=joinedDirectory.stores.find(p=>p.catalogBinding?.shopCode===shopCode);
    expect(point).toBeTruthy();
    await page.goto('/?comparison=observed&catalog=retail#shop');
    await page.locator('#nearby-address').fill(point.address); await page.locator('#nearby-address-search').click();
    await page.locator('#nearby-address-candidates').getByRole('button').click();
    await page.locator('.nearby-extra > summary').click();
    await page.locator('#nearby-radius').selectOption('1');
    const row=page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
    await expect(row).toContainText('Каталог доступен');
    await row.getByRole('button',{name:'Открыть товары',exact:true}).click();
    await expect(page.locator('#magnit-store-address')).toHaveValue(shopCode);
    // Selecting a card opens its catalogue directly.  The old confirmation
    // panel must stay gone, otherwise the address-first path becomes two-step.
    await expect(page.locator('#nearby-selected-store')).toBeHidden();
    await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
    const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));
    expect(stored).not.toContain(point.address);
  }
  expect(ai).toBe(0);
});
test('an explicitly chosen nearby address is remembered while its catalogue is still loading', async ({page}) => {
  await isolate(page);let ai=0,heldReads=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const point=joinedDirectory.stores.find(p=>p.catalogBinding?.shopCode==='502843');
  expect(point).toBeTruthy();
  await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
  await page.route('**/functions/v1/nearby-address',r=>r.fulfill({json:{version:1,candidates:[{
    lat:point.lat,lon:point.lon,label:point.address,precision:'house'
  }]}}));
  await page.route('**/rest/v1/**',async route=>{
    if(new URL(route.request().url()).searchParams.get('store_id')==='eq.magnit-502843'){
      heldReads++;await gate;
    }
    await route.fulfill({json:[]}).catch(()=>{});
  });
  try{
    await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page);await openStoreDetails(page);
    await page.locator('#nearby-shopping').getByRole('button',{name:'Найти магазины рядом',exact:true}).click();
    await page.locator('#nearby-address').fill(point.address);await page.locator('#nearby-address-search').click();
    await page.locator('#nearby-address-candidates').getByRole('button').click();
    await page.locator('#nearby-radius').selectOption('1');
    const row=page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
    await row.getByRole('button',{name:'Открыть товары',exact:true}).click();
    await expect.poll(()=>heldReads).toBeGreaterThan(0);
    await expect(page.locator('#magnit-store-address')).toHaveValue('502843');
    await say(page,'Собери недорогую корзину на пять дней для четверых');
    const output=page.locator('#basket-proposal-status');
    await expect(output).toContainText('Какие продукты исключить');
    await expect(output).not.toContainText('Где закупаемся');
    await expect(output.getByRole('button',{name:'Текущий магазин',exact:true})).toHaveCount(0);
    expect(ai).toBe(0);
  }finally{release();}
});

test('a bound Magnit map pin selects its exact address, while the legacy point stays nonselectable',async({page})=>{
  await isolate(page);
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page);
  await openStoreDetails(page);
  await page.locator('#stores-section').scrollIntoViewIfNeeded();
  await expect.poll(async()=>Number((await page.locator('.stores-location-directory > summary').textContent())?.match(/\d+/u)?.[0]))
    .toBeGreaterThanOrEqual(64);
  await page.locator('#stores-clear-location').click();
  const legacy=page.locator('.stores-pin[data-store-location-id="magnit-1812"]');
  await expect(legacy).toHaveJSProperty('tagName','A');
  await page.locator('.stores-map').scrollIntoViewIfNeeded();
  const target=await page.locator('.stores-pin[data-store-location-id^="magnit-bound-"]').evaluateAll(nodes=>{
    for(const node of nodes){
      const rect=node.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      if(x<0||x>=innerWidth||y<0||y>=innerHeight)continue;
      if(document.elementFromPoint(x,y)?.closest('.stores-pin')===node)return node.dataset.storeLocationId;
    }
    return null;
  });
  expect(target).not.toBeNull();
  const pin=page.locator(`.stores-pin[data-store-location-id="${target}"]`);
  await expect(pin).toHaveJSProperty('tagName','BUTTON');
  await expect(pin).toHaveAttribute('aria-label',/Выбрать для корзины: Магнит,/u);
  await pin.click();
  await openStoreDetails(page);
  await expect(page.locator('#magnit-store-address')).toHaveValue(target.slice(-6));
  await expect(page.locator('#stores-selected-addresses'))
    .toContainText(await page.locator('#magnit-store-address option:checked').textContent());
  await expect(pin).toHaveClass(/stores-pin-selected/u);
  await expect(page.locator('#stores-selected-addresses')).toContainText('цена и наличие не подтверждены');
});
test('address consent → nearby store → household intake retains the address only in the same tab',async({page})=>{
  await isolate(page);let addressCalls=0,ai=0;
  await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
  await page.route('**/functions/v1/nearby-address',r=>{addressCalls++;expect(r.request().postDataJSON()).toEqual({query:'Пушкино, Красноармейское шоссе, 105',consent:true});
    return r.fulfill({json:{version:1,candidates:[{lat:56.01942,lon:37.885139,label:'Московская область, Пушкино, Красноармейское шоссе, 105',precision:'house'}]}});});
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await page.locator('#nearby-address').fill('Пушкино, Красноармейское шоссе, 105');expect(addressCalls).toBe(0);
  await page.locator('#nearby-address-search').click();
  await page.locator('#nearby-address-candidates').getByRole('button').click();
  await expect(page.locator('#nearby-status')).toContainText(/Рядом с|Магазинов с каталогом рядом не нашлось/u);
  await expect(page.locator('#nearby-connected-only')).toBeChecked();
  await page.locator('.nearby-extra > summary').click();
  await page.locator('#nearby-connected-only').uncheck();
  await expect(page.locator('#nearby-results')).toContainText('Каталог пока недоступен');
  await page.locator('#nearby-connected-only').check();
  await expect(page.locator('#nearby-results')).toContainText('Глобус Пушкино');
  await page.locator('#nearby-results article').filter({hasText:'Глобус Пушкино'}).getByRole('button',{name:'Открыть товары',exact:true}).click();
  await expect(page.locator('#nearby-selected-store')).toBeHidden();
  await expect(page.locator('#globus-store-address')).toHaveValue('5014');
  await openHory(page);
  await page.locator('#pixel-hory-dialog').getByRole('button',{name:'Собрать корзину',exact:true}).click();
  const output=page.locator('#basket-proposal-status');await expect(output).toContainText('На сколько человек');
  await say(page,'На троих');await say(page,'На неделю');await expect(output).toContainText('Какие продукты исключить');
  await say(page,'Ограничений нет');await expect(output).toContainText('Ещё нужно подобрать');
  await expect(output.getByRole('button',{name:'Добавить найденное',exact:true})).toHaveCount(0);
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  const stored=await page.evaluate(()=>({storage:JSON.stringify({...localStorage}),history:JSON.stringify(history.state)}));
  expect(stored.storage).not.toContain('56.01942');expect(stored.storage).not.toContain('Красноармейское шоссе, 105');
  expect(stored.history).not.toContain('56.01942');expect(ai).toBe(0);expect(addressCalls).toBe(1);
  await page.reload();
  await expect(page.locator('#nearby-address')).toHaveValue('Пушкино, Красноармейское шоссе, 105');
  await expect(page.locator('#nearby-results')).toContainText('Глобус Пушкино');
  expect(addressCalls).toBe(1);
});
test('denied geolocation and an unavailable address service allow manual map recovery',async({page})=>{
  await isolate(page);await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(s,f){f({code:1});}},configurable:true}));
  await page.route('**/functions/v1/nearby-address',r=>r.fulfill({status:503,json:{version:1,error:'source_unavailable'}}));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await page.locator('#nearby-address').fill('Москва, Тверская, 7');
  await page.locator('#nearby-locate').click();
  await expect(page.locator('#nearby-status')).toContainText('Не получилось определить место');
  await expect(page.locator('#nearby-address')).toHaveValue('Москва, Тверская, 7');
  await page.locator('#nearby-address-search').click();
  await expect(page.locator('#nearby-status')).toContainText('Не удалось найти адрес сейчас');
  await page.locator('#nearby-shopping').getByRole('button',{name:'Выбрать точку на карте',exact:true}).click();
  // The next presentation frame must preserve the requested map destination.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('.stores-map')).toBeFocused();
  await page.locator('.stores-map').press('Enter');await page.locator('#nearby-connected-only').check();
  await expect(page.locator('#nearby-status')).toContainText('Точка на карте');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
});

test('nearby map keeps only the essential controls and searches the moved area', async ({page}) => {
  await isolate(page);
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await page.locator('#nearby-shopping').getByRole('button', { name: /^(На карте|Выбрать точку на карте)$/u }).click({timeout:5000});
  const map = page.locator('.stores-map');
  await expect(map).toBeFocused();
  await expect(page.getByRole('button', { name: 'Искать здесь', exact: true })).toBeVisible();
  const cluster = map.locator('.stores-pin-cluster').first();
  await expect(cluster).toBeVisible();
  await cluster.click();
  await expect(map).toBeFocused();
  await expect(page.getByRole('button', { name: 'К списку магазинов', exact: true })).toBeVisible();
  await expect(page.locator('#stores-locate')).toBeHidden();
  await expect(page.locator('#stores-manual-location')).toBeHidden();
  await expect(page.locator('.stores-map-network-filter')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Показать магазины', exact: true })).toBeHidden();
  await map.press('ArrowRight');
  await page.getByRole('button', { name: 'Искать здесь', exact: true }).click();
  await expect(page.locator('#nearby-status')).toContainText(/Рядом с|Магазинов с каталогом рядом не нашлось/u);
});

test('clearing the nearby place cancels a pending map device callback in both views',async({page})=>{
  await isolate(page);await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){window.__nearbyLateDevice=ok;}}}));
  await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page);await openStoreDetails(page);
  await page.locator('#stores-locate').click();
  await page.locator('#nearby-shopping').getByRole('button',{name:'Найти магазины рядом',exact:true}).click();
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
  const choose=page.locator('#nearby-results article').first().getByRole('button',{name:'Открыть товары',exact:true});
  await choose.click();await openHory(page);
  await page.locator('#pixel-hory-dialog').getByRole('button',{name:'Собрать корзину',exact:true}).click();
  await expect(page.locator('#basket-proposal-status')).toContainText('для 3 человек, на 7 дн.');
  await expect(page.locator('#basket-proposal-status')).toContainText('Какие продукты исключить');expect(ai).toBe(0);
});
