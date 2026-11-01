import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createWeeklyRetailCatalogPort,weeklyMagnitCard,PEREKRESTOK_WEEKLY_SCOPE as delivery} from '../src/ports/weeklyRetailCatalogPort.mjs';
import {normalizeRetailRow} from '../src/ports/retailCatalogPort.mjs';
import {resolveMagnitMoscowStore} from '../src/data/magnitMoscowStores.mjs';
import {createGuidedShoppingFlow} from '../src/runtime/guidedShoppingFlow.mjs';
import {createShoppingConversation,updateShoppingConversation} from '../src/intelligence/shoppingConversation.mjs';
import {weeklyRetailerRequest} from '../src/intelligence/guidedShoppingPlan.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {WEEKLY_PEREKRESTOK_IDENTITIES} from '../src/catalog/weeklyPerekrestokIdentities.mjs';
import {guidedGroupMatches} from '../src/intelligence/guidedShoppingPlan.mjs';
import {compareCatalogDraftAlternatives} from '../src/core/catalogDraft.mjs';

const fixture=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/magnit-groceries-773505.json',import.meta.url),'utf8'));
const store=resolveMagnitMoscowStore({shopCode:'773505'});
const initialNow=Math.max(...fixture.rows.map(r=>Date.parse(r.observed_at)))+1000;
const magnit=fixture.rows.map(row=>weeklyMagnitCard(normalizeRetailRow(row,{retailerId:'magnit',store},{nowMs:initialNow}))).filter(Boolean);
// Synthetic delivery counterparts exercise isolation and flow only, not actual
// pack equivalence, source prices, live coverage or freshness acceptance.
const counterparts=magnit.map((p,i)=>({...p,id:`retail:perekrestok:${delivery.storeId}:test-${i}`,
  retailerId:'perekrestok',sourceProductId:`test-${i}`,sourceUrl:delivery.sourceUrl,productUrl:delivery.sourceUrl,
  priceCondition:'yandex-eda-regular',priceConditionLabel:'Цена доставки Яндекс Еды',storeName:delivery.storeName}));
function setup({products=counterparts,currentRetailer='magnit'}={}){
  let memory=createShoppingConversation(),now=initialNow;
  const basket=createBasketStore({storage:null,eventTarget:null});
  const scope={retailerId:'magnit',storeId:'magnit-773505',storeName:'Магнит · '+store.address};
  const search=(cards,q)=>({kind:'catalog',products:cards.filter(p=>p.name.toLowerCase().includes(q.toLowerCase()))});
  const calls=[];
  const flow=createGuidedShoppingFlow({basket,now:()=>now,getMemory:()=>memory,
    updateMemory:delta=>{memory=updateShoppingConversation(memory,delta).state;return true;},
    getContext:()=>currentRetailer==='magnit'?scope:delivery,getRetailContexts:()=>[scope],
    searchCatalog:async q=>search(magnit,q),deliveryCatalog:{search:async(q,options)=>{calls.push(options.scope);return search(products,q);}}});
  return {flow,basket,calls,setNow:value=>{now=value;}};
}
test('explicit two-network request preserves address and delivery source, and requires confirmation',async()=>{
  assert.deepEqual(weeklyRetailerRequest('Магнит и Перекрёсток'),['magnit','perekrestok']);
  assert.deepEqual(weeklyRetailerRequest('Магнит, без Перекресток'),['magnit']);
  const {flow,basket,calls}=setup();
  flow.start('Собери недорогую корзину на неделю для троих в Магнит и Перекрёсток',[]);
  await flow.handle('Ограничений нет');
  let model=flow.getState().presentation.guidedShopping;
  assert.equal(model.alternatives.length,2);assert.equal(model.people,3);assert.equal(model.days,7);
  assert.ok(calls.length>0&&calls.every(s=>s.storeId===delivery.storeId));
  assert.equal(basket.getSnapshot().length,0);
  await flow.handle('Показать вариант perekrestok');
  model=flow.getState().presentation.guidedShopping;
  assert.equal(model.storeName,delivery.storeName);
  assert.ok(model.quote.lines.every(r=>!r.card||r.card.retailerId==='perekrestok'));
  await flow.handle('Добавить показанное');
  assert.ok(basket.getSnapshot().length>0);
  assert.ok(basket.getSnapshot().every(r=>r.id.startsWith(`retail:perekrestok:${delivery.storeId}:`)));
});
test('stale delivery observations cannot retain fresh flags after comparison or store switch',async()=>{
  const {flow,setNow}=setup();
  flow.start('Собери недорогую корзину на неделю для троих Магнит и Перекрёсток',[]);
  await flow.handle('Ограничений нет');setNow(initialNow+3600001);
  await flow.handle('Сравнить этот список');
  assert.ok(flow.getState().presentation.guidedShopping.alternatives.every(a=>a.allRecent===false));
  await flow.handle('Показать вариант perekrestok');
  assert.equal(flow.getState().presentation.guidedShopping.quote.allRecent,false);
  assert.equal(flow.getState().presentation.guidedShopping.quote.winner,null);
});
test('missing delivery rows stay missing and a non-Magnit context cannot silently choose its default address',async()=>{
  const missing=setup({products:[]});missing.flow.start('Собери недорогую корзину на неделю для троих Магнит и Перекрёсток',[]);
  await missing.flow.handle('Ограничений нет');
  const empty=missing.flow.getState().presentation.guidedShopping.alternatives.find(a=>a.retailerId==='perekrestok');
  assert.equal(empty.found,0);assert.equal(empty.complete,false);assert.equal(empty.knownSubtotalMinor,null);
  const wrong=setup({currentRetailer:'perekrestok'});wrong.flow.start('Собери недорогую корзину на неделю для троих Магнит и Перекрёсток',[]);
  await wrong.flow.handle('Ограничений нет');assert.match(wrong.flow.getState().presentation.headline,/адрес Магнита/u);
  assert.equal(wrong.calls.length,0);
});
test('delivery port admits only its retained context and leaves source timestamps and money untouched',async()=>{
  const seed=WEEKLY_PEREKRESTOK_IDENTITIES.find(p=>p.query==='яйц');
  const card={...counterparts[0],id:`retail:perekrestok:${delivery.storeId}:${seed.sourceProductId}`,sourceProductId:seed.sourceProductId,name:seed.name,unit:seed.sourceUnit};
  let products=[card],now=initialNow;const calls=[];const port=createWeeklyRetailCatalogPort({now:()=>now,createMagnitClient:options=>({bySourceProductIds:async ids=>{
    calls.push({options,ids});return {kind:'catalog',products:products.filter(p=>ids.includes(p.sourceProductId))};}})});
  assert.equal((await port.search('фарш',{scope:{...delivery,storeId:'wrong'}})).kind,'unavailable');assert.equal(calls.length,0);
  const result=await port.search('яйц',{scope:delivery,limit:12});assert.deepEqual(result.products,[{...card,unit:'10 шт.'}]);
  assert.equal(calls[0].options.retailerId,'perekrestok');assert.ok(calls[0].ids.includes(seed.sourceProductId));
  for(const change of [{name:seed.name+' другое'},{unit:'450 г'},{productUrl:'https://eda.yandex.ru/retail/perekrestok?placeSlug=other'},{id:card.id.replace(delivery.storeId,'other')}]){
    now+=30001;products=[{...card,...change}];assert.deepEqual((await port.search('яйц',{scope:delivery})).products,[]);
  }
  assert.equal(guidedGroupMatches({key:'pork'},{name:'Свинина Пр!ст Классическая тушеная 325 г'}),false);
});

test('alternative comparison requires equal needs, complete fresh observations, and never claims equal products or fees',()=>{
  const row={group:{key:'mince',dimension:'g',dailyAmount:100},quantity:2,product:{id:'test',name:'Фарш',unit:'400 г'},card:{...counterparts[0],unit:'400 г',priceMinor:10000,observedAt:new Date(initialNow).toISOString()}};
  const drafts=[{scope:{storeId:'a',storeName:'A'},rows:[row]},
    {scope:{storeId:'b',storeName:'B'},rows:[{...row,card:{...row.card,priceMinor:15000}}]}];
  const fresh=compareCatalogDraftAlternatives(drafts,{nowMs:initialNow});
  assert.equal(fresh.kind,'fresh');assert.equal(fresh.differenceMinor,10000);
  assert.equal(fresh.sameProducts,false);assert.equal(fresh.includesFees,false);assert.equal(fresh.availability,'unknown');
  assert.equal(compareCatalogDraftAlternatives(drafts,{nowMs:initialNow+3600001}).kind,'needs_refresh');
  assert.equal(compareCatalogDraftAlternatives([drafts[0],{...drafts[1],rows:[{...row,card:null}]}],{nowMs:initialNow}).kind,'incomplete');
  assert.equal(compareCatalogDraftAlternatives([drafts[0],{...drafts[1],rows:[{...row,group:{...row.group,key:'milk'}}]}],{nowMs:initialNow}).kind,'incompatible');
});

test('delivery family requests share two bounded ID reads, including an outage',async()=>{
  let calls=0,now=initialNow;
  const port=createWeeklyRetailCatalogPort({now:()=>now,createMagnitClient:()=>({bySourceProductIds:async ids=>{
    calls++;assert.ok(ids.length<=40);throw Error('outage');}})});
  const results=await Promise.all(['фарш','яйц','молоко','рис'].map(q=>port.search(q,{scope:delivery})));
  assert.ok(results.every(r=>r.kind==='unavailable'));assert.equal(calls,2);
  await port.search('рис',{scope:delivery});assert.equal(calls,2);
  now+=30001;await port.search('рис',{scope:delivery});assert.equal(calls,4);
});
