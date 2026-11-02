import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGuidedShoppingFlow} from '../src/runtime/guidedShoppingFlow.mjs';
import {createShoppingConversation,updateShoppingConversation} from '../src/intelligence/shoppingConversation.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {weeklyMagnitCard,PEREKRESTOK_WEEKLY_SCOPE as delivery} from '../src/ports/weeklyRetailCatalogPort.mjs';
import {normalizeRetailRow} from '../src/ports/retailCatalogPort.mjs';
import {resolveMagnitMoscowStore} from '../src/data/magnitMoscowStores.mjs';
import {catalogPurchaseUnit} from '../src/core/catalogDraft.mjs';

const fixture=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/magnit-groceries-773505.json',import.meta.url),'utf8'));
const now=Math.max(...fixture.rows.map(row=>Date.parse(row.observed_at)))+1000;
const store=resolveMagnitMoscowStore({shopCode:'773505'});
const cards=fixture.rows.map(row=>weeklyMagnitCard(normalizeRetailRow(row,{retailerId:'magnit',store},{nowMs:now}))).filter(Boolean);
// Synthetic cross-network cards prove context handling, not live prices or SKU equivalence.
function setup({differentPack=false,unknownPack=false,outage=false,partialDelivery=false}={}) {
  let memory=createShoppingConversation(),at=now,magnitOffline=false,magnitCalls=0;
  const scope={retailerId:'magnit',storeId:'magnit-773505',storeName:'Магнит · '+store.address};
  const basket=createBasketStore({storage:null,eventTarget:null});
  const sourceCards=cards.map(card=>differentPack&&/греч/u.test(card.name.toLowerCase())?{...card,unit:'800 г'}:card);
  const counterparts=sourceCards.map((card,i)=>({...card,id:`retail:perekrestok:${delivery.storeId}:test-${i}`,
    retailerId:'perekrestok',sourceProductId:`test-${i}`,sourceUrl:delivery.sourceUrl,productUrl:delivery.sourceUrl,
    priceCondition:'yandex-eda-regular',storeName:delivery.storeName,
    ...(differentPack&&/греч/u.test(card.name.toLowerCase())?{unit:`${Number(differentPack)||400} г`}:{}),
    ...(unknownPack&&/греч/u.test(card.name.toLowerCase())?{name:'Крупа гречневая',unit:'упаковка',catalogPurchaseBasis:'piece'}:{})}));
  const search=(rows,q)=>({kind:'catalog',products:rows.filter(row=>row.name.toLowerCase().includes(q.toLowerCase()))});
  const flow=createGuidedShoppingFlow({basket,now:()=>at,getMemory:()=>memory,getContext:()=>scope,
    updateMemory:delta=>{memory=updateShoppingConversation(memory,delta).state;return true;},
    getRetailContexts:()=>[scope],searchCatalog:async q=>{magnitCalls++;if(magnitOffline)throw Error('offline');return search(sourceCards,q);},
    deliveryCatalog:{search:async q=>{if(outage)throw Error('offline');return search(partialDelivery
      ?counterparts.filter(card=>/молок/u.test(card.name.toLowerCase())):counterparts,q);}}});
  return {flow,basket,setNow:value=>{at=value;},getMemory:()=>memory,
    setMagnitOffline:()=>{magnitOffline=true;},magnitCalls:()=>magnitCalls};
}
const model=flow=>flow.getState().presentation.guidedShopping;
async function prepare(flow,networks='Магнит и Перекрёсток',{balanced=false}={}) {
  flow.start(`Собери ${balanced?'':'недорогую '}корзину на неделю для троих ${networks}`,[]);
  if(balanced)await flow.handle('Без лимита');
  await flow.handle('Без мяса');
  if(balanced)await flow.handle('Подобрать товары и цены');
  await flow.handle('а в Магните?');
  const index=model(flow).quote.lines.findIndex(row=>row.group.key==='buckwheat');
  assert.ok(index>=0);
  await flow.handle(`Количество ${index+1}: 9`);
  return index;
}

test('natural retailer follow-ups preserve household, exclusions, explicit quantities and require confirmation',async()=>{
  const {flow,basket}=setup();await prepare(flow);
  assert.notEqual(await flow.handle('сравни с другим магазином'),null);
  await flow.handle('а в Перекрёстке?');
  let result=model(flow);assert.equal(result.people,3);assert.equal(result.days,7);
  assert.equal(result.storeName,delivery.storeName);
  assert.equal(result.quote.lines.find(row=>row.group.key==='buckwheat').quantity,9);
  assert.ok(result.quote.lines.every(row=>!['mince','chicken','pork'].includes(row.group.key)));
  assert.deepEqual(basket.getSnapshot(),[]);
  await flow.handle('а в Магните?');
  assert.match(model(flow).storeName,/Магнит/u);
  assert.equal(model(flow).quote.lines.find(row=>row.group.key==='buckwheat').quantity,9);
  await flow.handle('Добавить показанное');
  assert.equal(basket.getSnapshot().find(row=>/греч/u.test(row.name.toLowerCase())).quantity,9);
});

test('a new second catalogue preserves the existing selected needs rather than adding defaults',async()=>{
  const {flow}=setup();await prepare(flow,'Магнит');
  const groups=model(flow).quote.lines.map(row=>row.group.key);
  await flow.handle('а в Перекрёстке?');
  assert.equal(model(flow).storeName,delivery.storeName);
  assert.deepEqual(model(flow).quote.lines.map(row=>row.group.key),groups);
  assert.equal(model(flow).quote.lines.find(row=>row.group.key==='buckwheat').quantity,9);
});

for(const pack of [400,900,1000])test(`exact ${pack}g packs use Core conversion for the requested 9x800g`,async()=>{
  const {flow,basket}=setup({differentPack:pack});await prepare(flow);
  const original=model(flow).quote.lines.find(row=>row.group.key==='buckwheat');
  const requested=catalogPurchaseUnit(original.card).amount*9;
  await flow.handle('а в Перекрёстке?');
  const row=model(flow).quote.lines.find(row=>row.group.key==='buckwheat');
  assert.equal(row.quantityReview,false);assert.equal(row.quantity,Math.ceil(requested/pack));
  assert.deepEqual(row.quantityIntent,{dimension:'g',amount:requested});
  assert.deepEqual(basket.getSnapshot(),[]);
  await flow.handle('а в Магните?');
  assert.equal(model(flow).quote.lines.find(row=>row.group.key==='buckwheat').quantity,9);
});

test('unknown packs cannot inherit a different SKU count or enter a comparable draft',async()=>{
  const {flow,basket}=setup({unknownPack:true});await prepare(flow,'Магнит и Перекрёсток',{balanced:true});
  await flow.handle('а в Перекрёстке?');
  const row=model(flow).quote.lines.find(row=>row.group.key==='buckwheat');
  assert.equal(row.quantityReview,true);assert.notEqual(row.quantity,9);
  assert.equal(model(flow).draftComparison.kind,'incompatible');
  assert.match(flow.getState().presentation.message,/фасовки отличаются/u);
  await flow.handle('Добавить показанное');assert.deepEqual(basket.getSnapshot(),[]);
  await flow.handle('а в Магните?');
  assert.equal(model(flow).quote.lines.find(row=>row.group.key==='buckwheat').quantity,9);
});

test('second-network outage keeps the first draft, exclusions and manual quantities usable',async()=>{
  const {flow,basket}=setup({outage:true});await prepare(flow,'Магнит');
  const before=model(flow).quote.lines;
  await flow.handle('а в Перекрёстке?');
  assert.deepEqual(model(flow).quote.lines,before);
  assert.match(flow.getState().presentation.message,/Первый черновик/u);
  await flow.handle('Добавить показанное');
  assert.equal(basket.getSnapshot().find(row=>/греч/u.test(row.name.toLowerCase())).quantity,9);
});

test('switching and reloading do not refresh observation timestamps',async()=>{
  const {flow,setNow}=setup();await prepare(flow);setNow(now+3600001);
  await flow.handle('а в Перекрёстке?');
  assert.equal(model(flow).quote.allRecent,false);assert.equal(model(flow).quote.winner,null);
  await flow.handle('Подобрать товары и цены');
  assert.equal(model(flow).quote.lines.find(row=>row.group.key==='buckwheat').quantity,9);
  assert.equal(model(flow).quote.allRecent,false);
});

test('adding a partial second catalogue preserves the first draft without re-fetching its offline source',async()=>{
  const {flow,setNow,setMagnitOffline,magnitCalls}=setup({partialDelivery:true});
  await prepare(flow,'Магнит');
  const before=model(flow).quote.lines;
  const calls=magnitCalls();setMagnitOffline();setNow(now+3600001);
  await flow.handle('а в Перекрёстке?');
  assert.equal(model(flow).storeName,delivery.storeName);
  assert.equal(model(flow).quote.lines.filter(row=>row.card).length,1);
  assert.equal(model(flow).draftComparison.kind==='fresh',false);
  assert.equal(magnitCalls(),calls);
  await flow.handle('а в Магните?');
  assert.deepEqual(model(flow).quote.lines.map(row=>[row.card?.id,row.card?.observedAt,row.quantity]),
    before.map(row=>[row.card?.id,row.card?.observedAt,row.quantity]));
  assert.equal(model(flow).quote.allRecent,false);
  assert.equal(model(flow).quote.lines.find(row=>row.group.key==='buckwheat').quantity,9);
});
