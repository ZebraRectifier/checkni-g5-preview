import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {weeklyMagnitCard} from '../src/ports/weeklyRetailCatalogPort.mjs';
import {normalizeRetailRow} from '../src/ports/retailCatalogPort.mjs';
import {resolveMagnitMoscowStore} from '../src/data/magnitMoscowStores.mjs';
import {createGuidedShoppingPlan,guidedGroupMatches} from '../src/intelligence/guidedShoppingPlan.mjs';
import {createShoppingConversation,updateShoppingConversation} from '../src/intelligence/shoppingConversation.mjs';
import {createGuidedShoppingFlow} from '../src/runtime/guidedShoppingFlow.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {quoteCatalogDraft,catalogPurchaseUnit,suggestedCatalogQuantity} from '../src/core/catalogDraft.mjs';

// Actual HTTP names/amounts/times, shaped as catalogue rows for contract tests.
// This fixture is NOT proof that the native workflow imported these prices.
const fixture=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/magnit-groceries-773505.json',import.meta.url),'utf8'));
const now=Math.max(...fixture.rows.map(r=>Date.parse(r.observed_at)))+1000;
const store=resolveMagnitMoscowStore({shopCode:'773505'});
const cards=fixture.rows.map(row=>weeklyMagnitCard(normalizeRetailRow(row,{retailerId:'magnit',store},{nowMs:now}))).filter(Boolean);

test('real grocery observations cover all 16 requested families without inventing current DB/import evidence',async()=>{
  assert.equal(fixture.nativeImportVerified,false);
  assert.equal(cards.length,20);
  let memory=createShoppingConversation();const basket=createBasketStore({storage:null});
  const scope={retailerId:'magnit',storeId:'magnit-773505',storeName:'Магнит · '+store.address};
  const flow=createGuidedShoppingFlow({basket,now:()=>now,getMemory:()=>memory,
    updateMemory:delta=>{memory=updateShoppingConversation(memory,delta).state;return true;},getContext:()=>scope,
    getRetailContexts:()=>[scope],searchCatalog:async q=>({kind:'catalog',products:cards.filter(p=>p.name.toLowerCase().includes(q.toLowerCase()))})});
  flow.start('Собери недорогую корзину на неделю для троих в Магните',[]);
  await flow.handle('Ограничений нет');
  const model=flow.getState().presentation.guidedShopping;
  assert.equal(model.people,3);assert.equal(model.days,7);
  assert.equal(model.quote.lines.length,16);assert.equal(model.quote.complete,true);
  assert.equal(model.quote.hasEstimates,true);assert.equal(model.quote.winner,null);
  assert.equal(model.quote.availability,'unknown');
  assert.ok(model.quote.lines.every(row=>row.lineTotalMinor>0));
  assert.equal(basket.getSnapshot().length,0);
  await flow.handle('Добавить показанное');assert.equal(basket.getSnapshot().length,16);
  assert.match(basket.getSnapshot().find(row=>row.name.startsWith('Морковь')).unit,/весовая порция/u);
  assert.equal(quoteCatalogDraft(model.quote.lines,{nowMs:now}).knownSubtotalMinor,model.quote.knownSubtotalMinor);
});

test('weighted portions keep the observed portion price and visibly approximate mass, never a fixed-pack promise',()=>{
  const carrot=cards.find(p=>p.sourceProductId==='9072651201');
  assert.equal(carrot.unit,'700 г');assert.equal(carrot.priceMinor,2435);
  assert.equal(carrot.catalogPurchaseBasis,'weighed-portion');
  const unit=catalogPurchaseUnit(carrot);assert.equal(unit.amount,700);assert.equal(unit.approximate,true);
  assert.match(unit.label,/≈700 г/u);assert.match(carrot.priceConditionLabel,/фактической массы/u);
  const changed=weeklyMagnitCard({...carrot,unit:'упаковка',name:'Морковь 1кг',catalogPurchaseBasis:undefined});
  assert.equal(catalogPurchaseUnit(changed),null);
});

test('economy can offer raw drumsticks openly, while an explicit fillet request and cooked cuts stay strict',()=>{
  const economy=createGuidedShoppingPlan('Собери недорогую корзину',[],createShoppingConversation()).groups.find(g=>g.key==='chicken');
  assert.equal(economy.label,'Курица');assert.equal(guidedGroupMatches(economy,{name:'Голень цыпленка-бройлера 950г'}),true);
  assert.equal(guidedGroupMatches(economy,{name:'Голень цыпленка жареная 950г'}),false);
  const fillet=createGuidedShoppingPlan('Собери недорогую корзину с филе',[],createShoppingConversation()).groups.find(g=>g.key==='chicken');
  assert.equal(guidedGroupMatches(fillet,{name:'Голень цыпленка-бройлера 950г'}),false);
  assert.equal(guidedGroupMatches({key:'flakes'},{name:'Хлопья Царь овсяные Геркулес 400г'}),true);
  assert.equal(guidedGroupMatches({key:'flakes'},{name:'Хлопья овсяные с шоколадом 400г'}),false);
  assert.equal(guidedGroupMatches({key:'flakes'},{name:'Хлопья кукурузные Овсяный бренд 400г'}),false);
  assert.equal(guidedGroupMatches({key:'pork'},{name:'Лопатка свиная копчено-вареная 1кг'}),false);
});

test('the actual economy request finds both е/ё poultry spellings before family validation and keeps old evidence dated',async()=>{
  const observed='2026-10-12T06:08:10.895Z',at=Date.parse('2026-10-18T01:45:00Z');
  // The first title/pack/time reproduce the public 5014 readback; the е variant
  // and cheap distractors are adversarial fixtures, not additional observations.
  for(const name of ['Бедро цыплёнка-бройлера охлаждённое Троекурово, 900г','Бедро цыпленка-бройлера охлажденное Троекурово, 900г']){
    const scope={retailerId:'globus',storeId:'globus-store-5014',storeName:'Глобус Пушкино'};
    const card={id:'retail:globus:globus-store-5014:000000000000461185_ST',sourceProductId:'000000000000461185_ST',
      retailerId:'globus',name,unit:'упаковка',catalogPurchaseBasis:'piece',priceMinor:45799,currency:'RUB',availability:'unknown',
      sourceUrl:'https://www.globus.ru/catalog/myaso-pticza-kolbasy-10121355',
      productUrl:'https://www.globus.ru/products/bedro-cyplyonka-brojlera-oxlazhdyonnoe-troekurovo-900g-461185_ST/',observedAt:observed};
    const cards=[card,{...card,id:card.id+'-cooked',name:'Бедро цыплёнка жареное 900г',priceMinor:1},
      {...card,id:card.id+'-pet',name:'Корм для кошек с цыплёнком 900г',priceMinor:1}];
    const basket=createBasketStore({storage:null});let memory=createShoppingConversation();const queries=[];
    const flow=createGuidedShoppingFlow({basket,now:()=>at,hasAgreedStore:()=>true,getMemory:()=>memory,
      updateMemory:d=>{memory=updateShoppingConversation(memory,d).state;return true;},getContext:()=>scope,
      searchCatalog:async q=>{queries.push(q);return{kind:'catalog',products:cards.filter(p=>p.name.toLowerCase().includes(q.toLowerCase()))};}});
    flow.start('Собери недорогую корзину на неделю для троих',[]);await flow.handle('Ограничений нет');
    const quote=flow.getState().presentation.guidedShopping.quote,line=quote.lines.find(l=>l.group.key==='chicken');
    assert.ok(queries.some(q=>name.toLowerCase().includes(q)&&q.startsWith('цып')));
    assert.equal(line.card.sourceProductId,card.sourceProductId);assert.equal(line.card.name,name);
    assert.equal(line.unit.amount,900);assert.equal(line.card.priceMinor,45799);assert.equal(line.card.observedAt,observed);
    assert.equal(line.freshness,'dated');assert.equal(quote.allRecent,false);assert.equal(quote.complete,false);assert.equal(quote.winner,null);
    assert.equal(basket.getSnapshot().length,0);
    await flow.handle('Добавить найденное');assert.equal(basket.getSnapshot().length,1);
    assert.equal(basket.getSnapshot()[0].name,name);
  }
});

test('the reviewed buckwheat uses visible 800g, preserves price and rejects a name change despite the old 900g URL slug',()=>{
  const raw={id:'retail:magnit:magnit-773505:1000303406',retailerId:'magnit',sourceProductId:'1000303406',
    name:'Крупа гречневая ядрица Семейные секреты/Магнит 800г в ассортименте',unit:'упаковка',priceMinor:4499,
    productUrl:'https://magnit.ru/product/1000303406-krupa_grechnevaya_magnit_yadritsa_bystrogo_prigotovleniya_900g?shopCode=773505&shopType=1'};
  const actual=weeklyMagnitCard(raw);assert.equal(actual.unit,'800 г');assert.equal(actual.priceMinor,raw.priceMinor);
  assert.equal(actual.name,raw.name);assert.match(actual.productUrl,/900g/u);
  assert.equal(guidedGroupMatches({key:'buckwheat'},actual),true);
  const changed=weeklyMagnitCard({...raw,name:raw.name.replace('800г','900г')});assert.equal(changed.unit,'упаковка');
  assert.equal(catalogPurchaseUnit(changed),null);
});

test('reviewed oatmeal repairs only its exact 500g pack and retains money and selected-address identity',()=>{
  // Synthetic money tests invariance. It is not a collected price or import.
  const raw={id:'retail:magnit:magnit-773804:1349400001',retailerId:'magnit',sourceProductId:'1349400001',
    name:'Хлопья Ясно солнышко Овсяные №2 500г',unit:'упаковка',priceMinor:12345,
    productUrl:'https://magnit.ru/product/1349400001-khlopya_ovsyanye_yasno_solnyshko_ekstra_500g?shopCode=773804&shopType=1'};
  const actual=weeklyMagnitCard(raw);assert.equal(actual.unit,'500 г');assert.equal(actual.priceMinor,raw.priceMinor);
  assert.equal(catalogPurchaseUnit(actual).amount,500);assert.equal(suggestedCatalogQuantity({dimension:'g',dailyAmount:40},actual,3,7),2);
  for(const change of[{name:raw.name.replace('500г','450г')},{productUrl:raw.productUrl.replace('773804','773828')}])assert.equal(weeklyMagnitCard({...raw,...change}).unit,'упаковка');
  assert.equal(weeklyMagnitCard({...raw,unit:'400 г'}).unit,'400 г');
});
