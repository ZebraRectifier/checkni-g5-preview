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
import {quoteCatalogDraft,catalogPurchaseUnit} from '../src/core/catalogDraft.mjs';

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
