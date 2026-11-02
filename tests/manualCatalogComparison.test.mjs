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
const {rows}=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/cross-retailer-20261101.json',import.meta.url),'utf8'));
const store=resolveRegisteredMagnitStore({shopCode:'503695'}),now=Date.parse('2026-11-02T08:00:00Z');
const normalized=raw=>normalizeRetailRow({...raw,observed_at:new Date(now).toISOString()},raw.retailer_id==='magnit'?{retailerId:'magnit',store}:'perekrestok');
const chosen=id=>{const card=normalized(rows.find(row=>row.source_product_id===id));assert.ok(card);const product=getReviewedRetailBasketProduct(card);assert.ok(product);return {...product,quantity:1};};
const banana=()=>chosen('9072651501');
const chicken=()=>chosen('d91d7780-ffa9-43d3-8bf3-b9870a9bf791');

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
