import test from 'node:test';
import assert from 'node:assert/strict';
import { getReviewedRetailBasketIdentity, getReviewedRetailBasketProduct, matchesReviewedRetailBasketIdentity, getReviewedRetailSourceProductIds } from '../src/catalog/reviewedRetailBasket.mjs';
import { normalizeRetailRow } from '../src/ports/retailCatalogPort.mjs';
import { createBasketStore } from '../src/state/basketStore.mjs';
import { PEREKRESTOK_REVIEWED_LIST_CONTEXT, PEREKRESTOK_REVIEWED_LIST_PACKS } from '../src/catalog/perekrestokReviewedList.mjs';

// Independent retained public DB observation, 2026-10-31T18:17:04.801Z.
// Delivery context only; prices below are fixtures, never a current quote.
const source='https://eda.yandex.ru/retail/perekrestok?placeSlug=perekryostok_h5q7w';
const store='perekrestok-yandex-3186917';
const storeName='Перекрёсток · Москва, Большой Овчинниковский пер. 16 · Яндекс Еда';
const packs=[
 ['22f84859-1ad2-481f-9250-c24580363f8c','perekrestok-3186917-petelinka-mince-450g','Фарш Петелинка Премиум из филе грудки охлажденный','450 г',26000,'yandex-eda-promo'],
 ['5c6afaf4-d14f-4cf3-9770-73eaa24da3b8','perekrestok-3186917-maltagliati-pennoni-450g','Макароны Maltagliati Рифленые перья (Pennoni Rigati) 074','450 г',7300,'yandex-eda-regular'],
 ['fb3574cb-eba6-47a1-9932-30da895354fb','perekrestok-3186917-yasno-solnyshko-no2-500g','Хлопья овсяные Ясно Солнышко средний размер No 2','500 г',12000,'yandex-eda-regular'],
 ['22e71f23-4a19-438a-855b-2dcfc480e4ae','perekrestok-3186917-prostokvashino-34-45-930ml','Молоко Простоквашино отборное 3.4 - 4.5%','930 мл',11500,'yandex-eda-promo']
];
function raw(p=packs[0],patch={}){return {retailer_id:'perekrestok',store_id:store,store_name:storeName,locality_id:'city-moscow',locality_name:'Москва',source_product_id:p[0],name:p[2]+' '+p[3],weight_text:p[3],price_minor:p[4],currency:'RUB',price_condition:p[5],sales_channel:'yandex-eda-delivery',minimum_quantity:null,quantity_semantics:null,availability:'unknown',product_url:source,source_url:source,scope_evidence_url:source,scope_binding:'same-source',binding_id:'yandex-eda:perekryostok_h5q7w:3186917',location_label:'Российская Федерация, Москва, Большой Овчинниковский переулок, 16',observed_at:'2026-10-31T18:17:04.801Z',...patch};}

for(const p of packs)test('exact delivery pack becomes a price-free manual identity: '+p[1],()=>{
 const observation=normalizeRetailRow(raw(p),'perekrestok');
 assert.equal(observation.basketProductId,p[1]);
 const identity=getReviewedRetailBasketProduct(observation);
 assert.equal(identity.id,p[1]);assert.equal(identity.name,p[2]);assert.equal(identity.unit,p[3]);
 assert.deepEqual(Object.keys(identity).sort(),['category','id','name','unit']);
 assert.deepEqual(getReviewedRetailBasketIdentity(identity.id),identity);
 assert.equal(matchesReviewedRetailBasketIdentity(identity),true);
 assert.equal(observation.priceMinor,p[4]);assert.equal(observation.observedAt,raw().observed_at);
 assert.equal(observation.sourceUrl,source);assert.equal(observation.storeName,storeName);
 assert.equal(observation.priceCondition,p[5]);assert.equal(observation.availability,'unknown');
 assert.equal(observation.catalogDisplayOnly,true);
 assert.deepEqual(getReviewedRetailSourceProductIds('perekrestok',[identity]),[],'manual identity does not add a comparison-source contract');
});

test('manual exact packs retain independent quantities after a real store reload',()=>{
 let saved=null;const storage={getItem:()=>saved,setItem:(_,v)=>{saved=v;}};
 const basket=createBasketStore({storage});
 for(const p of packs){const identity=getReviewedRetailBasketProduct(normalizeRetailRow(raw(p),'perekrestok'));assert.ok(identity);basket.add(identity);}
 basket.increment(packs[0][1]);basket.setQuantity(packs[1][1],3);basket.decrement(packs[1][1]);
 const before=basket.getSnapshot(),restored=createBasketStore({storage});assert.deepEqual(restored.getSnapshot(),before);
 assert.deepEqual(before.map(x=>x.quantity),[2,2,1,1]);
 assert.ok(before.every(x=>matchesReviewedRetailBasketIdentity(x)));
 assert.ok(before.every(x=>Object.keys(x).sort().join(',')==='id,name,quantity,unit'));
 assert.equal(saved.includes('priceMinor'),false);assert.equal(saved.includes('26000'),false);
 restored.remove(packs[2][1]);assert.equal(createBasketStore({storage}).getSnapshot().length,3);
});

test('different product, pack, milk fat or delivery slug cannot unlock manual addition',()=>{
 const item=normalizeRetailRow(raw(),'perekrestok');
 for(const patch of [{sourceProductId:'other'},{retailerId:'metro'},{name:raw().name.replace('450','400')},{unit:'450 мл'},{unit:'1 кг'},{productUrl:source.replace('h5q7w','other')},{productUrl:source+'&placeSlug=other'},{productUrl:source+'#other'},{productUrl:source.replace('https:','http:')},{sourceUrl:source.replace('h5q7w','other')},{storeName:'Перекрёсток · другой контекст'},{id:'retail:perekrestok:another:'+packs[0][0]}]) assert.equal(getReviewedRetailBasketProduct({...item,...patch}),null,JSON.stringify(patch));
 const milk=normalizeRetailRow(raw(packs[3]),'perekrestok');
 assert.equal(getReviewedRetailBasketProduct({...milk,name:milk.name.replace('3.4 - 4.5%','2.5%')}),null);
 assert.equal(matchesReviewedRetailBasketIdentity({...getReviewedRetailBasketIdentity(packs[3][1]),unit:'1 л'}),false);
 assert.equal(normalizeRetailRow(raw(packs[0],{store_id:'another'}),'perekrestok'),null);
});

test('delivery review freezes exact source context without introducing commercial authority',()=>{
 assert.equal(Object.isFrozen(PEREKRESTOK_REVIEWED_LIST_CONTEXT),true);
 assert.equal(PEREKRESTOK_REVIEWED_LIST_CONTEXT.physicalStoreId,null);
 assert.equal(PEREKRESTOK_REVIEWED_LIST_CONTEXT.salesChannel,'yandex-eda-delivery');
 assert.equal(PEREKRESTOK_REVIEWED_LIST_CONTEXT.sourceUrl,source);
 assert.equal(PEREKRESTOK_REVIEWED_LIST_CONTEXT.evidenceObservedAt,raw().observed_at);
 assert.equal(new Set(PEREKRESTOK_REVIEWED_LIST_PACKS.map(x=>x.sourceProductId)).size,4);
 for(const pack of PEREKRESTOK_REVIEWED_LIST_PACKS){
  assert.equal(Object.isFrozen(pack.identity),true);
  for(const retailer of ['metro','magnit','globus','perekrestok'])assert.deepEqual(getReviewedRetailSourceProductIds(retailer,[pack.identity]),[]);
 }
});

test('supplied contradictory context and URL ambiguity cannot survive the final card guard',()=>{
 const item=normalizeRetailRow(raw(),'perekrestok');
 for(const patch of [{storeId:'another'},{bindingId:'another'},{scopeBinding:'city-public-promo'},{salesChannel:'store'},{priceCondition:'regular'},{productUrl:source.replace('eda.yandex.ru','user:pass@eda.yandex.ru')},{productUrl:source.replace('eda.yandex.ru','eda.yandex.ru:444')},{productUrl:source.replace('eda.yandex.ru','eda.yandex.ru.attacker.example')},{productUrl:source+'&other=1'}])assert.equal(getReviewedRetailBasketProduct({...item,...patch}),null,JSON.stringify(patch));
 const generic=getReviewedRetailBasketIdentity('milk-25-900');
 const delivery=getReviewedRetailBasketIdentity(packs[3][1]);
 assert.notEqual(delivery.id,generic.id);
 assert.equal(matchesReviewedRetailBasketIdentity({...delivery,name:generic.name}),false);
});
