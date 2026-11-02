import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGuidedComparisonRequest,createGuidedComparisonRequest,createGuidedComparisonStore,guidedComparisonForBasket,GUIDED_BASKET_COMPARISON_KEY} from '../src/state/guidedBasketComparison.mjs';
import {catalogRequestForQuantity} from '../src/core/catalogDraft.mjs';
const request=()=>({version:1,unresolvedGroupKeys:[],scopes:[{retailerId:'magnit',storeId:'magnit-777885'},{retailerId:'perekrestok',storeId:'perekrestok-yandex-3186917'}],
  bindings:[{productId:'selected-milk',sourceProductId:'milk-id',groupKey:'milk',retailerId:'perekrestok',allowPoultryCuts:false}]});
const storage=()=>{const data=new Map();return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};

test('comparison store restores only selected references after reload; quantity changes use current basket',()=>{
 const disk=storage(),first=createGuidedComparisonStore({storage:disk});
 assert.deepEqual(first.write(request()),{ok:true,saved:true});
 const reloaded=createGuidedComparisonStore({storage:disk});
 const state=reloaded.forBasket([{id:'selected-milk',quantity:7}]);
 assert.equal(state.kind,'ready');assert.equal(state.bindings[0].quantity,7);
 assert.deepEqual(state.request.scopes,request().scopes);
 const raw=disk.getItem(GUIDED_BASKET_COMPARISON_KEY);
 for(const forbidden of ['priceMinor','observedAt','availability','sourceUrl','name','unit'])assert.equal(raw.includes(forbidden),false,forbidden);
});

test('new manual items require review and never disappear from a supposedly complete comparison',()=>{
 const basket=[{id:'selected-milk',quantity:2},{id:'manual-product',quantity:1}];
 const result=guidedComparisonForBasket(request(),basket);
 assert.equal(result.kind,'needs_review');assert.deepEqual(result.missingProductIds,['manual-product']);
 assert.equal(basket.length,2);
 assert.equal(guidedComparisonForBasket(request(),[]).kind,'none');
});

test('corrupt requests cannot inject prices, stock, URLs, unknown stores, groups or duplicate products',()=>{
 for(const bad of [
 {...request(),priceMinor:1},
 {...request(),scopes:[{retailerId:'magnit',storeId:'magnit-999999999999'},{retailerId:'perekrestok',storeId:'foreign'}]},
 {...request(),bindings:[{...request().bindings[0],sourceUrl:'https://example.org'}]},
 {...request(),bindings:[{...request().bindings[0],groupKey:'invented'}]},
 {...request(),bindings:[request().bindings[0],request().bindings[0]]}
 ])assert.equal(normalizeGuidedComparisonRequest(bad),null);
 const disk=storage();disk.setItem(GUIDED_BASKET_COMPARISON_KEY,'{bad');
 assert.equal(createGuidedComparisonStore({storage:disk}).read(),null);
});

test('storage failure preserves manual operation and reports that context will not survive reload',()=>{
 const broken={getItem(){throw Error('denied')},setItem(){throw Error('quota')},removeItem(){throw Error('denied')}};
 const store=createGuidedComparisonStore({storage:broken});
 assert.deepEqual(store.write(request()),{ok:true,saved:false});
 assert.equal(store.forBasket([{id:'selected-milk',quantity:2}]).kind,'ready');
 store.clear();assert.equal(store.read(),null);
});

test('a fresh source unit converts current pack counts to a request without using a stored price',()=>{
 assert.deepEqual(catalogRequestForQuantity({unit:'450 г'},7),{amount:3150,dimension:'g',approximate:false});
 assert.deepEqual(catalogRequestForQuantity({unit:'1 кг',catalogPurchaseBasis:'weighed-portion'},2),{amount:2000,dimension:'g',approximate:true});
 assert.equal(catalogRequestForQuantity({unit:'упаковка'},2),null);
 assert.equal(catalogRequestForQuantity({unit:'450 г'},100),null);
 assert.equal(catalogRequestForQuantity({unit:'450 г'},1.5),null);
});

test('a failed replacement or clear cannot resurrect the older stored context in this tab',()=>{
 const disk=storage(),store=createGuidedComparisonStore({storage:disk});
 store.write(request());
 const originalSet=disk.setItem;
 disk.setItem=()=>{throw Error('quota')};
 const next=request();next.bindings[0].sourceProductId='new-source-id';
 assert.equal(store.write(next).saved,false);
 assert.equal(store.read().bindings[0].sourceProductId,'new-source-id');
 disk.removeItem=()=>{throw Error('denied')};store.clear();
 assert.equal(store.read(),null);
 disk.setItem=originalSet;
});

test('cross-tab deletion and corrupted persisted data invalidate the prior cached request',()=>{
 const disk=storage(),store=createGuidedComparisonStore({storage:disk});
 store.write(request());assert.ok(store.read());
 disk.removeItem(GUIDED_BASKET_COMPARISON_KEY);assert.equal(store.read(),null);
 store.write(request());disk.setItem(GUIDED_BASKET_COMPARISON_KEY,'{bad');
 assert.equal(store.read(),null);
});

test('partial confirmation keeps unresolved original groups while persisting only admitted product bindings',()=>{
 const model={drafts:request().scopes.map(scope=>({scope})),rows:[
  {addable:true,group:{key:'milk'},product:{id:'selected-milk'},card:{sourceProductId:'milk-id',retailerId:'perekrestok',priceMinor:1}},
  {addable:false,group:{key:'eggs'},product:null,card:null}
 ]};
 const saved=createGuidedComparisonRequest(model);
 assert.deepEqual(saved.unresolvedGroupKeys,['eggs']);
 assert.equal(saved.bindings.length,1);
 assert.equal(JSON.stringify(saved).includes('priceMinor'),false);
 assert.deepEqual(normalizeGuidedComparisonRequest(JSON.parse(JSON.stringify(saved))),saved);
});
