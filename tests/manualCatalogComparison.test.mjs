import {sourceScopedRetailListSelection} from '../src/catalog/sourceScopedRetailList.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareManualCatalogComparison} from '../src/runtime/manualCatalogComparison.mjs';
import {normalizeGuidedComparisonRequest,createGuidedComparisonStore} from '../src/state/guidedBasketComparison.mjs';
import {normalizeRetailRow} from '../src/ports/retailCatalogPort.mjs';
import {createWeeklyRetailCatalogPort} from '../src/ports/weeklyRetailCatalogPort.mjs';
import {getReviewedRetailBasketProduct} from '../src/catalog/reviewedRetailBasket.mjs';
import {resolveRegisteredMagnitStore} from '../src/data/registeredMagnitStores.mjs';
import {loadSavedGuidedComparison} from '../src/runtime/savedGuidedComparison.mjs';
import {reviewedCrossSourceCounterpart} from '../src/catalog/reviewedCrossSourcePairs.mjs';
const {rows}=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/cross-retailer-20261101.json',import.meta.url),'utf8'));
const store=resolveRegisteredMagnitStore({shopCode:'503695'}),now=Date.parse('2026-11-02T08:00:00Z');
const normalized=raw=>normalizeRetailRow({...raw,observed_at:new Date(now).toISOString()},raw.retailer_id==='magnit'?{retailerId:'magnit',store}:'perekrestok');
const chosen=id=>{const card=normalized(rows.find(row=>row.source_product_id===id));assert.ok(card);const product=getReviewedRetailBasketProduct(card);assert.ok(product);return {...product,quantity:1};};
const banana=()=>chosen('9072651501');
const chicken=()=>chosen('d91d7780-ffa9-43d3-8bf3-b9870a9bf791');

test('single-store partial intent survives reload, explicit pair promotion and later manual completion',async()=>{
 const basket=[chosen('1000526136')],base=prepareManualCatalogComparison(basket);
 const pending=normalizeGuidedComparisonRequest({...base.request,version:3,scopes:base.request.scopes.slice(0,1),
   unresolvedGroupKeys:['bananas','potatoes','carrots']});assert.ok(pending);
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 createGuidedComparisonStore({storage}).write(pending);
 const restored=createGuidedComparisonStore({storage}).read();
 let reads=0;
 const unconfirmed=await loadSavedGuidedComparison(restored,basket,{catalog:{search(){reads++;}},now:()=>now});
 assert.equal(unconfirmed.kind,'unavailable');assert.equal(reads,0,'a single retained store is not a confirmed pair');
 const promote=items=>prepareManualCatalogComparison(items,{pinnedMagnitStoreId:restored.scopes[0].storeId,unresolvedGroupKeys:restored.unresolvedGroupKeys});
 const pair=promote(basket);assert.equal(pair.kind,'ready');assert.equal(pair.request.version,2);assert.equal(pair.pending,3);
 createGuidedComparisonStore({storage}).write(pair.request);
 const again=createGuidedComparisonStore({storage}).read();assert.deepEqual(again.unresolvedGroupKeys,restored.unresolvedGroupKeys);
 const filled=promote([...basket,banana()]);assert.equal(filled.pending,2);assert.deepEqual(filled.request.unresolvedGroupKeys,['potatoes','carrots']);
 for(const invalid of [['invented'],['potatoes','potatoes'],null])assert.equal(prepareManualCatalogComparison(basket,{unresolvedGroupKeys:invalid}).kind,'needs_review');
});

test('manual selection proposes the exact Magnit address and explicit delivery alternative without AI',()=>{
 const basket=[banana(),chicken()],result=prepareManualCatalogComparison(basket);assert.equal(result.kind,'ready');
 assert.equal(result.request.version,2);assert.equal(result.request.bindings.length,2);assert.equal(result.request.bindings[1].allowPoultryCuts,false);
 assert.deepEqual(result.request.scopes,[{retailerId:'magnit',storeId:'magnit-503695'},{retailerId:'perekrestok',storeId:'perekrestok-yandex-3186917'}]);
 assert.equal(JSON.stringify(result.request).includes('priceMinor'),false);assert.match(result.names[0],/Балашиха/u);
 assert.equal(prepareManualCatalogComparison([chicken()]).kind,'choose_magnit');
 assert.equal(prepareManualCatalogComparison([chicken()],{magnitStoreId:'magnit-503695'}).kind,'ready');
 assert.equal(prepareManualCatalogComparison([chicken()],{magnitStoreId:'magnit-999999999'}).kind,'choose_magnit');
});
test('unknown, changed and mixed-address references remain reviewable instead of being silently dropped',()=>{
 const b=banana();
 for(const item of [{id:'unknown',name:'Моя еда',unit:'1 уп',quantity:1},{...b,name:'Яблоки'}, {...b,quantity:0}]){
  const result=prepareManualCatalogComparison([b,item]);assert.equal(result.kind,'needs_review');assert.ok(result.issues.length);
 }
 const other={...b,id:b.id.replace('503695','777885')};assert.equal(prepareManualCatalogComparison([b,other]).kind,'needs_review');
 assert.equal(prepareManualCatalogComparison([b],{pinnedMagnitStoreId:'magnit-777885'}).kind,'needs_review');
 assert.equal(prepareManualCatalogComparison([]),null);
 // Shared historical identities alone do not steal the independent METRO/beta flow.
 assert.equal(prepareManualCatalogComparison([{id:'milk-25-900',name:'Молоко Простоквашино пастеризованное 2,5%',unit:'930 мл',quantity:1}],{magnitStoreId:'magnit-503695'}),null);
});
test('multiple manually chosen products of one family remain separate references with bounded v2 persistence',async()=>{
 const basket=[chosen('1000526136'),{...chosen('1000526137'),quantity:2}],result=prepareManualCatalogComparison(basket);
 assert.equal(result.kind,'ready');assert.deepEqual(result.request.bindings.map(b=>b.groupKey),['pasta','pasta']);
 assert.equal(normalizeGuidedComparisonRequest({...result.request,version:1}),null);
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 createGuidedComparisonStore({storage}).write(result.request);assert.deepEqual(createGuidedComparisonStore({storage}).read(),result.request);
 const reads=[],makeClient=options=>{
  const products=rows.filter(row=>row.retailer_id===options.retailerId&&row.store_id===(options.retailerId==='magnit'?'magnit-503695':'perekrestok-yandex-3186917')).map(normalized);
  return {search:async q=>{reads.push([options.retailerId,q]);return{kind:'catalog',products:products.filter(p=>p.name.toLowerCase().includes(q))};},
    bySourceProductIds:async ids=>{reads.push([options.retailerId,'ids']);return{kind:'catalog',products:products.filter(p=>ids.includes(p.sourceProductId))};}};
 };
 const catalog=createWeeklyRetailCatalogPort({createMagnitClient:makeClient});
 const compared=await loadSavedGuidedComparison(result.request,basket,{catalog,now:()=>now});
 assert.equal(compared.kind,'catalog_comparison');assert.equal(compared.drafts.length,2);
 assert.equal(compared.drafts[0].rows.length,2);assert.equal(compared.drafts[0].rows[0].quantity,1);assert.equal(compared.drafts[0].rows[1].quantity,2);
 assert.equal(compared.quotes[0].complete,true);assert.equal(compared.quotes[1].complete,true);
 assert.equal(reads.filter(([id,query])=>id==='magnit'&&query!=='ids').length,1,'same query is fetched once for two lines');
 assert.equal(reads.filter(([id,query])=>id==='magnit'&&query==='ids').length,1,'both exact anchors use one bounded ID read');
 const before=JSON.stringify(basket);await loadSavedGuidedComparison(result.request,basket,{catalog:{search:async()=>({kind:'unavailable'})},now:()=>now});assert.equal(JSON.stringify(basket),before);
 const oversized={...result.request,bindings:Array.from({length:65},(_,i)=>({...result.request.bindings[0],productId:'item'+i}))};assert.equal(normalizeGuidedComparisonRequest(oversized),null);
});

test('an older unreviewed source card keeps the independent need flow until a reviewed pair opts in',()=>{
 const old={id:'retail:magnit:magnit-777312:apple-fixture',name:'Яблоки проверенные',unit:'1 кг',quantity:1};
 assert.equal(prepareManualCatalogComparison([old]),null);
 assert.equal(prepareManualCatalogComparison([old],{magnitStoreId:'magnit-503695'}),null);
 assert.equal(prepareManualCatalogComparison([banana(),old]).kind,'needs_review');
 assert.equal(prepareManualCatalogComparison([old],{pinnedMagnitStoreId:'magnit-503695'}).kind,'needs_review');
 const changed={...banana(),name:'Другой продукт'};
 assert.equal(prepareManualCatalogComparison([changed]).kind,'needs_review');
});

import {PEREKRESTOK_WEEKLY_SCOPE,weeklyMagnitCard} from '../src/ports/weeklyRetailCatalogPort.mjs';
test('an explicitly chosen SKU remains anchored when it is outside the generic search results',async()=>{
 const item=chosen('1000526136'),basket=[{...item,quantity:3}],request=prepareManualCatalogComparison(basket).request;
 const source=weeklyMagnitCard(normalized(rows.find(row=>row.source_product_id==='1000526136')));
 const port=createWeeklyRetailCatalogPort({createMagnitClient:()=>({bySourceProductIds:async ids=>({kind:'catalog',products:rows.filter(r=>r.retailer_id==='perekrestok'&&ids.includes(r.source_product_id)).map(normalized)})})});
 let exactReads=0;
 const result=await loadSavedGuidedComparison(request,basket,{now:()=>now,catalog:{
  bySourceProductIds:async(ids,{scope})=>{exactReads++;return {kind:'catalog',products:scope.retailerId==='magnit'&&ids.includes(source.sourceProductId)?[source]:[]};},
  search:async(query,{scope})=>scope.retailerId==='magnit'?{kind:'catalog',products:[]}:port.search(query,{scope})
 }});
 assert.equal(exactReads,1);assert.equal(result.quotes[0].complete,true);assert.equal(result.quotes[1].complete,true);
 assert.equal(result.drafts[0].rows[0].card.id,item.id);assert.equal(result.drafts[0].rows[0].quantity,3);
 assert.equal(basket[0].quantity,3);
});
test('fillet lookup reaches reviewed delivery fillets without substituting drumsticks',async()=>{
 const port=createWeeklyRetailCatalogPort({createMagnitClient:()=>({bySourceProductIds:async ids=>({kind:'catalog',products:rows.filter(r=>r.retailer_id==='perekrestok'&&ids.includes(r.source_product_id)).map(normalized)})})});
 const result=await port.search('филе',{scope:PEREKRESTOK_WEEKLY_SCOPE});assert.equal(result.kind,'catalog');
 assert.ok(result.products.length);assert.ok(result.products.every(p=>/филе/iu.test(p.name)));assert.ok(result.products.every(p=>!/голень/iu.test(p.name)));
 assert.equal((await port.bySourceProductIds(['unsafe,id'],{scope:PEREKRESTOK_WEEKLY_SCOPE})).kind,'unavailable');
 assert.equal((await port.bySourceProductIds(['1000526136'],{scope:{retailerId:'magnit',storeId:'magnit-999999999'}})).kind,'unavailable');
});

test('an exact reviewed sliced loaf is a manual bread request; confectionery bars are not bread',()=>{
 const loaf={id:'retail:magnit:magnit-503695:1000255540',name:'Батон нарезной Магнит 400г',unit:'400 г',quantity:1};
 const prepared=prepareManualCatalogComparison([loaf]);assert.equal(prepared.kind,'ready');assert.equal(prepared.request.bindings[0].groupKey,'bread');
 const {issues}=prepareManualCatalogComparison([loaf,{id:'retail:magnit:magnit-503695:unknown',name:'Батончик шоколадный 50г',unit:'50 г',quantity:1}]);assert.equal(issues.length,1);
});


test('manual source milk retains its exact store even when the pack also has a legacy canonical identity',()=>{
 const card=normalized(rows.find(r=>r.retailer_id==='magnit'&&r.source_product_id==='1899800733'));
 const canonical=getReviewedRetailBasketProduct(card);assert.equal(canonical.id,'milk-25-900');
 const source=sourceScopedRetailListSelection(card).product;const item={...source,quantity:2};
 const prepared=prepareManualCatalogComparison([item]);assert.equal(prepared.kind,'ready');
 assert.equal(prepared.request.scopes[0].storeId,'magnit-503695');
 assert.equal(prepared.request.bindings[0].sourceProductId,'1899800733');
 assert.equal(prepared.request.bindings[0].productId,'retail:magnit:magnit-503695:1899800733');
 assert.doesNotMatch(JSON.stringify(prepared.request),/priceMinor|observedAt|availability/);
 assert.equal(prepareManualCatalogComparison([{...canonical,quantity:2}],{magnitStoreId:'magnit-503695'}),null);
 const unknown={id:'unknown',name:'Моя еда',unit:'1 уп',quantity:1};
 const partial=prepareManualCatalogComparison([item,unknown]);assert.equal(partial.kind,'needs_review');
 assert.match(partial.names[0],/Балашиха/u);assert.equal(partial.request,undefined);assert.equal(partial.issues[0],unknown);
});


test('a source-scoped milk anchor is quoted rather than lost to its legacy canonical alias',async()=>{
 const fixture=normalized(rows.find(r=>r.retailer_id==='magnit'&&r.source_product_id==='1899800733'));
 const item={...sourceScopedRetailListSelection(fixture).product,quantity:2};
 const request=prepareManualCatalogComparison([item]).request;
 const cards=scope=>rows.filter(r=>r.retailer_id===scope.retailerId&&r.store_id===scope.storeId).map(normalized).map(weeklyMagnitCard);
 const catalog={bySourceProductIds:async(ids,{scope})=>({kind:'catalog',products:cards(scope).filter(p=>ids.includes(p.sourceProductId))}),
 search:async(q,{scope})=>({kind:'catalog',products:cards(scope).filter(p=>p.name.toLowerCase().includes(q))})};
 const result=await loadSavedGuidedComparison(request,[item],{catalog,now:()=>now});
 assert.equal(result.quotes[0].complete,true);assert.equal(result.quotes[1].complete,true);
 assert.equal(result.drafts[0].rows[0].card.id,item.id);assert.equal(result.drafts[0].rows[0].quantity,2);
 assert.equal(result.drafts[0].rows[0].quantityReview,false);
});

test('reviewed same-pack oats counterpart wins discovery without carrying a price claim',async()=>{
 const perekSource='https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w';
 const perekId='fb3574cb-eba6-47a1-9932-30da895354fb',magnitId='1349400001';
 assert.equal(reviewedCrossSourceCounterpart({retailerId:'perekrestok',sourceProductId:perekId},'magnit'),magnitId);
 assert.equal(reviewedCrossSourceCounterpart({retailerId:'magnit',sourceProductId:magnitId},'perekrestok'),perekId);
 assert.equal(reviewedCrossSourceCounterpart({retailerId:'perekrestok',sourceProductId:'other'},'magnit'),null);
 const perek=normalizeRetailRow({retailer_id:'perekrestok',store_id:'perekrestok-yandex-3186917',
  store_name:'Перекрёсток · Москва, Большой Овчинниковский пер. 16 · Яндекс Еда',locality_id:'city-moscow',locality_name:'Москва',
  source_product_id:perekId,name:'Хлопья овсяные Ясно Солнышко средний размер No 2 500 г',weight_text:'500 г',price_minor:10000,
  currency:'RUB',price_condition:'yandex-eda-regular',sales_channel:'yandex-eda-delivery',minimum_quantity:null,quantity_semantics:null,
  availability:'unknown',product_url:perekSource,source_url:perekSource,scope_evidence_url:perekSource,scope_binding:'same-source',
  binding_id:'yandex-eda:perekryostok_h5q7w:3186917',location_label:'Москва',observed_at:new Date(now).toISOString()},'perekrestok');
 const magnit=weeklyMagnitCard(normalized(rows.find(row=>row.source_product_id===magnitId)));
 const generic=weeklyMagnitCard(normalized(rows.find(row=>row.source_product_id==='1000146531')));
 const item={...getReviewedRetailBasketProduct(perek),quantity:1};assert.ok(item.id);
 const request=prepareManualCatalogComparison([item],{magnitStoreId:'magnit-503695'}).request;
 const requested=[];
 const run=exactMagnit=>loadSavedGuidedComparison(request,[item],{now:()=>now,catalog:{
  bySourceProductIds:async(ids,{scope})=>{requested.push([scope.retailerId,...ids]);return {kind:'catalog',products:
    scope.retailerId==='magnit'?[exactMagnit].filter(card=>ids.includes(card.sourceProductId)):[perek].filter(card=>ids.includes(card.sourceProductId))};},
  search:async(_query,{scope})=>({kind:'catalog',products:scope.retailerId==='magnit'?[generic]:[]})
 }});
 const fresh=await run(magnit);assert.equal(fresh.kind,'catalog_comparison');
 assert.ok(requested.some(([retailer,id])=>retailer==='magnit'&&id===magnitId),'opposite exact ID is read explicitly');
 assert.equal(fresh.drafts[0].rows[0].card.sourceProductId,magnitId);
 assert.equal(fresh.drafts[0].rows[0].quantity,1);assert.equal(fresh.drafts[1].rows[0].quantity,1);
 assert.equal(fresh.comparison.kind,'fresh');
 const stale=await run({...magnit,observedAt:new Date(now-2*60*60*1000).toISOString()});
 assert.equal(stale.drafts[0].rows[0].card.sourceProductId,magnitId,'fresh generic products cannot impersonate the approved exact pack');
 assert.equal(stale.quotes[0].allRecent,false);assert.equal(stale.comparison.kind,'needs_refresh');
 assert.equal(stale.comparison.lowerStoreId,undefined,'a stale exact pack never creates a winner');
});
