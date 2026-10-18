import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createWeeklyRetailCatalogPort,weeklyMagnitCard,weeklyOkeyCards,validWeeklyCardSource,OKEY_WEEKLY_SCOPE} from '../src/ports/weeklyRetailCatalogPort.mjs';
import {parsePublishedCatalogue,PUBLISHED_URL} from '../src/observations/okeyPublishedPromotions.mjs';
import {WEEKLY_MAGNIT_IDENTITIES} from '../src/catalog/weeklyMagnitIdentities.mjs';
import {createRetailCatalogClient} from '../src/ports/retailCatalogPort.mjs';
import {resolveMagnitMoscowStore} from '../src/data/magnitMoscowStores.mjs';
import {createGuidedShoppingFlow} from '../src/runtime/guidedShoppingFlow.mjs';
import {createShoppingConversation,updateShoppingConversation} from '../src/intelligence/shoppingConversation.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {quoteCatalogDraft,suggestedCatalogQuantity} from '../src/core/catalogDraft.mjs';
const now=Date.parse('2026-10-17T22:00:00Z');
const source=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/magnit.json',import.meta.url),'utf8'));
const store=resolveMagnitMoscowStore({shopCode:'773608'});
function magnitClient(options={}){return createRetailCatalogClient({...options,nowMs:now,fetchImpl:async url=>{
  const u=new URL(url),q=(u.searchParams.get('name')??'').replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' '),id=u.searchParams.get('store_id').replace('eq.','');
  return new Response(JSON.stringify(source.filter(r=>r.store_id===id&&r.name.toLowerCase().includes(q.toLowerCase())).slice(0,40)));}});}
const scope={...magnitClient({retailerId:'magnit',store}).definition,store};
const snapshot=()=>parsePublishedCatalogue({sourceUrl:PUBLISHED_URL,title:'Каталог акций «Окей Гипермаркет» — Москва',period:'с 15 по 21 октября 2026',observedAt:'2026-10-17T20:44:16.994Z',
  products:[{id:'51922605',name:'Свинина шея без кости п/ф охлажденный кг',rubles:'459',cents:'00',endText:'до 21 октября'},
    {id:'51922403',name:'БЗМЖ Сыр Ламбер мдж в сух в-е 50% сычужный Россия кг',rubles:'999',cents:'00',endText:'до 28 октября'},
    {id:'51922572',name:'Мицелярная вода д/лица Mixit 500мл',rubles:'356',cents:'85',endText:'до 25 октября'}]});
const port=()=>createWeeklyRetailCatalogPort({now:()=>now,createMagnitClient:magnitClient,fetchImpl:async()=>new Response(JSON.stringify(snapshot()))});
test('46 reviewed Magnit identities preserve observed prices and source address; edited packs cannot inherit them',async()=>{
  assert.equal(WEEKLY_MAGNIT_IDENTITIES.length,46);
  const result=await port().search('фарш',{scope});assert.equal(result.kind,'catalog');assert.equal(result.products.length,3);
  const card=result.products.find(p=>p.sourceProductId==='1000289065');assert.equal(card.unit,'400 г');assert.equal(card.priceMinor,12999);
  assert.match(card.productUrl,/shopCode=773608/u);assert.equal(card.observedAt,'2026-10-17T19:47:32.304Z');
  const raw={...card,unit:'упаковка'};
  for(const change of [{name:'Другой фарш 300г'},{productUrl:raw.productUrl.replace('773608','777312')},{unit:'300 г'},{sourceProductId:'wrong'}]){
    const altered={...raw,...change};assert.equal(weeklyMagnitCard(altered).unit,altered.unit);
  }
  assert.equal(suggestedCatalogQuantity({dimension:'g',dailyAmount:100},card,3,7),6);
  const weight=weeklyMagnitCard({...raw,name:'Сыр Российский весовой 350г',unit:'350 г',catalogPurchaseBasis:'piece'});
  assert.equal(quoteCatalogDraft([{card:weight,quantity:2,product:{id:weight.id,name:weight.name,unit:weight.unit}}],{nowMs:now}).basket.length,0);
});
test('OKEY only admits reviewed food identities, typed city scope and current promotions',()=>{
  const cards=weeklyOkeyCards(snapshot(),now);assert.equal(cards.length,2);assert.equal(cards[0].unit,'1 кг');
  assert.equal(cards[0].physicalStoreId,null);assert.equal(cards[0].priceCondition,'promotion-conditions-unconfirmed');
  assert.equal(validWeeklyCardSource(cards[0],OKEY_WEEKLY_SCOPE),true);
  assert.equal(validWeeklyCardSource({...cards[0],productUrl:'https://example.org/'},OKEY_WEEKLY_SCOPE),false);
  assert.equal(weeklyOkeyCards(snapshot(),Date.parse('2026-10-21T21:00:00Z')).length,0);
  assert.equal(weeklyOkeyCards(snapshot(),now+86400001).length,0);
});
test('expired city promotion cannot be confirmed from an open draft at Moscow midnight',()=>{
  const card=weeklyOkeyCards(snapshot(),now)[0];
  const quote=quoteCatalogDraft([{group:{key:'pork'},card,quantity:2,product:{id:card.id,name:card.name,unit:card.unit}}],{nowMs:Date.parse('2026-10-21T21:00:00Z')});
  assert.equal(quote.basket.length,0);assert.equal(quote.knownSubtotalMinor,null);
});
test('weekly journey keeps three people/seven days, compares partial catalogue lists and confirms only explicit selected rows',async()=>{
  const basket=createBasketStore({storage:null});let memory=createShoppingConversation(),current=scope;
  const catalog=port();
  const flow=createGuidedShoppingFlow({basket,now:()=>now,getMemory:()=>memory,updateMemory:d=>{memory=updateShoppingConversation(memory,d).state;return true;},
    getContext:()=>current,getRetailContexts:()=>[scope,OKEY_WEEKLY_SCOPE],searchCatalog:(q,o)=>catalog.search(q,o),
    compareBasket:async()=>({kind:'unavailable'})});
  flow.start('Собери недорогую корзину на неделю для троих в Магните и О’КЕЙ',[]);
  assert.match(flow.getState().presentation.message,/Какие продукты исключить/u);
  await flow.handle('Ограничений нет');const model=flow.getState().presentation.guidedShopping;
  assert.equal(model.people,3);assert.equal(model.days,7);assert.equal(model.quote.lines.length,16);
  assert.equal(model.alternatives.length,2);assert.equal(model.quote.winner,null);assert.equal(model.quote.complete,false);
  assert.ok(model.alternatives.every(a=>a.found<a.requested));assert.equal(basket.getSnapshot().length,0);
  await flow.handle('Показать вариант okey');assert.equal(flow.getState().presentation.guidedShopping.quote.basket.length,2);
  await flow.handle('Добавить найденное');assert.equal(basket.getSnapshot().length,2);
  assert.ok(basket.getSnapshot().every(p=>p.id.startsWith('retail:okey:')));
  const before=basket.getSnapshot();await flow.handle('Добавить найденное');assert.deepEqual(basket.getSnapshot(),before);
});
test('changing the selected catalogue invalidates a reviewed mixed-source draft before confirmation',async()=>{
  const basket=createBasketStore({storage:null});let memory=createShoppingConversation(),current=scope;
  const catalog=port(),flow=createGuidedShoppingFlow({basket,now:()=>now,getMemory:()=>memory,updateMemory:d=>{memory=updateShoppingConversation(memory,d).state;return true;},
    getContext:()=>current,getRetailContexts:()=>[scope,OKEY_WEEKLY_SCOPE],searchCatalog:(q,o)=>catalog.search(q,o)});
  flow.start('Собери недорогую корзину на неделю для троих в Магните и О’КЕЙ',[]);await flow.handle('Ограничений нет');
  current={...scope,storeId:'magnit-777312'};await flow.handle('Добавить найденное');assert.equal(basket.getSnapshot().length,0);
});
