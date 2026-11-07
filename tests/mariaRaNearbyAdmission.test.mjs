import test from 'node:test';
import assert from 'node:assert/strict';
import {nearbyGroceryMatches} from '../src/intelligence/nearbyShopping.mjs';
import {nearbyRegionForPosition} from '../src/intelligence/nearbyRegions.mjs';
import {createNearbyShoppingPort} from '../src/ports/nearbyShoppingPort.mjs';

// One observed public directory record; no store catalogue or price is inferred.
const point={id:'derived:maria-ra:novosibirsk:7ea826f098f0fa0cd855',name:'Мария-Ра',retailerId:'maria-ra',
  city:'Новосибирск',address:'Новосибирск, ул. Плющихинская, 6',lat:55.01444,lon:83.00199,
  sourceUrl:'https://www.maria-ra.ru/'};
const envelope=(stores=[point])=>({schemaVersion:1,region:'novosibirsk',exhaustive:false,priceEvidence:false,
  observedAt:'2026-11-07T06:51:07.680Z',stores});

test('Maria-Ra official host gives regional geography only, never a connected Moscow catalogue',()=>{
  const rows=nearbyGroceryMatches([point],point,1,{regional:true});
  assert.equal(rows.length,1);assert.equal(rows[0].id,point.id);
  assert.equal(rows[0].catalog,null);assert.equal(rows[0].priceMinor,undefined);
  assert.equal(nearbyRegionForPosition(rows[0])?.id,'novosibirsk');
  assert.deepEqual(nearbyGroceryMatches([point],point,1),[]);
  assert.deepEqual(nearbyGroceryMatches([point],point,1,{regional:true,connectedOnly:true}),[]);
  assert.deepEqual(nearbyGroceryMatches([point],{lat:55.75,lon:37.62},20,{regional:true}),[]);
  const forged={...point,catalogBinding:{retailerId:'magnit',shopCode:'777312',address:'Москва'}};
  assert.equal(nearbyGroceryMatches([forged],point,1,{regional:true})[0].catalog,null);
});

test('Maria-Ra source admission remains exact HTTPS host without credential or suffix tricks',()=>{
  for(const sourceUrl of ['http://www.maria-ra.ru/','https://www.maria-ra.ru.example.org/',
    'https://evil.maria-ra.ru/','https://someone@www.maria-ra.ru/','https://www.maria-ra.ru@evil.example/',
    'javascript:alert(1)','https://maria-ra.ru/']){
    assert.deepEqual(nearbyGroceryMatches([{...point,sourceUrl}],point,1,{regional:true}),[],sourceUrl);
  }
});

test('Novosibirsk envelope refuses price, catalogue and city claims before caching',async()=>{
  for(const invalid of [{region:'moscow-and-oblast'},{schemaVersion:2},{priceEvidence:true},
    {exhaustive:true},{observedAt:'not a date'},{stores:[{...point,catalogBinding:{kind:'invented'}}]}]){
    const port=createNearbyShoppingPort({fetchImpl:async()=>Response.json({...envelope(),...invalid})});
    await assert.rejects(port.regionalDirectory('novosibirsk'),/directory_invalid/u);
  }
});

test('exact Novosibirsk address falls back to a shop landmark without Moscow or retailer requests',async()=>{
  const requests=[];
  const port=createNearbyShoppingPort({fetchImpl:async(url,options)=>{
    requests.push({url:String(url),body:options.body});
    if(String(url).includes('/functions/'))return Response.json({version:1,candidates:[]});
    assert.match(String(url),/nearby-regions\/novosibirsk\.json$/u);
    return Response.json(envelope());
  }});
  const exact=await port.address('Новосибирск Плющихинская 6');
  assert.equal(exact.kind,'directory');assert.equal(exact.candidates.length,1);
  assert.equal(exact.candidates[0].precision,'store');
  assert.match(exact.candidates[0].label,/^Мария-Ра · Новосибирск/u);
  assert.equal(nearbyRegionForPosition(exact.candidates[0])?.id,'novosibirsk');
  const differentHouse=await port.address('Новосибирск Плющихинская 60');
  assert.equal(differentHouse.kind,'results');assert.deepEqual(differentHouse.candidates,[]);
  assert.equal(requests.filter(r=>r.url.endsWith('/novosibirsk.json')).length,1);
  assert.equal(requests.some(r=>/maria-ra\.ru|nearbyGroceryStores\.json/u.test(r.url)),false);
  assert.deepEqual(JSON.parse(requests[0].body),{query:'Новосибирск Плющихинская 6',consent:true});
});
