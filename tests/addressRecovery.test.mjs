import test from 'node:test';
import assert from 'node:assert/strict';
import {createAddressRecovery,directoryAddressCandidates} from '../src/ports/addressRecovery.mjs';
import {createNearbyShoppingPort} from '../src/ports/nearbyShoppingPort.mjs';
const success={kind:'results',candidates:[{lat:55.75,lon:37.61,label:'Москва, Тверская, 7',precision:'house'}]};
test('clear forgets cached addresses and a late response cannot refill memory',async()=>{
 let release,calls=0;const address=createAddressRecovery({request:async()=>{calls++;return calls===1?new Promise(resolve=>{release=resolve;}):success;}});
 const first=address('Москва');address.clear();release(success);await first;
 await address('Москва');assert.equal(calls,2);
 address.clear();await address('Москва');assert.equal(calls,3);
});
test('one transient failure recovers; concurrent work is shared and cached results expire',async()=>{
 let calls=0,time=1000;const waits=[];
 const address=createAddressRecovery({now:()=>time,wait:async ms=>waits.push(ms),request:async()=>++calls===1?{kind:'unavailable',retryable:true}:success});
 const [a,b]=await Promise.all([address('Москва'),address('Москва')]);assert.deepEqual(a,success);assert.deepEqual(b,success);
 assert.equal(calls,2);assert.deepEqual(waits,[1200]);a.candidates[0].label='changed';
 assert.deepEqual(await address('Москва'),success);assert.equal(calls,2);
 time+=300001;await address('Москва');assert.equal(calls,3);
});
test('failure is bounded and not cached; quotas and malformed responses do not retry',async()=>{
 for(const kind of ['limited','unavailable']){
  let calls=0;const address=createAddressRecovery({request:async()=>{calls++;return{kind,retryable:kind==='unavailable'};},wait:async()=>{}});
  assert.equal((await address('Москва')).kind,kind);assert.equal(calls,kind==='limited'?1:2);
  await address('Москва');assert.equal(calls,kind==='limited'?2:4);
 }
 let calls=0;const address=createAddressRecovery({request:async()=>{calls++;return{kind:'unavailable'};}});
 await address('Москва');assert.equal(calls,1);
});
test('directory fallback is a bounded shop landmark, never a guessed house number',()=>{
 const row={name:'Магнит',address:'Москва Тверская 70',lat:55.75,lon:37.61};
 assert.deepEqual(directoryAddressCandidates([row],'Тверская 7'),[]);
 assert.equal(directoryAddressCandidates([row],'Москва Тверская 70')[0].precision,'store');
 assert.deepEqual(directoryAddressCandidates([row],'Пушкино'),[]);
 assert.deepEqual(directoryAddressCandidates([{...row,lat:90}],'Магнит'),[]);
 assert.equal(directoryAddressCandidates(Array.from({length:10},(_,i)=>({...row,address:'Москва '+i})),'Москва').length,5);
});
test('429 never retries the server; matching directory shop is an explicit fallback',async()=>{
 let requests=0;
 const port=createNearbyShoppingPort({fetchImpl:async url=>{
  if(String(url).endsWith('nearbyGroceryStores.json'))return Response.json({schemaVersion:1,region:'moscow-and-oblast',exhaustive:false,priceEvidence:false,observedAt:'2026-11-01T00:00:00Z',stores:[{name:'Глобус Красногорск',address:'Москва Новорижское шоссе',lat:55.8,lon:37.3}]});
  if(String(url).endsWith('magnitRegisteredCoordinates.json'))return new Response('',{status:404});
  requests++;return new Response('',{status:429});
 }});
 const value=await port.address('Глобус Красногорск');assert.equal(value.kind,'directory');assert.equal(requests,1);
 assert.equal((await port.address('Адрес без совпадений')).kind,'limited');assert.equal(requests,2);
});
test('empty Moscow geocoder response offers only matching directory store landmarks',async()=>{
 const calls=[];const stores=[{name:'Магнит',address:'Москва Тверская 70',lat:55.75,lon:37.61}];
 const port=createNearbyShoppingPort({fetchImpl:async url=>{
  const u=String(url);calls.push(u);
  if(u.endsWith('nearbyGroceryStores.json'))return Response.json({schemaVersion:1,region:'moscow-and-oblast',exhaustive:false,priceEvidence:false,observedAt:'2026-11-01T00:00:00Z',stores});
  if(u.endsWith('magnitRegisteredCoordinates.json'))return new Response('',{status:404});
  return Response.json({version:1,candidates:[]});
 }});
 const hit=await port.address('Москва Тверская 70');assert.equal(hit.kind,'directory');assert.equal(hit.candidates[0].precision,'store');assert.match(hit.candidates[0].label,/Тверская 70/u);
 assert.ok(calls.some(url=>url.endsWith('nearbyGroceryStores.json')));
 const miss=await port.address('Москва Тверская 7');assert.deepEqual(miss,{kind:'results',candidates:[]});
});
test('empty response never substitutes another city, street, house or an unscoped query',async()=>{
 const calls=[];const stores=[{name:'Магнит',address:'Москва Тверская 70',lat:55.75,lon:37.61}];
 const port=createNearbyShoppingPort({fetchImpl:async url=>{
  const u=String(url);calls.push(u);
  if(u.endsWith('nearbyGroceryStores.json'))return Response.json({schemaVersion:1,region:'moscow-and-oblast',exhaustive:false,priceEvidence:false,observedAt:'2026-11-01T00:00:00Z',stores});
  if(u.endsWith('magnitRegisteredCoordinates.json'))return new Response('',{status:404});
  return Response.json({version:1,candidates:[]});
 }});
 for(const query of ['Москва Тверская 7','Москва Ленинградская 70','Мытищи Тверская 70']) {
  assert.deepEqual(await port.address(query),{kind:'results',candidates:[]},query);
 }
 const before=calls.length;assert.deepEqual(await port.address('Тверская 70'),{kind:'results',candidates:[]});
 assert.equal(calls.slice(before).filter(url=>url.endsWith('nearbyGroceryStores.json')).length,0);
 assert.deepEqual(await port.address(''),{kind:'invalid',candidates:[]});
 assert.deepEqual(await port.address('Мо'),{kind:'invalid',candidates:[]});
});
