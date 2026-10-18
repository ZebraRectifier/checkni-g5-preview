import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{createRetailCatalogClient}from'../src/ports/retailCatalogPort.mjs';
import{createWeeklyRetailCatalogPort}from'../src/ports/weeklyRetailCatalogPort.mjs';
import{resolveRegisteredMagnitStore}from'../src/data/registeredMagnitStores.mjs';
import{MAGNIT_MOSCOW_OBLAST_BINDINGS}from'../src/data/magnitMoscowOblastBindings.mjs';
import{createGuidedShoppingFlow}from'../src/runtime/guidedShoppingFlow.mjs';
import{createShoppingConversation,updateShoppingConversation}from'../src/intelligence/shoppingConversation.mjs';
import{createBasketStore}from'../src/state/basketStore.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/magnit-buckwheat-773804.json',import.meta.url),'utf8'));
const now=Date.parse('2026-10-18T03:30:00Z'),store=resolveRegisteredMagnitStore({shopCode:'773804'});

test('agreed current Magnit scope without embedded store reaches real port/identity/Core and retains the 800g pack',async()=>{
 const queries=[],created=[];const makeClient=options=>{created.push(options.store);return createRetailCatalogClient({...options,nowMs:now,fetchImpl:async url=>{
   const p=new URL(url).searchParams;queries.push(p);const q=(p.get('name')??'').replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ').toLowerCase();
   return new Response(JSON.stringify(fixture.rows.filter(r=>'eq.'+r.store_id===p.get('store_id')&&r.name.toLowerCase().includes(q))));}});};
 const scope=createRetailCatalogClient({retailerId:'magnit',store}).definition;assert.equal(scope.store,undefined);
 const port=createWeeklyRetailCatalogPort({createMagnitClient:makeClient,now:()=>now});let memory=createShoppingConversation();const basket=createBasketStore({storage:null});
 const flow=createGuidedShoppingFlow({basket,now:()=>now,getMemory:()=>memory,updateMemory:d=>{memory=updateShoppingConversation(memory,d).state;return true;},
   getContext:()=>scope,hasAgreedStore:()=>true,searchCatalog:(q,o)=>port.search(q,o)});
 flow.start('Собери недорогую корзину на неделю для троих',[]);await flow.handle('Ограничений нет');
 const quote=flow.getState().presentation.guidedShopping.quote,grain=quote.lines.find(l=>l.group.key==='buckwheat');
 assert.equal(quote.lines.length,13);assert.equal(quote.basket.length,1);assert.equal(grain.addable,true);assert.equal(grain.card.unit,'800 г');
 assert.equal(grain.card.priceMinor,3999);assert.equal(grain.quantity,2);assert.equal(grain.lineTotalMinor,7998);
 assert.equal(Date.parse(grain.card.observedAt),Date.parse(fixture.rows[0].observed_at));assert.equal(quote.complete,false);assert.equal(quote.winner,null);
 assert.equal(basket.getSnapshot().length,0);assert.ok(queries.length>0);assert.ok(queries.every(p=>p.get('store_id')==='eq.magnit-773804'));
 assert.ok(created.every(s=>s.shopCode==='773804'&&s.address===store.address));await flow.handle('Добавить найденное');
 assert.equal(basket.getSnapshot().length,1);assert.equal(basket.getSnapshot()[0].quantity,2);
});

test('an explicit mismatched store or an unknown current store cannot redirect the weekly source request',async()=>{
 let requests=0;const port=createWeeklyRetailCatalogPort({createMagnitClient:()=>{requests++;return{search:async()=>({kind:'catalog',products:[]})};}});
 const scope=createRetailCatalogClient({retailerId:'magnit',store}).definition;
 for(const bad of [{...scope,store:resolveRegisteredMagnitStore({shopCode:'773505'})},{...scope,store:null},{...scope,storeId:'magnit-999999'}]){
   assert.equal((await port.search('греч',{scope:bad})).kind,'unavailable');
 }
 assert.equal(requests,0);
});

test('bare Moscow oblast context resolves its own registered store while the named-network route stays compatible',async()=>{
 const oblast=MAGNIT_MOSCOW_OBLAST_BINDINGS.find(s=>s.shopCode),scope=createRetailCatalogClient({retailerId:'magnit',store:oblast}).definition,seen=[];
 const port=createWeeklyRetailCatalogPort({createMagnitClient:({store})=>{seen.push(store.shopCode);return{search:async()=>({kind:'catalog',products:[]})};}});
 assert.equal((await port.search('рис',{scope})).kind,'catalog');
 assert.equal((await port.search('рис',{scope:{...scope,store:oblast}})).kind,'catalog');assert.deepEqual(seen,[oblast.shopCode,oblast.shopCode]);
});
