import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {REGISTERED_MAGNIT_STORES} from '../src/data/registeredMagnitStores.mjs';
import {registeredMagnitCoordinatePoints,withRegisteredMagnitCoordinates,nearbyCatalogBinding,
  nearbyGroceryMatches,boundMagnitMapLocations,nearestStoreMapPins} from '../src/intelligence/nearbyShopping.mjs';
import {createNearbyShoppingPort} from '../src/ports/nearbyShoppingPort.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const packet=await json('../src/data/magnitRegisteredCoordinates.json');
const original=await json('../src/data/nearbyGroceryStores.json');
const evidenceRoot='../evidence/magnit-nearby-20261107/';

test('every admitted coordinate comes from its official active shop ID and a bounded live catalogue aggregate',async()=>{
  const manifest=await json(evidenceRoot+'source-manifest.json'),db=await json(evidenceRoot+'catalog-store-ids.json');
  const records=new Map();
  assert.equal(manifest.receipts.length,40);assert.equal(manifest.exhaustive,false);assert.equal(manifest.priceEvidence,false);
  for(const receipt of manifest.receipts){
    assert.equal(receipt.httpStatus,200);
    const bytes=gunzipSync(await readFile(new URL(evidenceRoot+receipt.file,import.meta.url)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.sha256);
    for(const row of JSON.parse(bytes).data){
      const prior=records.get(row.externalId.storeCode);
      if(prior){assert.deepEqual(prior.coordinates,row.coordinates);assert.equal(prior.address,row.address);}
      records.set(row.externalId.storeCode,row);
    }
  }
  assert.equal(db.priceFreshnessProven,false);assert.match(db.query,/limit 1461;/u);
  const catalogs=new Map(db.rows.map(row=>[row.store_id,row]));
  assert.deepEqual([...catalogs.keys()].sort(),REGISTERED_MAGNIT_STORES.map(row=>'magnit-'+row.shopCode).sort());
  assert.equal(packet.catalogEvidence.checkedAt,db.checkedAt);
  assert.equal(packet.stores.length,1407);
  for(const row of packet.stores){
    const source=records.get(row.shopCode),catalog=catalogs.get('magnit-'+row.shopCode);
    assert.equal(source.externalId.owner,row.owner);assert.equal(source.isActive,true);assert.equal(source.status,'STATUS_ACTIVE');
    assert.ok(source.deliveryTypeList.includes('DELIVERY_TYPE_OFFLINE'));assert.equal(source.storeTypeV2,row.storeType);
    assert.equal(source.address,row.address);assert.deepEqual(source.coordinates,{latitude:row.lat,longitude:row.lon});
    assert.equal(row.catalog.activeItems,catalog.active_items);
    assert.equal(row.catalog.newestProductObservedAt,new Date(catalog.newest_observed_at).toISOString());
    assert.equal(row.catalog.oldestProductObservedAt,new Date(catalog.oldest_observed_at).toISOString());
  }
});

test('supplement preserves every original row and 46 bindings, adding exactly 1363 registered locations without prices',()=>{
  const before=JSON.stringify(original),combined=withRegisteredMagnitCoordinates(original,packet);
  assert.equal(REGISTERED_MAGNIT_STORES.length,1460);assert.equal(JSON.stringify(original),before);
  assert.equal(combined.stores.length,original.stores.length+1363);
  assert.deepEqual(combined.stores.slice(0,original.stores.length),original.stores);
  assert.equal(new Set(combined.stores.map(row=>row.id)).size,combined.stores.length);
  const pins=boundMagnitMapLocations(combined),oldPins=boundMagnitMapLocations(original);
  assert.equal(oldPins.length,46);assert.equal(pins.length,1409);
  for(const old of oldPins)assert.deepEqual(pins.find(row=>row.id===old.id),old);
  assert.ok(pins.every(row=>nearbyCatalogBinding(row)?.store?.shopCode===row.shopCode));
  const additions=combined.stores.slice(original.stores.length);
  assert.ok(additions.every(row=>row.id.startsWith('official:magnit:')&&row.sourceUrl==='https://magnit.ru/shops'));
  assert.ok(additions.every(row=>row.priceMinor===undefined&&row.availability===undefined));
  assert.equal(combined.observedAt,original.observedAt);
  const long=additions.find(row=>row.sourceStoreId==='503350');assert.equal(long.address.length,196);
  assert.ok(nearbyCatalogBinding(long));
});

test('forged coordinates, identity, sources and registry-only catalogue claims are rejected',()=>{
  const points=registeredMagnitCoordinatePoints(packet);assert.equal(points.length,1407);
  const point=points[0];assert.ok(nearbyCatalogBinding(point));
  for(const changed of [{lat:point.lat+0.01},{sourceUrl:'https://magnit.ru.example.org/shops'},
    {address:point.address+' 2'},{id:'osm:node:42'},{sourceStoreId:'999999'},
    {catalogBinding:{...point.catalogBinding}}])assert.equal(nearbyCatalogBinding({...point,...changed}),null);
  assert.deepEqual(registeredMagnitCoordinatePoints({...packet,priceEvidence:true}),[]);
  const wrongRegion={...original,region:'kazan'};
  assert.equal(withRegisteredMagnitCoordinates(wrongRegion,packet),wrongRegion);
  assert.deepEqual(registeredMagnitCoordinatePoints({...packet,stores:[packet.stores[0],packet.stores[0]]}),[]);
  for(const changed of [{shopCode:'999999'},{registeredAddress:'Москва, неверный адрес'},{lat:59.94,lon:30.31},
    {owner:'OTHER'},{isActive:false},{status:'STATUS_CLOSED'},{storeType:'MK'},{offline:false}]){
    assert.deepEqual(registeredMagnitCoordinatePoints({...packet,stores:[{...packet.stores[0],...changed}]}),[]);
  }
});

test('missing or invalid populated-catalogue evidence retains only an address, never the connected filter',()=>{
  const source=packet.stores[0];
  for(const catalog of [null,{...source.catalog,activeItems:0},{...source.catalog,storeId:'magnit-999999'},
    {...source.catalog,newestProductObservedAt:'2099-01-01T00:00:00.000Z'}]){
    const [point]=registeredMagnitCoordinatePoints({...packet,stores:[{...source,catalog}]});
    assert.ok(point);assert.equal(nearbyCatalogBinding(point),null);assert.equal(point.catalogBinding,undefined);
    assert.equal(nearbyGroceryMatches([point],point,1).length,1);
    assert.deepEqual(nearbyGroceryMatches([point],point,1,{connectedOnly:true}),[]);
    assert.equal(point.sourceUrl,'https://magnit.ru/shops');
  }
  const [point]=registeredMagnitCoordinatePoints({...packet,catalogEvidence:null,stores:[source]});
  assert.equal(nearbyCatalogBinding(point),null);
});

test('Moscow and oblast points resolve at their own coordinates without changing source price dates',()=>{
  const combined=withRegisteredMagnitCoordinates(original,packet);
  for(const code of ['303857','503350']){
    const point=combined.stores.find(row=>row.sourceStoreId===code);assert.ok(point,code);
    const rows=nearbyGroceryMatches(combined.stores,point,1,{connectedOnly:true});
    const row=rows.find(row=>row.sourceStoreId===code);assert.ok(row);
    assert.equal(row.distanceMeters,0);assert.equal(row.catalog.store.shopCode,code);
  }
});

test('at most 200 nearest map pins render, keeping a selected far pin and the complete unmodified directory',()=>{
  const combined=withRegisteredMagnitCoordinates(original,packet),pins=boundMagnitMapLocations(combined);
  const originalOrder=pins.map(row=>row.id);const point=pins.at(-1);
  const nearby=nearestStoreMapPins(pins,point);
  assert.equal(nearby.length,200);assert.equal(nearby[0].id,point.id);
  const far=pins.find(row=>!nearby.includes(row));assert.ok(far);
  const kept=nearestStoreMapPins(pins,point,{selectedIds:[far.id]});
  assert.equal(kept.length,200);assert.ok(kept.includes(far));assert.ok(kept.includes(point));
  assert.deepEqual(pins.map(row=>row.id),originalOrder);assert.equal(pins.length,1409);
});

test('port composes the packet once and a missing or malformed supplement preserves the original directory',async()=>{
  for(const supplement of [packet,null,{...packet,priceEvidence:true}]){
    const calls=[];const port=createNearbyShoppingPort({fetchImpl:async url=>{
      calls.push(String(url));return String(url).endsWith('/magnitRegisteredCoordinates.json')
        ?supplement===null?new Response('',{status:404}):Response.json(supplement):Response.json(original);
    }});
    const [a,b]=await Promise.all([port.directory(),port.directory()]);
    assert.equal(a,b);assert.equal(calls.length,2);
    assert.equal(a.stores.length,original.stores.length+(supplement===packet?1363:0));
    assert.ok(calls.every(url=>!url.includes('magnit.ru')&&!url.includes('supabase.co')));
    if(supplement===packet)assert.equal(boundMagnitMapLocations(a).length,1409);
  }
});
