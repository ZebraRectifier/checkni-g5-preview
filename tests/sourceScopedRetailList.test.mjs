import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRetailRow} from '../src/ports/retailCatalogPort.mjs';
import {getReviewedRetailBasketProduct} from '../src/catalog/reviewedRetailBasket.mjs';
import {resolveRegisteredMagnitStore} from '../src/data/registeredMagnitStores.mjs';
const store=resolveRegisteredMagnitStore({shopCode:'777885'});
const url='https://magnit.ru/product/9072651501-banany?shopCode=777885&shopType=1';
function row(overrides={}) {return {retailer_id:'magnit',store_id:'magnit-777885',store_name:'Магнит · '+store.address,
 locality_id:'city-moscow',locality_name:'Москва',source_product_id:'9072651501',name:'Бананы 1кг',weight_text:null,
 price_minor:17999,currency:'RUB',price_condition:'public-online',availability:'unknown',product_url:url,source_url:url,
 observed_at:'2026-11-02T21:51:54.734Z',...overrides};}
test('reviewed weighed Magnit item can be explicitly selected into a scoped list without a canonical alias',()=>{
 const card=normalizeRetailRow(row(),{retailerId:'magnit',store});
 assert.ok(card);assert.equal(card.basketProductId,card.id);
 const product=getReviewedRetailBasketProduct(card);assert.equal(product.id,card.id);assert.match(product.unit,/≈.*1 кг.*весовая/u);
 assert.equal(card.priceMinor,17999);assert.equal(card.observedAt,'2026-11-02T21:51:54.734Z');assert.equal(card.availability,'unknown');
 assert.ok(!('priceMinor' in product));assert.ok(!('availability' in product));
});

import {sourceScopedRetailListSelection} from '../src/catalog/sourceScopedRetailList.mjs';
import {weeklyMagnitCard} from '../src/ports/weeklyRetailCatalogPort.mjs';
import {getReviewedRetailBasketIdentity,getReviewedRetailSourceProductIds} from '../src/catalog/reviewedRetailBasket.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {readFile} from 'node:fs/promises';
const {rows}=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/cross-retailer-20261101.json',import.meta.url),'utf8'));
const banana=()=>normalizeRetailRow(row(),{retailerId:'magnit',store});
test('source-scoped list identity cannot acquire a legacy commercial equivalent',()=>{
 const card=banana(),product=getReviewedRetailBasketProduct(card);
 assert.equal(getReviewedRetailBasketIdentity(product.id),null);
 assert.deepEqual(getReviewedRetailSourceProductIds('magnit',[product]),[]);
 assert.notEqual(product.id,'bananas-1kg');
});
test('explicit list selection persists quantities and approximate weight without storing commercial facts',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const basket=createBasketStore({storage}),product=getReviewedRetailBasketProduct(banana());
 basket.add(product);basket.add(product);
 const snapshot=basket.getSnapshot();assert.equal(snapshot[0].quantity,2);
 assert.deepEqual(createBasketStore({storage}).getSnapshot(),snapshot);
 assert.doesNotMatch(JSON.stringify(snapshot),/priceMinor|observedAt|availability|sourceUrl/);
 assert.match(snapshot[0].unit,/весовая/u);
});
test('card enrichment is idempotent across catalogue and guided views',()=>{
 const card=weeklyMagnitCard(banana());assert.deepEqual(weeklyMagnitCard(card),card);
 const selected=sourceScopedRetailListSelection(card);assert.deepEqual(selected.card,card);
 assert.equal((card.priceConditionLabel.match(/условия карты/g)??[]).length,1);
});
test('changed SKU, title, units, store, source, condition and observation fail closed',()=>{
 const card=banana();
 for(const patch of [
  {id:'bananas-1kg'},{id:card.id.replace('777885','777312')},{sourceProductId:'1000000000'},
  {name:'Бананы 800г'},{unit:'800 г'},{storeId:'magnit-777312'},
  {productUrl:card.productUrl.replace('777885','777312')},
  {sourceUrl:card.sourceUrl.replace('777885','777312')},
  {productUrl:card.productUrl.replace('https:','http:')},
  {sourceUrl:card.sourceUrl.replace('magnit.ru','example.org')},
  {productUrl:card.productUrl+'&shopCode=777885'},{sourceUrl:card.sourceUrl+'#another'},
  {productUrl:card.productUrl+'&unexpected=1'},{productUrl:card.productUrl.replace('shopType=1','shopType=2')},
  {productUrl:card.productUrl.replace('/9072651501-banany','/9072651501-another-pack')},
  {priceMinor:0},{priceMinor:-1},{priceMinor:1.1},{currency:'USD'},
  {availability:'available'},{observedAt:'invalid'},{observedAt:{}},{priceConditionLabel:{}},{observedAt:'2099-01-01T00:00:00Z'},
  {priceCondition:'regular'},{retailerId:'metro'},
 ]) assert.equal(sourceScopedRetailListSelection({...card,...patch}),null,JSON.stringify(patch));
});
test('reviewed delivery portions and fixed packs are addable under the pinned source only',()=>{
 const candidates=rows.filter(row=>row.retailer_id==='perekrestok');let added=0,approx=0;
 for(const raw of candidates){const card=normalizeRetailRow(raw,'perekrestok');assert.ok(card);
  const selection=sourceScopedRetailListSelection(card);if(!selection)continue;added++;
  assert.equal(selection.product.id,card.id);assert.equal(card.basketProductId,getReviewedRetailBasketProduct(card).id);
  assert.equal(card.priceMinor,raw.price_minor);assert.equal(Date.parse(card.observedAt),Date.parse(raw.observed_at));
  if(selection.product.unit.includes('≈'))approx++;
  for(const patch of [{id:card.id.replace('3186917','3186918')},{sourceUrl:card.sourceUrl+'&another=1'},
   {productUrl:'https://eda.yandex.ru/retail/perekrestok'}, {unit:'999 г'}, {priceCondition:'regular'},
   {storeName:'Перекрёсток · другой контекст'},{bindingId:'another'},
   {scopeBinding:'city-public-promo'},{salesChannel:'store'}]) {
   assert.equal(sourceScopedRetailListSelection({...card,...patch}),null,JSON.stringify(patch));
   assert.equal(getReviewedRetailBasketProduct({...card,...patch}),null,JSON.stringify(patch));
  }
 }
 assert.ok(added>=10);assert.ok(approx>=1);
});

import {createWeeklyRetailCatalogPort,PEREKRESTOK_WEEKLY_SCOPE} from '../src/ports/weeklyRetailCatalogPort.mjs';
test('manual enrichment preserves upstream egg weight until the existing guided count gate',async()=>{
 const raw=rows.find(p=>p.retailer_id==='perekrestok'&&/^Яйца/u.test(p.name));assert.ok(raw);
 const card=normalizeRetailRow(raw,'perekrestok');assert.equal(card.unit,raw.weight_text);
 const port=createWeeklyRetailCatalogPort({createMagnitClient:()=>({bySourceProductIds:async ids=>({kind:'catalog',products:ids.includes(raw.source_product_id)?[card]:[]})})});
 const result=await port.search('яйц',{scope:PEREKRESTOK_WEEKLY_SCOPE});
 assert.equal(result.kind,'catalog');assert.equal(result.products.length,1);
 assert.match(result.products[0].unit,/шт/u);assert.equal(result.products[0].priceMinor,raw.price_minor);
});

test('new source egg packs retain exact 20/10 counts and do not alias older ten-packs',async()=>{
 const evidence=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/magnit-eggs-777885-20261102.json',import.meta.url),'utf8'));
 const expected={'1000219622':{unit:'20 шт',count:20},'2047000033':{unit:'10 шт',count:10}};
 for(const retained of evidence.rows){
  const source=row({...retained,retailer_id:'magnit',store_id:evidence.storeId,source_url:retained.product_url});
  const card=normalizeRetailRow(source,{retailerId:'magnit',store}),identity=getReviewedRetailBasketProduct(card),pack=expected[retained.source_product_id];
  assert.ok(identity);assert.equal(identity.id,card.id);assert.equal(identity.unit,pack.unit);
  assert.equal(card.priceMinor,retained.price_minor);assert.equal(Date.parse(card.observedAt),Date.parse(retained.observed_at));
  const {catalogPurchaseUnit}=await import('../src/core/catalogDraft.mjs');assert.equal(catalogPurchaseUnit(weeklyMagnitCard(card)).amount,pack.count);
  assert.equal(getReviewedRetailBasketIdentity(identity.id),null);
 }
});
