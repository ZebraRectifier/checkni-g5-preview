import { openHory, closeHory, selectStore, openStoreDetails } from './helpers/pixel-surface.mjs';
import{test,expect}from'@playwright/test';
import fs from 'node:fs';
const joinedDirectory = JSON.parse(fs.readFileSync(new URL('../../src/data/nearbyGroceryStores.json',import.meta.url),'utf8'));
const registeredCoordinates = JSON.parse(fs.readFileSync(new URL('../../src/data/magnitRegisteredCoordinates.json',import.meta.url),'utf8'));
const reviewedMetroPoints = [
  {id:'osm:way:36394860',storeNumber:'10',storeId:'metro-address-c5gsqz',address:'Москва, Ленинградское шоссе, 71Г',lat:55.8758342,lon:37.4473228},
  {id:'osm:way:38106162',storeNumber:'12',storeId:'metro-address-5e2aa4',address:'Москва, Дорожная улица, 1 к1',lat:55.6307578,lon:37.6249212}
];
test.setTimeout(60000);
async function isolateRegional(page){
  // Let local modules load natively; intercept only external traffic. Hundreds
  // of local continue() callbacks obscure timing on resource-limited runners.
  await page.route(/^https?:\/\/(?!(?:127\.0\.0\.1|localhost)(?::\d+)?\/)/u,r=>r.abort());
  await page.route('**/rest/v1/**',r=>r.fulfill({json:[]}));
}

test('official Magnit coordinates: Moscow and oblast open their exact existing catalogues',async({page},testInfo)=>{
  await isolateRegional(page);let point;const scopes=[];
  await page.route('**/functions/v1/nearby-address',route=>route.fulfill({json:{version:1,candidates:[{
    lat:point.lat,lon:point.lon,label:point.address,precision:'house'}]}}));
  await page.route('**/rest/v1/**',route=>{scopes.push(new URL(route.request().url()).searchParams.get('store_id'));return route.fulfill({json:[]});});
  for(const code of ['303857','548279']){
    point=registeredCoordinates.stores.find(row=>row.shopCode===code);
    await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
    await selectStore(page);await openStoreDetails(page);
    await page.locator('#nearby-shopping').getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
    await page.locator('#nearby-address').fill(point.address);await page.locator('#nearby-address-search').click();
    await page.locator('#nearby-address-candidates button').click();await page.locator('#nearby-radius').selectOption('1');
    const row=page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
    await expect(row).toContainText('Актуальность цен и возможность добавить товар указаны в каталоге');
    await expect(page.locator('.nearby-result-sources a[href="https://magnit.ru/shops"]')).toHaveAttribute('href','https://magnit.ru/shops');
    await row.getByRole('button',{name:'Открыть товары'}).click();
    await expect(page.locator('#magnit-store-address')).toHaveValue(code);
    await expect.poll(()=>scopes.includes('eq.magnit-'+code)).toBe(true);
    await expect(page.locator('#nearby-selected-store')).toContainText(point.address);
    await page.screenshot({path:testInfo.outputPath(`official-magnit-${code}.png`)});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

test('reviewed METRO points open the exact store catalogue from nearby cards and map',async({page,context},testInfo)=>{
  await isolateRegional(page);let point;const scopes=[];
  await page.route('**/functions/v1/nearby-address',route=>route.fulfill({json:{version:1,candidates:[{
    lat:point.lat,lon:point.lon,label:point.address,precision:'house'}]}}));
  await page.route('**/rest/v1/**',route=>{scopes.push(new URL(route.request().url()).searchParams.get('store_id'));return route.fulfill({json:[]});});
  for(const target of reviewedMetroPoints){
    point=target;
    await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
    await selectStore(page);await openStoreDetails(page);
    await page.locator('#nearby-shopping').getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
    await page.locator('#nearby-address').fill(point.address);await page.locator('#nearby-address-search').click();
    await page.locator('#nearby-address-candidates button').click();await page.locator('#nearby-radius').selectOption('1');
    const row=page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
    await expect(row).toContainText('Актуальность цен и возможность добавить товар указаны в каталоге');
    await row.getByRole('button',{name:'Открыть товары'}).click();
    await expect(page.locator('#metro-store-address')).toHaveValue(point.storeNumber);
    await expect.poll(()=>scopes.includes(`eq.${point.storeId}`)).toBe(true);
    await expect(page.locator('#nearby-selected-store')).toContainText(point.address);
    await page.screenshot({path:testInfo.outputPath(`reviewed-metro-${point.storeNumber}.png`)});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }

  point=reviewedMetroPoints[0];
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await selectStore(page);await openStoreDetails(page);
  const nearby=page.locator('#nearby-shopping');
  await nearby.getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
  await page.locator('#nearby-address').fill(point.address);
  await page.locator('#nearby-address-search').click();
  await page.locator('#nearby-address-candidates button').click();
  await page.locator('#nearby-radius').selectOption('1');
  await expect(page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})})).toBeVisible();
  await nearby.getByRole('button',{name:'Выбрать точку на карте',exact:true}).click();
  await expect(page.locator('.stores-location-directory')).toBeVisible();
  await page.locator('#stores-map-network').selectOption('metro');
  const mapRow=page.locator(`#stores-known-locations li[data-store-location-id="${point.id}"]`);
  await expect(mapRow).toContainText(point.address);await mapRow.getByRole('button',{name:'Metro',exact:true}).click();
  const card=page.locator('.stores-pin-card');await expect(card).toContainText(point.address);
  await expect(card.getByRole('link',{name:'Маршрут'})).toHaveCount(0);
  await card.getByRole('button',{name:'Открыть товары',exact:true}).click();
  await expect(page.locator('#metro-store-address')).toHaveValue(point.storeNumber);
  await expect.poll(()=>scopes.includes(`eq.${point.storeId}`)).toBe(true);
});

test('official Magnit coordinates: map retains full paginated list and opens an oblast store with bounded markers',async({page,context},testInfo)=>{
  await isolateRegional(page);
  await page.route('https://tiles.openfreemap.org/**',route=>new URL(route.request().url()).pathname==='/styles/liberty'
    ?route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e5e8de'}}]}}):route.abort());
  const point=registeredCoordinates.stores.find(row=>row.shopCode==='548279');
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await selectStore(page);await openStoreDetails(page);
  await page.locator('#stores-section').scrollIntoViewIfNeeded();
  await expect(page.locator('.stores-location-directory > summary')).toHaveText('Магазины списком');
  await page.locator('.stores-location-directory').evaluate(node=>{node.open=true;});
  // Before choosing a position there is no nearby context: this exercises the
  // general app callback and its oblast resolver, not the nearby event path.
  // The compact directory deliberately caps browsing at 15, so use its first
  // visible exact Magnit binding instead of paging through the whole registry.
  await page.locator('#stores-map-network').selectOption('magnit');
  const direct=page.locator('#stores-known-locations li').filter({has:page.getByRole('button',{name:'Открыть товары',exact:true})}).first();
  await expect(direct).toBeVisible();const directId=await direct.getAttribute('data-store-location-id');
  await direct.getByRole('button',{name:'Открыть товары',exact:true}).click();
  await expect(page.locator('#magnit-store-address')).toHaveValue(directId.slice(-6));
  await selectStore(page);await openStoreDetails(page);await page.locator('#stores-section').scrollIntoViewIfNeeded();
  await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:point.lat,longitude:point.lon,accuracy:10});
  await page.locator('#stores-locate').click();await page.locator('#stores-map-network').selectOption('magnit');
  await expect(page.locator('#stores-known-locations li')).toHaveCount(5);
  const row=page.locator('#stores-known-locations li[data-store-location-id="official:magnit:548279"]');
  await expect(row).toContainText(point.address);
  await row.getByRole('button',{name:'Магнит',exact:true}).click();
  const card=page.locator('.stores-pin-card');await expect(card).toContainText(point.address);
  await expect(card.getByRole('link',{name:'Маршрут'})).toHaveCount(0);
  await expect.poll(()=>page.locator('.stores-pin').count()).toBeGreaterThan(0);
  expect(await page.locator('.stores-pin').count()).toBeLessThanOrEqual(200);
  await page.getByRole('button',{name:'Показать ещё магазины',exact:true}).click();
  await expect(page.locator('#stores-known-locations li')).toHaveCount(10);await expect(card).toContainText(point.address);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('official-magnit-map.png')});
  await card.getByRole('button',{name:'Открыть товары',exact:true}).click();
  await expect(page.locator('#magnit-store-address')).toHaveValue('548279');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('official Magnit coordinates: a registry-only address is absent from connected catalogues',async({page,context})=>{
  await isolateRegional(page);
  const packet=structuredClone(registeredCoordinates),point=packet.stores.find(row=>row.shopCode==='303857');point.catalog=null;
  await page.route('**/magnitRegisteredCoordinates.json',route=>route.fulfill({json:packet}));
  await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:point.lat,longitude:point.lon,accuracy:10});
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-checkni-boot','ready',{timeout:20000});
  await page.locator('#nearby-locate').click();await page.locator('#nearby-radius').selectOption('1');
  await page.locator('#nearby-connected-only').uncheck();
  const row=page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
  await expect(row).toContainText('Каталог этого адреса пока не подключён');
  await expect(row.getByRole('button',{name:'Открыть товары'})).toHaveCount(0);
  await page.locator('#nearby-connected-only').check();await expect(row).toHaveCount(0);
  await page.locator('#nearby-connected-only').uncheck();await expect(row).toContainText('Цены неизвестны');
  await page.locator('#nearby-shopping').getByRole('button',{name:'Выбрать точку на карте',exact:true}).click();
  await page.locator('#stores-known-locations li[data-store-location-id="official:magnit:303857"]').getByRole('button',{name:'Магнит',exact:true}).click();
  const card=page.locator('.stores-pin-card');await expect(card).toContainText('Каталог адреса пока не подключён');
  await expect(card.getByRole('button',{name:'Открыть товары',exact:true})).toHaveCount(0);
  await expect(card.getByRole('link',{name:'Маршрут'})).toHaveAttribute('href',/yandex\.ru\/maps/u);
});

test('five regional cities: real address cards, directory recovery and no Moscow or catalogue leakage', async ({page,context},testInfo) => {
  test.setTimeout(120000);
  await isolateRegional(page); await context.grantPermissions(['geolocation']);
  const targets=[['kazan','010852'],['saint-petersburg','011601'],['yekaterinburg','021828'],['novosibirsk','020427'],['nizhny-novgorod','067036']].map(([slug,id])=>{
    const directory=JSON.parse(fs.readFileSync(new URL(`../../src/data/nearby-regions/${slug}.json`,import.meta.url),'utf8'));
    const point=directory.stores.find(row=>row.id===`official:magnit:${id}`)??directory.stores.find(row=>row.retailerId==='magnit');
    return {slug,city:directory.city,point};
  });
  const requests=[];
  await page.route('**/functions/v1/nearby-address',route=>{
    requests.push(route.request().postDataJSON());
    // Even an unrelated provider result must not displace the chosen city.
    return route.fulfill({json:{version:1,candidates:[{lat:55.75,lon:37.61,label:'Москва, Тверская, 1',precision:'house'}]}});
  });
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-checkni-boot','ready',{timeout:20000});
  for(const {slug,city,point} of targets){
    expect(point,slug).toBeTruthy();
    await page.locator('#nearby-address').fill(city);await page.locator('#nearby-address').press('Enter');
    const candidate=page.locator('#nearby-address-candidates button');
    await expect(candidate).toContainText('центр');await candidate.click();
    await expect(page.locator('#nearby-results article').first()).toContainText(city);
    await expect(page.locator('.pixel-location')).toHaveText(`⌖ ${city}`);
    await expect(page.locator('#nearby-results')).not.toContainText('Москва');
    await context.setGeolocation({latitude:point.lat,longitude:point.lon,accuracy:10});
    await page.locator('#nearby-locate').click();
    const card=page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
    await expect(card).toContainText('Цены неизвестны');
    const route=card.getByRole('link',{name:'Маршрут',exact:true});
    await expect(route).toHaveAttribute('href',`https://yandex.ru/maps/?rtext=~${encodeURIComponent(`${point.lat},${point.lon}`)}&rtt=auto`);
    await expect(route).toHaveAttribute('target','_blank');
    await expect(route).toHaveAttribute('rel','noopener noreferrer');
    await expect(page.locator(`.nearby-result-sources a[href="${point.sourceUrl}"]`)).toHaveAttribute('href',point.sourceUrl);
    await expect(page.locator('#nearby-results .nearby-open-catalog')).toHaveCount(0);
    await expect(page.locator('#nearby-results')).not.toContainText('Москва');
    const cityOffset=point.address.toLocaleLowerCase('ru').indexOf(city.toLocaleLowerCase('ru')+',');
    expect(cityOffset).toBeGreaterThanOrEqual(0);
    const street=point.address.slice(cityOffset+city.length).replace(/^[,\s]+/u,'');
    await page.locator('#nearby-address').fill(street);await page.locator('#nearby-address').press('Enter');
    const landmark=page.locator('#nearby-address-candidates button').filter({hasText:point.address});
    await expect(landmark).toContainText('магазин-ориентир');
    await expect(page.locator('#nearby-address-candidates')).not.toContainText('Москва');
    expect(requests.at(-1)).toEqual({query:`${city}, ${street}`,consent:true});
    await landmark.click();await expect(card).toBeVisible();
    await testInfo.attach(`${slug}-address`,{body:JSON.stringify(point),contentType:'application/json'});
    await page.screenshot({path:testInfo.outputPath(`${slug}-cards.png`),fullPage:false});
  }
  await context.setGeolocation({latitude:43.585,longitude:39.72,accuracy:10});
  await page.locator('#nearby-locate').click();
  await expect(page.locator('#nearby-status')).toContainText('Для этого места справочника пока нет');
  await expect(page.locator('#nearby-results')).toBeEmpty();
  await expect(page.locator('.pixel-location')).toHaveText('⌖ Указать место');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('selected map card keeps its catalogue action reachable above the mobile navigation',async({page,context},testInfo)=>{
  await page.route(/^https?:\/\/(?!(?:127\.0\.0\.1|localhost)(?::\d+)?\/)/u,route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='tiles.openfreemap.org')return route.abort();
    if(process.env.CHECKNI_LIVE_MAP_CHECK==='1')return route.continue();
    // CI exercises the real vendored SDK without depending on external tiles.
    if(url.pathname==='/styles/liberty')return route.fulfill({json:{version:8,
      glyphs:new URL('/test/support/map-test-fonts/',page.url()).href+'{fontstack}/{range}.pbf',
      sources:{fixture:{type:'geojson',data:{type:'FeatureCollection',features:[]},attribution:'CHECKNI offline map fixture'}},
      layers:[{id:'background',type:'background',paint:{'background-color':'#e5e8de'}},{id:'fixture',type:'circle',source:'fixture'}]}});
    return route.abort();
  });
  await page.route('**/rest/v1/**',route=>route.fulfill({json:[]}));
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-checkni-boot','ready',{timeout:20000});
  await selectStore(page);await openStoreDetails(page);
  await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:55.928776,longitude:38.003613,accuracy:10});

  await page.locator('#stores-section').scrollIntoViewIfNeeded();
  await page.locator('#stores-locate').click();
  const marker=page.locator('.stores-pin').filter({hasText:'Глобус Щелково'});
  await expect(marker).toBeVisible({timeout:20000});await marker.click();
  const card=page.locator('.stores-pin-card'),action=card.getByRole('button',{name:'Открыть товары',exact:true});
  await expect(card).toContainText('Глобус Щелково');await expect(action).toBeInViewport();
  await expect(card.getByRole('link',{name:'Маршрут'})).toHaveCount(0);
  // A geometric visibility check also detects sticky dock occlusion.
  expect(await action.evaluate(node=>{const box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return node===hit||node.contains(hit);})).toBe(true);
  // A hovered SDK marker/label previously painted above the card although its
  // CTA remained reachable. Sample its title, address and centre separately.
  expect(await card.evaluate(node=>{
    const boxes=[node.querySelector('strong'),node.querySelector('p')].map(part=>part.getBoundingClientRect());
    const rect=node.getBoundingClientRect(),points=[[rect.x+rect.width/2,rect.y+rect.height/2]];
    for(const box of boxes)for(let x=box.left+4;x<box.right-4;x+=16)points.push([x,box.top+box.height/2]);
    return points.map(([x,y])=>document.elementFromPoint(x,y)).every(hit=>hit&&node.contains(hit)&&!hit.closest('.stores-pin'));
  })).toBe(true);
  const box=await card.boundingBox(),mapBox=await page.locator('.stores-map').boundingBox();
  if(testInfo.project.name.includes('mobile'))expect(box.y+box.height).toBeLessThan(mapBox.y+mapBox.height-24);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('selected-map-card.png')});
  await card.getByRole('button',{name:'Закрыть карточку'}).click();await expect(card).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('regional device location uses Kazan and Petersburg directories; unsupported coordinates never fall back to Moscow', async ({page,context}) => {
  await isolateRegional(page); await context.grantPermissions(['geolocation']);
  const loaded=[];page.on('request',r=>{if(r.url().includes('/nearby-regions/'))loaded.push(r.url());});
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-checkni-boot','ready',{timeout:20000});
  for(const [lat,lon,city,slug] of [[55.7961,49.1064,'Казань','kazan'],[59.9343,30.3351,'Санкт-Петербург','saint-petersburg']]){
    await context.setGeolocation({latitude:lat,longitude:lon,accuracy:20});
    await page.locator('#nearby-locate').click();
    await expect(page.locator('#nearby-results article').first()).toContainText(city);
    expect(loaded.some(url=>url.endsWith(`/${slug}.json`))).toBe(true);
    await expect(page.locator('#nearby-results')).not.toContainText('Москва');
    await expect(page.locator('#nearby-connected-only')).not.toBeChecked();
    await expect(page.locator('#nearby-results .nearby-open-catalog')).toHaveCount(0);
  }
  await context.setGeolocation({latitude:43.585,longitude:39.72,accuracy:20});
  await page.locator('#nearby-locate').click();
  await expect(page.locator('#nearby-status')).toContainText('Для этого места справочника пока нет');
  await expect(page.locator('#nearby-results')).toBeEmpty();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('regional home address without a comma uses geocoder; denial preserves address, radius and previous results',async({page})=>{
  await isolateRegional(page);let calls=0;
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(s,f){f({code:1});}},configurable:true}));
  await page.route('**/functions/v1/nearby-address',route=>{
    calls++;expect(route.request().postDataJSON()).toEqual({query:calls===1?'Казань улица Баумана 7':'Казань, улица Баумана 7',consent:true});
    return route.fulfill({json:{version:1,candidates:[{lat:55.79,lon:49.12,label:'Казань, улица Баумана, 7',precision:'house'}]}});
  });
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('data-checkni-boot','ready',{timeout:20000});
  await page.locator('#nearby-address').fill('Казань улица Баумана 7');await page.locator('#nearby-address').press('Enter');
  await page.locator('#nearby-address-candidates button').click();
  await page.locator('#nearby-radius').selectOption('10');
  await expect(page.locator('#nearby-results article').first()).toContainText('Казань');
  const before=await page.locator('#nearby-results').innerText();
  await page.locator('#nearby-locate').click();
  await expect(page.locator('#nearby-status')).toContainText('Доступ к геолокации закрыт');
  await expect(page.locator('#nearby-address')).toHaveValue('Казань улица Баумана 7');
  await expect(page.locator('#nearby-radius')).toHaveValue('10');
  expect(await page.locator('#nearby-results').innerText()).toBe(before);
  await expect(page.locator('#nearby-shopping').getByRole('button',{name:'Выбрать точку на карте'})).toBeVisible();
  expect(calls).toBe(1);
  await page.locator('#nearby-address').fill('улица Баумана 7');await page.locator('#nearby-address').press('Enter');
  await expect(page.locator('#nearby-address-candidates')).toContainText('Казань');
  await expect(page.locator('#nearby-address')).toHaveValue('улица Баумана 7');expect(calls).toBe(2);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain('Баумана');
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
  await page.locator('#nearby-radius').selectOption('1');
  await page.locator('.nearby-network-filters').getByRole('button',{name:'Магнит',exact:true}).click();
  const card = page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
  await expect(card).toContainText('Каталог этого адреса подключён');
  await card.getByRole('button',{name:'Открыть товары'}).click();
  await expect(page.locator('#pixel-storefront')).toBeVisible();
  await expect(page.locator('#magnit-store-address')).toHaveValue('699415');
  await page.reload();
  await expect(page.locator('#magnit-store-address')).toHaveValue('699415');
  await page.locator('.pixel-store-address').click();
  await page.locator('#pixel-address-chooser').getByRole('button', { name: 'Магазины рядом' }).click();
  await expect(page.locator('#nearby-address')).toBeVisible();
  await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
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
    await page.goto('/?comparison=observed&catalog=retail#shop'); await selectStore(page); await openStoreDetails(page);
    await page.locator('#nearby-shopping').getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
    await page.locator('#nearby-address').fill(point.address); await page.locator('#nearby-address-search').click();
    await page.locator('#nearby-address-candidates').getByRole('button').click();
    await page.locator('#nearby-radius').selectOption('1');
    const row=page.locator('#nearby-results article').filter({has:page.getByText(point.address,{exact:true})});
    await expect(row).toContainText('Каталог этого адреса подключён');
    await row.getByRole('button',{name:'Открыть товары',exact:true}).click();
    await expect(page.locator('#magnit-store-address')).toHaveValue(shopCode);
    await expect(page.locator('#nearby-selected-store')).toContainText(point.address);
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
    await page.locator('#nearby-shopping').getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
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

test('a bound Magnit map card selects its exact address offline, while the legacy point stays nonselectable',async({page})=>{
  await isolateRegional(page);
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page);await openStoreDetails(page);
  await page.locator('#stores-section').scrollIntoViewIfNeeded();
  await expect(page.locator('.stores-location-directory > summary')).toHaveText('Магазины списком');
  await page.locator('.stores-location-directory').evaluate(node=>{node.open=true;});
  await page.locator('#stores-map-network').selectOption('magnit');
  const legacy=page.locator('#stores-known-locations li[data-store-location-id="magnit-1812"]');
  await expect(legacy.getByRole('button',{name:'Открыть товары',exact:true})).toHaveCount(0);
  await legacy.getByRole('button',{name:'Магнит',exact:true}).click();
  await expect(page.locator('.stores-pin-card')).toContainText('Каталог адреса пока не подключён');
  const row=page.locator('#stores-known-locations li[data-store-location-id^="magnit-bound-"]').first();
  const target=await row.getAttribute('data-store-location-id');
  await row.getByRole('button',{name:'Магнит',exact:true}).click();
  await page.locator('.stores-pin-card').getByRole('button',{name:'Открыть товары',exact:true}).click();
  await openStoreDetails(page);
  await expect(page.locator('#magnit-store-address')).toHaveValue(target.slice(-6));
  const point=joinedDirectory.stores.find(p=>p.catalogBinding?.shopCode===target.slice(-6));
  await expect(page.locator('#stores-selected-addresses')).toContainText(point.catalogBinding.address);
  await expect(page.locator('.stores-map-info')).toContainText('не подтверждает цены');
});

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
  await page.locator('#nearby-results article').filter({hasText:'Глобус Пушкино'}).getByRole('button',{name:'Открыть товары',exact:true}).click();
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
  await expect(page.locator('#basket-proposal-status')).toContainText('Какие продукты исключить');
  await say(page,'Найти магазины рядом');await closeHory(page);await openStoreDetails(page);await page.locator('#nearby-locate').click();
  await expect(page.locator('#nearby-status')).toContainText('Доступ к геолокации закрыт');
  await page.locator('#nearby-address').fill('Москва, Тверская, 7');await page.locator('#nearby-address-search').click();
  await expect(page.locator('#nearby-status')).toContainText('Сервис поиска адресов временно недоступен');
  await page.locator('#nearby-shopping').getByRole('button',{name:'Выбрать точку на карте',exact:true}).click();
  // The next presentation frame must preserve the requested map destination.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('.stores-map')).toBeFocused();
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
  await expect(page.locator('#stores-location-status')).toBeHidden();
  await expect(page.locator('#nearby-selected-store')).toBeHidden();
});

test('a full spoken goal keeps people and period while the precise address stays outside AI and preference storage',async({page})=>{
  await isolate(page);let ai=0;await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
  await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page);await openStoreDetails(page);
  await say(page,'Собери недорогую корзину на неделю для троих, я живу в Пушкино, до 10 км');
  await expect(page.locator('#nearby-address')).toHaveValue('в Пушкино');await expect(page.locator('#nearby-radius')).toHaveValue('10');
  await closeHory(page);await openStoreDetails(page);
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));expect(stored).not.toContain('Пушкино');
  await page.locator('.stores-map').press('Enter');
  await page.locator('#nearby-radius').selectOption('20');await page.locator('#nearby-connected-only').check();
  const choose=page.locator('#nearby-results article').first().getByRole('button',{name:'Открыть товары',exact:true});
  await choose.click();await page.getByRole('button',{name:'Собрать корзину здесь',exact:true}).click();
  await openHory(page);
  await expect(page.locator('#basket-proposal-status')).toContainText('для 3 человек, на 7 дн.');
  await expect(page.locator('#basket-proposal-status')).toContainText('Какие продукты исключить');expect(ai).toBe(0);
});

test('nearby cards page past fifteen and stop at the honest end',async({page,context})=>{
  await isolateRegional(page);
  const center={lat:55.75,lon:37.61};
  const template=joinedDirectory.stores.find(row=>row.retailerId==='vkusvill'&&!row.catalogBinding);
  const packet={...joinedDirectory,stores:Array.from({length:17},(_,i)=>({...template,
    id:`fixture:nearby:${i+1}`,name:`Тестовый магазин ${i+1}`,address:`Москва, тестовая улица, ${i+1}`,
    lat:center.lat+i*0.0002,lon:center.lon,catalogBinding:null}))};
  await page.route('**/nearbyGroceryStores.json',route=>route.fulfill({json:packet}));
  await page.route('**/magnitRegisteredCoordinates.json',route=>route.fulfill({status:404}));
  await page.goto('/?comparison=observed&catalog=retail#shop',{waitUntil:'domcontentloaded'});
  await selectStore(page);await openStoreDetails(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({latitude:center.lat,longitude:center.lon,accuracy:10});

  await page.locator('#nearby-shopping').getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
  await page.locator('#nearby-locate').click();
  await page.locator('#nearby-radius').selectOption('1');
  await page.locator('#nearby-connected-only').uncheck();
  const cards=page.locator('#nearby-results article');
  const more=page.locator('#nearby-results').getByRole('button',{name:/Показать ещё/u});
  await expect(cards).toHaveCount(5);
  for(const [count,firstNew] of [[10,6],[15,11],[17,16]]){
    await more.press('Enter');
    await expect(cards).toHaveCount(count);
    await expect(cards.nth(firstNew-1).getByRole('link',{name:'Маршрут',exact:true})).toBeFocused();
  }
  await expect(more).toHaveCount(0);
  await expect(page.locator('#nearby-results')).not.toContainText('первые 15');
});


test('duplicate house suggestions appear once while distinct houses remain selectable', async ({page}) => {
  await isolateRegional(page);
  const house = { lat: 55.76004, lon: 37.85269, label: 'Московская область, Реутов, Лесная улица, 7', precision: 'house' };
  const landmark = { ...house, label: 'Московская область, Реутов, Лесная улица, 8' };
  await page.route('**/functions/v1/nearby-address', route => route.fulfill({ json: {
    version: 1, candidates: [house, { ...house, lat: 55.76005 }, landmark]
  }}));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await page.locator('#nearby-address').fill('Реутов, Лесная 7');
  await page.locator('#nearby-address').press('Enter');
  const buttons = page.locator('#nearby-address-candidates button');
  await expect(buttons).toHaveCount(2);
  await expect(buttons.first()).toHaveText(house.label);
  await expect(buttons.last()).toHaveText(landmark.label);
  await buttons.first().click();
  await expect(page.locator('#nearby-results article').first()).toBeVisible();
});
test('denied geolocation and an empty geocoder still open the exact Moscow directory store',async({page})=>{
 await isolateRegional(page);
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok,fail){fail({code:1});}}}));
 await page.route('**/functions/v1/nearby-address',r=>r.fulfill({json:{version:1,candidates:[]}}));
 await page.goto('/?comparison=observed&catalog=retail#shop');await selectStore(page);await openStoreDetails(page);
 const nearby=page.locator('#nearby-shopping');await nearby.getByRole('button',{name:'📍 Найти магазины рядом',exact:true}).click();
 await page.locator('#nearby-locate').click();await expect(page.locator('#nearby-status')).toContainText('Доступ к геолокации закрыт');
 await page.locator('#nearby-address').fill('Москва, Ленинградское шоссе, 71Г');await page.locator('#nearby-address-search').click();
 const candidate=page.locator('#nearby-address-candidates').getByRole('button');await expect(candidate).toContainText('магазин-ориентир');await candidate.click();
 const row=page.locator('#nearby-results article').filter({has:page.getByText('Москва, Ленинградское шоссе, 71Г',{exact:true})});
 await expect(row).toBeVisible();await row.getByRole('button',{name:'Открыть товары'}).click();await expect(page.locator('#metro-store-address')).toHaveValue('10');
});
