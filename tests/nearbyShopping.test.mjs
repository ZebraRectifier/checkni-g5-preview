import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{nearbyShoppingIntent,nearbyGroceryMatches,nearbyCatalogBinding,boundMagnitMapLocations}from'../src/intelligence/nearbyShopping.mjs';
import{normalizedAddressCandidate}from'../src/intelligence/nearbyAddressContract.mjs';
import{createNearbyShoppingPort}from'../src/ports/nearbyShoppingPort.mjs';
const feature=(props={},coords=[37.854,56.04])=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{countrycode:'RU',state:'Московская область',city:'Пушкино',street:'Пушкинская улица',housenumber:'1',...props}});
test('address clarification opens a local place picker without treating a household answer as an address',()=>{
  assert.equal(nearbyShoppingIntent('на троих'),null);assert.equal(nearbyShoppingIntent('Текущий магазин',true),null);
  assert.equal(nearbyShoppingIntent('Магнит и О’КЕЙ',true),null);
  assert.equal(nearbyShoppingIntent('Без мяса',true),null);assert.equal(nearbyShoppingIntent('На троих',true),null);
  assert.equal(nearbyShoppingIntent('Морковь не добавляй',true),null);
  assert.deepEqual(nearbyShoppingIntent('Москва, Тверская, 7',true),{query:'Москва, Тверская, 7',radiusKm:null});
  assert.deepEqual(nearbyShoppingIntent('Найти магазины рядом'),{query:'',radiusKm:null});
  assert.deepEqual(nearbyShoppingIntent('Я живу в Пушкино, до 10 км'),{query:'в Пушкино',radiusKm:10});
  assert.deepEqual(nearbyShoppingIntent('Собери недорогую корзину на неделю для троих, я живу в Пушкино, до 10 км'),{query:'в Пушкино',radiusKm:10});
  assert.deepEqual(nearbyShoppingIntent('Я живу в Пушкино, Московская область, до 20 км. Морковь не добавляй.'),
    {query:'в Пушкино, Московская область',radiusKm:20,preferenceText:'Морковь не добавляй.'});
  assert.deepEqual(nearbyShoppingIntent('Я живу в Пушкино, ул. Ленина, д. 12. Морковь не добавляй.'),
    {query:'в Пушкино, ул. Ленина, д. 12',radiusKm:null,preferenceText:'Морковь не добавляй.'});
  assert.deepEqual(nearbyShoppingIntent('Я живу в Пушкино, до 20 км, морковь не добавляй'),
    {query:'в Пушкино',radiusKm:20,preferenceText:'морковь не добавляй'});
  assert.deepEqual(nearbyShoppingIntent('Я живу в Пушкино, ул. Морковная, д. 12'),
    {query:'в Пушкино, ул. Морковная, д. 12',radiusKm:null});
});
test('geocoder accepts Moscow and oblast, preserving precision and rejecting other regions or malformed coordinates',()=>{
  const accepted=normalizedAddressCandidate(feature());assert.equal(accepted.precision,'house');assert.equal(accepted.lat,56.04);
  assert.equal(normalizedAddressCandidate(feature({state:'Москва'})).precision,'house');
  assert.equal(normalizedAddressCandidate(feature({housenumber:null})).precision,'street');
  assert.equal(normalizedAddressCandidate(feature({state:'Тверская область'})),null);
  assert.equal(normalizedAddressCandidate(feature({countrycode:'US'})),null);
  for(const xy of [[NaN,56],['37',56],[37,90],[37,56,4]])assert.equal(normalizedAddressCandidate(feature({},xy)),null);
  assert.equal(normalizedAddressCandidate(feature({street:{bad:true}})),null);
});
test('regional snapshot is explicitly incomplete geography; every linked catalogue resolves its exact registered address',async()=>{
  const d=JSON.parse(await readFile(new URL('../src/data/nearbyGroceryStores.json',import.meta.url),'utf8'));
  assert.equal(d.priceEvidence,false);assert.equal(d.exhaustive,false);assert.equal(d.license,'ODbL-1.0');
  assert.ok(d.stores.length>10000);assert.equal(new Set(d.stores.map(s=>s.id)).size,d.stores.length);
  for(const id of ['pyaterochka','dixy','chizhik','auchan'])assert.ok(d.stores.some(s=>s.retailerId===id));
  const linked=d.stores.filter(s=>s.catalogBinding);assert.ok(linked.length>=40);
  for(const s of linked){assert.ok(nearbyCatalogBinding(s),s.id);assert.equal(nearbyCatalogBinding({...s,address:s.address+' x'}),null);}
  assert.ok(linked.some(s=>s.retailerId==='globus'&&s.catalogBinding.officialStoreId==='5014'));
});
test('Magnit map points require a unique exact address binding and carry no price claim',async()=>{
  const d=JSON.parse(await readFile(new URL('../src/data/nearbyGroceryStores.json',import.meta.url),'utf8'));
  const pins=boundMagnitMapLocations(d);
  assert.ok(pins.length>=46);
  assert.equal(new Set(pins.map(p=>p.shopCode)).size,pins.length);
  assert.ok(pins.every(p=>p.selectionKind==='registered-store'&&p.coordinateKind==='osm-exact-address-join'
    &&p.priceMinor===undefined&&p.availability===undefined&&nearbyCatalogBinding(p)?.store?.shopCode===p.shopCode));
  const original=d.stores.find(p=>p.retailerId==='magnit'&&p.catalogBinding);
  assert.ok(original);
  for(const invalid of [
    {...original,address:original.address+' x'},
    {...original,sourceUrl:'https://example.org/elsewhere'},
    {...original,lat:NaN},
    {...original,catalogBinding:undefined}
  ])assert.deepEqual(boundMagnitMapLocations({...d,stores:[invalid]}),[]);
  assert.deepEqual(boundMagnitMapLocations({...d,stores:[original,original]}),[]);
  assert.deepEqual(boundMagnitMapLocations({...d,priceEvidence:true}),[]);
});
test('distance filtering has no station dependency, never changes a price, and cannot make a directory-only point selectable',async()=>{
  const d=JSON.parse(await readFile(new URL('../src/data/nearbyGroceryStores.json',import.meta.url),'utf8'));
  for(const p of [{lat:55.75,lon:37.61},{lat:56.04,lon:37.85},{lat:55.1,lon:38.77}]){
    const rows=nearbyGroceryMatches(d.stores,p,5);assert.ok(rows.length);assert.ok(rows.every(r=>r.distanceMeters<=5000));
    assert.ok(rows.every(r=>r.priceMinor===undefined&&r.availability===undefined));
  }
  const rows=nearbyGroceryMatches(d.stores,{lat:56.04,lon:37.85},20,{connectedOnly:true});
  assert.ok(rows.some(r=>r.catalog?.store?.officialStoreId==='5014'));assert.ok(rows.every(r=>r.catalog));
  for(const radius of [0,-1,21,Infinity,'5'])assert.deepEqual(nearbyGroceryMatches(d.stores,{lat:56,lon:37},radius),[]);
  assert.deepEqual(nearbyGroceryMatches(d.stores,{lat:NaN,lon:37},5),[]);
});
test('browser directory loading is shared, finite and does not send device coordinates or query a retailer',async()=>{
  const calls=[];const p=createNearbyShoppingPort({fetchImpl:async(u,o)=>{calls.push({u:String(u),o});return Response.json({schemaVersion:1,region:'moscow-and-oblast',exhaustive:false,priceEvidence:false,observedAt:new Date().toISOString(),stores:[]});}});
  await Promise.all([p.directory(),p.directory()]);assert.equal(calls.length,1);assert.match(calls[0].u,/nearbyGroceryStores\.json$/u);
  assert.equal(calls[0].o.body,undefined);assert.equal(calls[0].o.credentials,'omit');
});
