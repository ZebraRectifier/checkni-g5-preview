import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{parsePyatCatalogue,validPyatSnapshot,currentPyatProducts,pyatWeeklyCards,validPyatWeeklySource,PYAT_WEEKLY_SCOPE,verifyPyatRefresh}from'../src/observations/pyaterochkaPublishedPromotions.mjs';
import{pyatCollectionGate,reservePyatAttempt}from'../tools/pyaterochka-public-catalog/collection-gate.mjs';
const raw=JSON.parse(await readFile(new URL('./fixtures/pyaterochka-public/raw-20261018.json',import.meta.url),'utf8'));
const at=Date.parse(raw.observedAt),snapshot=()=>parsePyatCatalogue(raw);
test('actual source shape admits food only and never invents a physical store, card price or stock',()=>{
  const s=snapshot();assert.ok(s);assert.equal(s.products.length,160);assert.equal(s.complete,false);assert.equal(s.physicalStoreId,null);
  assert.equal(s.selectedCity,'Москва');assert.ok(s.products.every(p=>p.availability==='unknown'&&p.priceWithCardMinor===null&&p.priceWithoutCardMinor===null));
  assert.ok(!s.products.some(p=>p.name.includes('Whiskas')));
});
test('wrong source/city/period are rejected; invalid money/currency never become a zero-priced offer',()=>{
  for(const change of [{sourceUrl:raw.sourceUrl.replace('mos.','')},{title:raw.title.replace(/Москва/iu,'Казань')},{period:'с 1 по 10 октября 2026'}])assert.equal(parsePyatCatalogue({...raw,...change}),null);
  for(const change of [{rubles:7},{rubles:'-7'},{cents:'9'},{currency:'USD'},{name:{malformed:true}},{endText:3}]){
    const p={...raw.products.find(p=>p.id==='51936224'),...change};assert.equal(parsePyatCatalogue({...raw,products:[p]}),null);
  }
});
test('duplicate conflicting product IDs and nonempty per-product conditions are excluded rather than choosing a cheap price',()=>{
  const p=raw.products.find(p=>p.id==='51936224'),other=raw.products.find(p=>p.id==='51936184');
  const d=parsePyatCatalogue({...raw,products:[p,{...p,rubles:'1'},other]});assert.equal(d.products.length,1);assert.equal(d.products[0].sourceProductId,other.id);
  assert.equal(parsePyatCatalogue({...raw,products:[{...p,endText:'до 18 октября'}]}),null);
});
test('source observation age and Moscow promotion expiry remove offers including future or malformed clocks',()=>{
  const s=snapshot();assert.ok(currentPyatProducts(s,at).length);assert.ok(currentPyatProducts(s,at+86400000).length);
  assert.deepEqual(currentPyatProducts(s,at+86400001),[]);assert.deepEqual(currentPyatProducts(s,at-1),[]);assert.deepEqual(currentPyatProducts(s,NaN),[]);
  const late={...s,observedAt:'2026-10-19T20:30:00.000Z',products:s.products.map(p=>({...p,observedAt:'2026-10-19T20:30:00.000Z'}))};
  assert.ok(currentPyatProducts(late,Date.parse('2026-10-19T20:59:59.999Z')).length);
  assert.deepEqual(currentPyatProducts(late,Date.parse('2026-10-19T21:00:00Z')),[]);
});
test('six reviewed exact packs preserve source amounts, adult milk volume and names; mass milk and child milk remain unadmitted',()=>{
  const s=snapshot(),cards=pyatWeeklyCards(s,at);assert.equal(cards.length,6);
  const milk=cards.find(c=>c.sourceProductId==='51936224');assert.equal(milk.unit,'925 мл');assert.equal(milk.priceMinor,9499);
  assert.ok(!cards.some(c=>['51936092','51936317'].includes(c.sourceProductId)));
  const changed={...s,products:s.products.map(p=>p.sourceProductId===milk.sourceProductId?{...p,name:p.name.replace('925мл','950г')}:p)};
  assert.equal(pyatWeeklyCards(changed,at).length,5);assert.equal(milk.physicalStoreId,null);assert.equal(milk.priceScope,'city-promotion');
});
test('card links and pack identity cannot be transplanted to an address, retailer or different source URL',()=>{
  const c=pyatWeeklyCards(snapshot(),at)[0];assert.equal(validPyatWeeklySource(c,PYAT_WEEKLY_SCOPE),true);
  for(const change of [{unit:'1 л'},{name:c.name+' иной'},{physicalStoreId:'shop-1'},{priceScope:'exact-store'},{sourceUrl:'https://example.org/'}])assert.equal(validPyatWeeklySource({...c,...change},PYAT_WEEKLY_SCOPE),false);
  assert.equal(validPyatWeeklySource(c,{...PYAT_WEEKLY_SCOPE,storeId:'shop-1'}),false);
  assert.equal(validPyatSnapshot({...snapshot(),physicalStoreAddress:'Москва, дом'}),false);
});
test('daily source requests respect own and existing publisher blocks, finite cooldown and unknown state',()=>{
  const s=snapshot(),previous={sourceUrl:s.sourceUrl,scope:s.scope,lastAttemptAt:s.observedAt,status:'collected',collectionMode:'automated'},
    host={sourceUrl:'https://mos.proshoper.ru/actions/okej/moskva/',status:'collected'};
  assert.equal(pyatCollectionGate(previous,host,at+20*3600000).due,true);
  assert.equal(pyatCollectionGate(previous,host,at+20*3600000-1).reason,'daily-cooldown');
  assert.equal(pyatCollectionGate({...previous,status:'blocked'},host,at+30*3600000).reason,'source-blocked');
  assert.equal(pyatCollectionGate(previous,{...host,status:'blocked'},at+30*3600000).reason,'source-blocked');
  assert.equal(pyatCollectionGate(previous,undefined,at+30*3600000).due,false);
  assert.equal(pyatCollectionGate({...previous,lastAttemptAt:'invalid'},host,at+30*3600000).due,false);
  assert.equal(pyatCollectionGate({...previous,collectionMode:'manual-html-plus-dom-sample'},host,at+1000).due,true);
});
test('machine verification correlates attempt, snapshot and counters; a manual or blocked snapshot cannot pass as an automated refresh',()=>{
  const s=snapshot(),status={status:'collected',collectionMode:'automated',lastAttemptAt:s.observedAt,observedAt:s.observedAt,
    sourceUrl:s.sourceUrl,scope:s.scope,uniqueProducts:s.products.length};
  assert.equal(verifyPyatRefresh(s,status,at+1000).verified,true);
  for(const change of [{status:'blocked'},{collectionMode:'manual-html-plus-dom-sample'},{uniqueProducts:1},
    {lastAttemptAt:new Date(at+2000).toISOString()},{observedAt:'invalid'}])assert.equal(verifyPyatRefresh(s,{...status,...change},at+1000).verified,false);
  assert.equal(verifyPyatRefresh(s,status,at+86400001).verified,false);
});
test('a persisted pre-source reservation admits only its run/attempt; ambiguous interruption stays paused instead of retrying',()=>{
  const s=snapshot(),previous={sourceUrl:s.sourceUrl,scope:s.scope,lastAttemptAt:s.observedAt,status:'manual-reviewed',collectionMode:'manual-html-plus-dom-sample'},
    host={sourceUrl:'https://mos.proshoper.ru/actions/okej/moskva/',status:'collected'};
  const r=reservePyatAttempt(previous,host,'1234-1',at+1000);assert.equal(r.allowed,true);assert.equal(r.status.sourceRequests,0);
  assert.equal(pyatCollectionGate(r.status,host,at+2000,'1234-1').reason,'reserved-attempt');
  assert.equal(pyatCollectionGate(r.status,host,at+2000,'1234-2').reason,'reservation-unresolved');
  assert.equal(pyatCollectionGate(r.status,host,at+900000,'1234-1').reason,'reservation-unresolved');
  assert.equal(reservePyatAttempt(r.status,host,'9999-1',at+86400000).allowed,false);
  assert.equal(pyatCollectionGate(r.status,{...host,status:'blocked'},at+2000,'1234-1').reason,'source-blocked');
});
