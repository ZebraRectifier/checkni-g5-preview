import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialProduct,officialProductUrl,validOfficialSnapshot,currentOfficialProducts,verifyOfficialRefresh,OFFICIAL_SCOPE,OFFICIAL_CATALOG_URL } from '../src/observations/okeyOfficialPromotions.mjs';
// Rendered structure observed on the official milk card, 17 October 2026.
const raw={name:'БЗМЖ Молоко пастер Лебедяньмолоко отб 3,4-4,5% 900г пэт',rubles:'82',cents:'59',oldRubles:'126',oldCents:'49',
  selectedCity:'Москва',endText:'Акция действует до 17 октября',observedAt:'2026-10-17T20:00:00Z',
  productUrl:'https://www.okmarket.ru/product/bzmzh_moloko_paster_lebedyanmoloko_otb_3445_900g_pet/'};
function snapshot() {return {version:1,kind:'okey-official-city-promotions',retailerId:'okey',sourceUrl:OFFICIAL_CATALOG_URL,
  scope:OFFICIAL_SCOPE,selectedCity:'Москва',physicalStoreId:null,physicalStoreAddress:null,complete:false,
  observedAt:'2026-10-17T20:01:00Z',products:[parseOfficialProduct(raw)]};}
const verification=()=>({startedAt:'2026-10-17T19:59:00Z',status:{status:'collected',lastAttemptAt:'2026-10-17T19:59:01Z',uniqueProducts:1},snapshot:snapshot(),nowMs:Date.parse('2026-10-17T20:02:00Z')});
test('real official card preserves minor units and reference without inventing card/no-card truth',()=>{
  const p=parseOfficialProduct(raw);assert.equal(p.priceMinor,8259);assert.equal(p.referenceOldPriceMinor,12649);
  assert.equal(p.priceWithCardMinor,null);assert.equal(p.priceWithoutCardMinor,null);assert.equal(p.availability,'unknown');
  assert.equal(p.validUntil,'2026-10-17');assert.equal(validOfficialSnapshot(snapshot()),true);
});
test('malformed, zero, missing, ambiguous prices and missing dates do not become observations',()=>{
  for(const change of [{rubles:'0',cents:'00'},{cents:''},{rubles:'82.59'},{cents:'5'},{endText:''},{endText:'Акция действует до 31 февраля'},{endText:'Акция действует до 16 октября'}])assert.equal(parseOfficialProduct({...raw,...change}),null);
});
test('unknown city and third-party or query-scoped URLs cannot produce Moscow prices',()=>{
  assert.equal(parseOfficialProduct({...raw,selectedCity:'Санкт-Петербург'}),null);
  for(const url of ['http://www.okmarket.ru/product/x/','https://evil.example/product/x/','https://www.okmarket.ru/product/x/?city=other','https://user@www.okmarket.ru/product/x/'])assert.equal(officialProductUrl(url),null);
});
test('Moscow midnight removes yesterday promotions even before UTC midnight',()=>{
  assert.equal(currentOfficialProducts(snapshot(),Date.parse('2026-10-17T20:59:59Z')).length,1);
  assert.equal(currentOfficialProducts(snapshot(),Date.parse('2026-10-17T21:00:00Z')).length,0);
});
test('future and older than 24-hour observations cannot be shown as current',()=>{
  const s=snapshot();s.products[0].validUntil='2026-11-11';
  assert.equal(currentOfficialProducts(s,Date.parse('2026-10-17T19:59:59Z')).length,0);
  assert.equal(currentOfficialProducts(s,Date.parse('2026-10-18T20:00:00.001Z')).length,0);
});
test('physical-store inference, full catalogue claim, duplicate SKUs and malformed dates fail closed',()=>{
  for(const mutate of [s=>s.physicalStoreId='okey-180',s=>s.complete=true,s=>s.scope='exact-store',s=>s.products.push(s.products[0]),
    s=>s.products[0].priceWithCardMinor=8259,s=>s.products[0].validUntil='2026-02-30',s=>s.products[0].sourceProductId='other']){
    const s=snapshot();mutate(s);assert.equal(validOfficialSnapshot(s),false);
  }
});
test('only a newly observed official source snapshot verifies the separate city source',()=>{
  assert.equal(verifyOfficialRefresh(verification()).fresh,true);
  for(const mutate of [i=>i.status.status='blocked',i=>i.status.lastAttemptAt='2026-10-16T20:00:00Z',
    i=>i.status.uniqueProducts=2,i=>i.startedAt='2026-10-17T20:03:00Z',i=>i.snapshot.observedAt='2026-10-17T20:04:00Z',
    i=>i.status.lastAttemptAt='2026-10-17T20:00:30Z',i=>i.nowMs=Date.parse('2026-10-17T21:00:00Z')]){
    const i=verification();mutate(i);assert.equal(verifyOfficialRefresh(i).fresh,false);
  }
});
