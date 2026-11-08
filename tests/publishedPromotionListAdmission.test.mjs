import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRetailCatalogClient} from '../src/ports/retailCatalogPort.mjs';
import {admitPublishedPromotionListCard, publishedPromotionListSelection} from '../src/catalog/publishedPromotionListAdmission.mjs';
import {getReviewedRetailBasketProduct, getReviewedRetailBasketIdentity, getReviewedRetailSourceProductIds} from '../src/catalog/reviewedRetailBasket.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {prepareManualCatalogComparison} from '../src/runtime/manualCatalogComparison.mjs';

const evidence=JSON.parse(await readFile(new URL('./fixtures/pyaterochka-public/reviewed-packs-20261107.json',import.meta.url)));
const NOW=Date.parse(evidence.snapshot.observedAt)+1000;
const fixture=()=>structuredClone(evidence.snapshot);
const browse=(snapshot=fixture(),nowMs=NOW)=>createRetailCatalogClient({retailerId:'pyaterochka',nowMs,
  fetchImpl:async()=>Response.json(snapshot)}).browse({limit:40});

test('twelve reviewed current packages across six categories enter only their source-scoped list',async()=>{
 const result=await browse();assert.equal(result.kind,'catalog');assert.equal(result.products.length,12);
 assert.equal(new Set(result.products.map(c=>c.categoryId)).size,6);
 for(const card of result.products){
  const product=getReviewedRetailBasketProduct(card,{nowMs:NOW});assert.ok(product,card.name);
  assert.equal(product.unit,evidence.reviewedUnits[card.sourceProductId]);assert.equal(product.id,card.id);
  assert.equal(product.name,card.name);assert.equal(card.basketProductId,card.id);assert.equal(card.sourceListOnly,true);
  assert.equal(card.priceScope,'city-promotion');assert.equal(card.physicalStoreId,null);assert.equal(card.physicalStoreAddress,null);
  assert.equal(card.comparisonEligible,false);assert.equal(card.availability,'unknown');
  assert.deepEqual(card.campaign,{from:'2026-11-03',until:'2026-11-09'});
  assert.deepEqual(Object.keys(product).sort(),['category','id','name','unit']);
  assert.ok(Object.isFrozen(card));assert.ok(Object.isFrozen(card.campaign));
  assert.equal(getReviewedRetailBasketIdentity(product.id),null);
 }
});

test('card identity, price, unit, dates, source URL and city scope must agree with the validated source',async()=>{
 const snapshot=fixture();const card=(await browse(snapshot)).products[0];const product=snapshot.products.find(p=>p.sourceProductId===card.sourceProductId);
 const changes={id:'milk-25-900',sourceProductId:'52500000',name:'Other product',unit:'1 кг',priceMinor:1,
  currency:'USD',observedAt:new Date(NOW).toISOString(),validFrom:'2026-11-04',validUntil:'2026-11-10',
  sourceUrl:card.sourceUrl+'x',productUrl:card.productUrl+'?address=1',catalogSourceUrl:'https://mos.proshoper.ru/',
  retailerId:'magnit',storeId:'pyat-physical-1',publisher:'pyaterochka',retailerDisplayName:'Другой магазин',
  storeName:'Пятёрочка · Москва, физический адрес',localityId:'city-kazan',localityName:'Казань',
  priceScope:'store',physicalStoreId:'123',physicalStoreAddress:'Москва, адрес',priceCondition:'regular',
  priceConditionLabel:'Без условий, цена точного магазина',availability:'in_stock',comparisonEligible:true,catalogSource:'other',catalogDisplayOnly:false};
 for(const [field,value] of Object.entries(changes))assert.equal(admitPublishedPromotionListCard({...card,[field]:value},
  {snapshot,product,nowMs:NOW}),null,field);
 assert.equal(admitPublishedPromotionListCard(card,{snapshot,product:{...product},nowMs:NOW}),null,'source row must belong to snapshot');
});

test('unknown or renamed campaign SKUs and ambiguous sizes never inherit a reviewed pack',async()=>{
 for(const mutate of [p=>{p.sourceProductId='52599999';p.productUrl=p.productUrl.replace(/\d+$/u,'52599999');},
   p=>{p.name+=' весовой';},p=>{p.name=p.name.replace('900г','800-900г');},p=>{p.name+=' ассорти';},
   p=>{p.category='frukty-ovoshi-zelen';}]){
  const snapshot=fixture();snapshot.products=[snapshot.products[0]];mutate(snapshot.products[0]);
  const result=await browse(snapshot);assert.equal(result.products.length,1);
  assert.equal(getReviewedRetailBasketProduct(result.products[0],{nowMs:NOW}),null);
 }
 const snapshot=fixture();snapshot.cataloguePeriod={from:'2026-11-02',until:'2026-11-09'};
 for(const p of snapshot.products)p.validFrom='2026-11-02';
 for(const card of (await browse(snapshot)).products)assert.equal(getReviewedRetailBasketProduct(card,{nowMs:NOW}),null);
});

test('invalid source provenance rejects the snapshot rather than minting list admission',async()=>{
 for(const mutate of [s=>{s.physicalStoreId='123';},s=>{s.selectedCity='Казань';},s=>{s.sourceUrl+='?other';},
  s=>{s.products[0].observedAt=new Date(NOW).toISOString();},s=>{s.products[0].priceWithCardMinor=1;}]){
  const snapshot=fixture();mutate(snapshot);assert.equal((await browse(snapshot)).kind,'unavailable');
 }
});

test('already admitted cards expire at the original day or observation boundary',async()=>{
 const card=(await browse()).products[0],observed=Date.parse(card.observedAt);
 assert.ok(publishedPromotionListSelection(card,{nowMs:observed+86400000}));
 assert.equal(publishedPromotionListSelection(card,{nowMs:observed+86400001}),null);
 assert.equal(publishedPromotionListSelection(card,{nowMs:observed-1}),null);
 const snapshot=fixture();snapshot.observedAt='2026-11-09T20:00:00.000Z';
 for(const p of snapshot.products)p.observedAt=snapshot.observedAt;
 const last=(await browse(snapshot,Date.parse(snapshot.observedAt))).products[0];
 assert.ok(publishedPromotionListSelection(last,{nowMs:Date.parse('2026-11-09T20:59:59.999Z')}));
 assert.equal(publishedPromotionListSelection(last,{nowMs:Date.parse('2026-11-09T21:00:00.000Z')}),null);
});

test('JSON clones and saved quantities retain identity but never become a quote or runtime admission',async()=>{
 const card=(await browse()).products[0];const selected=getReviewedRetailBasketProduct(card,{nowMs:NOW});
 for(const copy of [card.id,{id:card.id},{...card},JSON.parse(JSON.stringify(card)),selected])
  assert.equal(getReviewedRetailBasketProduct(copy,{nowMs:NOW}),null);
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 const store=createBasketStore({storage});store.mergeValidatedBasket([{product:selected,quantity:2}]);
 const restored=createBasketStore({storage}).getSnapshot();assert.deepEqual(restored,[{id:selected.id,name:selected.name,unit:selected.unit,quantity:2}]);
 assert.equal(getReviewedRetailBasketProduct(restored[0],{nowMs:NOW}),null);
 for(const retailer of ['pyaterochka','magnit','perekrestok'])assert.deepEqual(getReviewedRetailSourceProductIds(retailer,restored),[]);
 assert.equal(prepareManualCatalogComparison(restored,{pinnedMagnitStoreId:'magnit-502843'}).kind,'needs_review');
});
