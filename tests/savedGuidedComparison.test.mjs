import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSavedGuidedComparison} from '../src/runtime/savedGuidedComparison.mjs';
import {PEREKRESTOK_WEEKLY_SCOPE} from '../src/ports/weeklyRetailCatalogPort.mjs';
const at=Date.parse('2026-11-02T18:40:00Z');
const sourceUrl='https://magnit.ru/product/1000425470-makaronnye_izd_makfa_spagetti_dlinnaya_gruppa_a_450g?shopCode=777885&shopType=1';
const magnit={id:'retail:magnit:magnit-777885:1000425470',sourceProductId:'1000425470',retailerId:'magnit',name:'Макароны Makfa Спагетти No16 Группа А 450г',unit:'450 г',priceMinor:7999,currency:'RUB',availability:'unknown',observedAt:'2026-11-02T18:34:41.757Z',sourceUrl,productUrl:sourceUrl};
const other={id:'retail:perekrestok:perekrestok-yandex-3186917:fixture-pasta',sourceProductId:'fixture-pasta',retailerId:'perekrestok',name:'Макароны тестовые 500 г',unit:'500 г',priceMinor:10000,currency:'RUB',availability:'unknown',observedAt:'2026-11-02T18:35:00Z',sourceUrl:PEREKRESTOK_WEEKLY_SCOPE.sourceUrl,productUrl:PEREKRESTOK_WEEKLY_SCOPE.sourceUrl};
const request={version:1,unresolvedGroupKeys:[],scopes:[{retailerId:'magnit',storeId:'magnit-777885'},{retailerId:'perekrestok',storeId:PEREKRESTOK_WEEKLY_SCOPE.storeId}],bindings:[{productId:magnit.id,sourceProductId:magnit.sourceProductId,groupKey:'pasta',retailerId:'magnit',allowPoultryCuts:false}]};
const basket=q=>[{id:magnit.id,name:magnit.name,unit:magnit.unit,quantity:q}];
const catalog={search:async(q,{scope})=>({kind:'catalog',products:[scope.retailerId==='magnit'?magnit:other]})};

test('reload comparison reads both saved sources and recalculates quantities from current basket packs',async()=>{
 const rows=basket(3),before=JSON.stringify(rows),calls=[];
 const result=await loadSavedGuidedComparison(request,rows,{now:()=>at,catalog:{search:async(q,o)=>{calls.push(o.scope.storeId);return catalog.search(q,o);}}});
 assert.equal(result.kind,'catalog_comparison');assert.equal(result.comparison.kind,'fresh');
 assert.equal(result.drafts[0].rows[0].quantity,3);assert.equal(result.drafts[1].rows[0].quantity,3);
 assert.deepEqual(result.drafts.map(d=>d.rows[0].quantityIntent),[{amount:1350,dimension:'g'},{amount:1350,dimension:'g'}]);
 assert.deepEqual(new Set(calls),new Set(request.scopes.map(s=>s.storeId)));
 assert.equal(JSON.stringify(rows),before);
 const edited=await loadSavedGuidedComparison(request,basket(4),{now:()=>at,catalog});
 assert.equal(edited.drafts[1].rows[0].quantity,4);
 assert.equal(edited.drafts[1].rows[0].quantityIntent.amount,1800);
});

test('unknown manual additions require review before any price read',async()=>{
 let calls=0;const rows=[...basket(2),{id:'new-manual-item',quantity:1}];
 const result=await loadSavedGuidedComparison(request,rows,{catalog:{search(){calls++;}}});
 assert.equal(result.kind,'needs_review');assert.equal(calls,0);assert.equal(rows.length,2);
});

test('expired observations remain dated and cannot yield a fresh cheaper subtotal',async()=>{
 const result=await loadSavedGuidedComparison(request,basket(3),{now:()=>at+7200000,catalog});
 assert.equal(result.comparison.kind,'needs_refresh');
 assert.equal(result.quotes.every(q=>!q.allRecent),true);
});

test('identity/pack drift or wrong address keeps the source unresolved instead of changing an existing basket',async()=>{
 for(const card of [{...magnit,unit:'400 г'},{...magnit,sourceUrl:sourceUrl.replace('777885','503714')},{...magnit,observedAt:'2030-01-01T00:00:00Z'},{...magnit,productUrl:sourceUrl.replace('/1000425470-','/1000191320-')}]){
  const result=await loadSavedGuidedComparison(request,basket(3),{now:()=>at,catalog:{search:async(q,{scope})=>({kind:'catalog',products:[scope.retailerId==='magnit'?card:other]})}});
  assert.notEqual(result.comparison.kind,'fresh');
  assert.equal(result.drafts.every(d=>d.rows[0].quantityReview),true);
 }
});

test('one unavailable source cannot erase the successful source or fabricate its missing price',async()=>{
 const result=await loadSavedGuidedComparison(request,basket(3),{now:()=>at,catalog:{search:async(q,o)=>{if(o.scope.retailerId==='perekrestok')throw Error('503');return catalog.search(q,o);}}});
 assert.equal(result.quotes[0].complete,true);assert.equal(result.quotes[1].knownSubtotalMinor,null);
 assert.equal(result.quotes[1].complete,false);assert.notEqual(result.comparison.kind,'fresh');
});

test('accepted poultry-cut preference survives restoration instead of narrowing silently to fillet',async()=>{
 const context=JSON.parse(JSON.stringify(request));context.bindings[0].groupKey='chicken';context.bindings[0].allowPoultryCuts=true;
 const chicken={...magnit,name:'Филе куриное 450г'};
 const selected=[{id:chicken.id,name:chicken.name,unit:chicken.unit,quantity:3}],queries=[];
 const result=await loadSavedGuidedComparison(context,selected,{now:()=>at,catalog:{search:async(q,{scope})=>{
  queries.push(q);return {kind:'catalog',products:scope.retailerId==='magnit'?[chicken]:[]};
 }}});
 assert.deepEqual(queries,['цыпл','цыпл']);
 assert.equal(result.drafts[0].rows[0].group.allowPoultryCuts,true);
 assert.equal(result.quotes[0].complete,true);
});
