import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{parsePyatCatalogue,PYAT_WEEKLY_SCOPE}from'../src/observations/pyaterochkaPublishedPromotions.mjs';
import{createWeeklyRetailCatalogPort}from'../src/ports/weeklyRetailCatalogPort.mjs';
import{createGuidedShoppingFlow}from'../src/runtime/guidedShoppingFlow.mjs';
import{createShoppingConversation,updateShoppingConversation}from'../src/intelligence/shoppingConversation.mjs';
import{createBasketStore}from'../src/state/basketStore.mjs';
const raw=JSON.parse(await readFile(new URL('./fixtures/pyaterochka-public/raw-20261018.json',import.meta.url),'utf8'));
const snapshot=parsePyatCatalogue(raw),at=Date.parse(raw.observedAt)+1000;
function setup(overrides={}){let calls=0,memory=createShoppingConversation(),clock=at;const basket=createBasketStore({storage:null});
  const port=createWeeklyRetailCatalogPort({now:()=>clock,fetchImpl:async()=>{calls++;return Response.json(snapshot);}});
  const flow=createGuidedShoppingFlow({basket,now:()=>clock,getMemory:()=>memory,
    updateMemory:d=>{memory=updateShoppingConversation(memory,d).state;return true;},
    getContext:()=>({retailerId:'globus',storeId:'globus-store-5014',storeName:'Глобус Пушкино'}),
    getRetailContexts:ids=>ids.includes('pyaterochka')?[PYAT_WEEKLY_SCOPE]:[],searchCatalog:(q,o)=>port.search(q,o),...overrides});
  return{basket,flow,calls:()=>calls,setNow:value=>{clock=value;}};}
test('explicit city selection builds three grocery families from six exact packs, shares one static read and confirms only after review',async()=>{
  const{flow,basket,calls}=setup();flow.start('Собери недорогую корзину на неделю для троих в Пятёрочке',[]);
  await flow.handle('Ограничений нет');const m=flow.getState().presentation.guidedShopping;
  assert.equal(m.people,3);assert.equal(m.days,7);assert.equal(m.quote.lines.length,16);assert.equal(m.quote.basket.length,3);
  assert.equal(calls(),1);assert.equal(m.quote.complete,false);assert.equal(m.quote.winner,null);assert.equal(basket.getSnapshot().length,0);
  assert.ok(m.quote.lines.filter(l=>l.card).every(l=>l.card.physicalStoreId===null&&l.card.priceScope==='city-promotion'));
  assert.equal(m.quote.lines.find(l=>l.group.key==='rice').card.sourceProductId,'51936141');
  await flow.handle('Добавить найденное');assert.equal(basket.getSnapshot().length,3);
  assert.ok(basket.getSnapshot().every(p=>p.id.startsWith('retail:pyaterochka:pyaterochka-moscow-proshoper:')));
});
test('three catalogue names ask for a smaller selection before any read, then recover without losing household or basket',async()=>{
  const{flow,basket,calls}=setup();flow.start('Собери недорогую корзину на неделю для троих в Магните и О’КЕЙ и Пятёрочке',[]);
  await flow.handle('Ограничений нет');assert.match(flow.getState().presentation.headline,/два каталога/u);assert.equal(calls(),0);
  await flow.handle('Пятёрочка');await flow.handle('Подобрать товары и цены');
  const m=flow.getState().presentation.guidedShopping;assert.equal(m.people,3);assert.equal(m.days,7);assert.equal(m.quote.basket.length,3);
  assert.equal(basket.getSnapshot().length,0);
});
test('an open city promotion draft cannot apply after the source observation passes 24h even while the calendar promotion is still active',async()=>{
  const{flow,basket,setNow}=setup();flow.start('Собери недорогую корзину на неделю для троих в Пятёрочке',[]);
  await flow.handle('Ограничений нет');assert.equal(flow.getState().presentation.guidedShopping.quote.basket.length,3);
  setNow(Date.parse(raw.observedAt)+86400001);await flow.handle('Добавить найденное');
  assert.match(flow.getState().presentation.headline,/нужно обновить/u);assert.equal(basket.getSnapshot().length,0);
});

test('an explicit Pyaterochka plan opens from stores home without selecting a default physical store',async()=>{
  const{flow,basket,calls}=setup({getContext:()=>null,getRetailContextKey:()=> 'weekly-source-1'});
  flow.start('Собери недорогую корзину на неделю для троих в Пятёрочке',[]);
  await flow.handle('Ограничений нет');
  const model=flow.getState().presentation.guidedShopping;
  assert.equal(model.quote.basket.length,3);assert.equal(calls(),1);
  assert.equal(model.quote.complete,false);assert.equal(model.quote.winner,null);
  assert.ok(model.quote.lines.filter(line=>line.card).every(line=>line.card.retailerId==='pyaterochka'
    &&line.card.physicalStoreId===null&&line.card.priceScope==='city-promotion'&&line.card.availability==='unknown'));
  assert.deepEqual(basket.getSnapshot(),[]);
  await flow.handle('Добавить найденное');
  assert.equal(basket.getSnapshot().length,3);
  assert.ok(basket.getSnapshot().every(row=>row.id.startsWith('retail:pyaterochka:pyaterochka-moscow-proshoper:')));
});

test('an unspecified home plan keeps its list and asks for a store without a catalogue read',async()=>{
  let reads=0;
  const{flow,basket,calls}=setup({getContext:()=>null,searchCatalog:async()=>{reads++;return{kind:'catalog',products:[]};}});
  flow.start('Собери недорогую корзину на неделю для троих',[]);
  await flow.handle('Текущий магазин');await flow.handle('Ограничений нет');
  assert.match(flow.getState().presentation.headline,/выберем магазин/u);
  assert.equal(reads,0);assert.equal(calls(),0);assert.deepEqual(basket.getSnapshot(),[]);
  await flow.handle('Добавить найденное');assert.deepEqual(basket.getSnapshot(),[]);
});

for(const change of ['address','source']){
  test(`a late home weekly response cannot publish after the ${change} context changes`,async()=>{
    let selected=null,sourceKey='weekly-source-1',release,requested;
    const held=new Promise(resolve=>{release=resolve;});
    const started=new Promise(resolve=>{requested=resolve;});
    const catalog=createWeeklyRetailCatalogPort({now:()=>at,fetchImpl:async()=>Response.json(snapshot)});
    const{flow,basket}=setup({getContext:()=>selected,getRetailContextKey:()=>sourceKey,
      searchCatalog:async(query,options)=>{requested();await held;return catalog.search(query,options);}});
    flow.start('Собери недорогую корзину на неделю для троих в Пятёрочке',[]);
    const loading=flow.handle('Ограничений нет');await started;
    if(change==='address')selected={retailerId:'globus',storeId:'globus-store-5011'};
    else sourceKey='weekly-source-2';
    release();await loading;
    assert.match(flow.getState().presentation.headline,/Магазин изменился/u);
    assert.equal(flow.getState().presentation.guidedShopping,undefined);
    await flow.handle('Добавить найденное');assert.deepEqual(basket.getSnapshot(),[]);
  });
  test(`a reviewed home weekly draft cannot confirm after the ${change} context changes`,async()=>{
    let selected=null,sourceKey='weekly-source-1';
    const{flow,basket}=setup({getContext:()=>selected,getRetailContextKey:()=>sourceKey});
    flow.start('Собери недорогую корзину на неделю для троих в Пятёрочке',[]);
    await flow.handle('Ограничений нет');assert.equal(flow.getState().presentation.guidedShopping.quote.basket.length,3);
    if(change==='address')selected={retailerId:'globus',storeId:'globus-store-5011'};
    else sourceKey='weekly-source-2';
    await flow.handle('Добавить найденное');
    assert.match(flow.getState().presentation.headline,/Выбран другой магазин/u);
    assert.deepEqual(basket.getSnapshot(),[]);
  });
}
