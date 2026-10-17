import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLISHED_URL,PUBLISHED_SCOPE,parseCataloguePeriod,parsePublishedCatalogue,validPublishedSnapshot,currentPublishedProducts,verifyPublishedRefresh } from '../src/observations/okeyPublishedPromotions.mjs';
const at='2026-10-17T20:00:00.000Z';
const raw=()=>({sourceUrl:PUBLISHED_URL,title:'КАТАЛОГ АКЦИЙ «ОКЕЙ ГИПЕРМАРКЕТ» — МОСКВА',period:'с 15 по 21 октября 2026',observedAt:at,
  products:[{id:'51922605',name:'Свинина шея без кости п/ф охлажденный кг',rubles:'459',cents:'00',oldRubles:'728',oldCents:'99',endText:'до 21 октября'}]});
test('published prices preserve third-party city scope and integer kopeks',()=>{
  const s=parsePublishedCatalogue(raw());assert.ok(validPublishedSnapshot(s));assert.equal(s.scope,PUBLISHED_SCOPE);
  assert.equal(s.products[0].priceMinor,45900);assert.equal(s.products[0].availability,'unknown');
  assert.equal(s.products[0].priceWithCardMinor,null);assert.equal(s.physicalStoreId,null);assert.equal(s.complete,false);
});
test('catalogue period requires explicit valid year, bounded duration and chronological dates',()=>{
  assert.deepEqual(parseCataloguePeriod('с 29 октября по 4 ноября 2026'),{from:'2026-10-29',until:'2026-11-04'});
  for(const p of ['с 15 по 21 октября','с 31 по 32 октября 2026','с 1 января по 21 октября 2026','с 25 декабря по 7 января 2026'])assert.equal(parseCataloguePeriod(p),null);
});
test('wrong retailer, city, source, expired or future catalogue cannot become fresh prices',()=>{
  for(const change of [{title:'КАТАЛОГ АКЦИЙ «ЛЕНТА» — МОСКВА'},{title:'КАТАЛОГ АКЦИЙ «ОКЕЙ ГИПЕРМАРКЕТ» — ТУЛА'},
    {sourceUrl:'https://example.org/'},{period:'с 8 по 14 октября 2026'},{period:'с 22 по 28 октября 2026'}])assert.equal(parsePublishedCatalogue({...raw(),...change}),null);
});
test('invalid/duplicate prices and missing expiry are rejected; product expiry cannot extend catalogue',()=>{
  const r=raw();r.products.push({...r.products[0]},{...r.products[0],id:'51922606',cents:'000'},
    {...r.products[0],id:'51922607',endText:''},{...r.products[0],id:'51922608',rubles:'0',cents:'00'},
    {...r.products[0],id:'51922609',endText:'до 28 октября'});
  const s=parsePublishedCatalogue(r);assert.equal(s.products.length,2);assert.equal(s.products[1].validUntil,'2026-10-21');
});
test('expiry is enforced at Moscow midnight and freshness rejects future/older-than-24h observations',()=>{
  const s=parsePublishedCatalogue({...raw(),observedAt:'2026-10-21T19:00:00.000Z'});
  assert.equal(currentPublishedProducts(s,Date.parse('2026-10-21T20:59:59Z')).length,1);
  assert.equal(currentPublishedProducts(s,Date.parse('2026-10-21T21:00:00Z')).length,0);
  const fresh=parsePublishedCatalogue(raw());assert.equal(currentPublishedProducts(fresh,Date.parse(at)-1).length,0);
  assert.equal(currentPublishedProducts(fresh,Date.parse(at)+86_400_001).length,0);
});
test('snapshot mutations cannot invent store/card/stock, source links, prices or dates',()=>{
  const s=parsePublishedCatalogue(raw());
  for(const change of [{physicalStoreId:'123'},{scope:'exact-store'},{complete:true},{publisher:'okey'}])assert.equal(validPublishedSnapshot({...s,...change}),false);
  for(const change of [{productUrl:'https://example.org/'},{priceMinor:0},{availability:'in-stock'},{priceWithCardMinor:100},
    {validUntil:'2026-11-01'},{validUntil:'2026-10-32'},{observedAt:'2026-10-16T20:00:00Z'}])assert.equal(validPublishedSnapshot({...s,products:[{...s.products[0],...change}]}),false);
});
test('freshness requires evidence newly collected in this run, independent of retained historical data',()=>{
  const snapshot=parsePublishedCatalogue(raw()),startedAt='2026-10-17T19:59:00Z',nowMs=Date.parse(at)+1000;
  const status={status:'collected',lastAttemptAt:startedAt,sourceUrl:PUBLISHED_URL,scope:PUBLISHED_SCOPE,uniqueProducts:1};
  assert.equal(verifyPublishedRefresh({startedAt,status,snapshot,nowMs}).fresh,true);
  for(const change of [{status:'blocked'},{uniqueProducts:2},{lastAttemptAt:'2026-10-17T19:58:00Z'},{scope:'exact-store'}])
    assert.equal(verifyPublishedRefresh({startedAt,status:{...status,...change},snapshot,nowMs}).fresh,false);
  assert.equal(verifyPublishedRefresh({startedAt:'2026-10-17T20:00:01Z',status,snapshot,nowMs}).fresh,false);
});
