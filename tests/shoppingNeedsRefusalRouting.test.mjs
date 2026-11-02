import test from 'node:test';
import assert from 'node:assert/strict';
import {createShoppingConversationFlow} from '../src/runtime/shoppingConversationFlow.mjs';
import {createShoppingNeedsStore} from '../src/state/shoppingNeedsStore.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {SHOP_CATALOG} from '../src/data/shopCatalog.mjs';
import * as interpreter from '../src/runtime/hybridBasketInterpreter.mjs';

function session() {
  const basket=createBasketStore({storage:null});
  const needs=createShoppingNeedsStore({storage:null,allowUnlockedForTests:true});
  const advice=[];let proposals=0;
  const flow=createShoppingConversationFlow({basket,needsStore:needs,preferenceStorage:null,
    localCatalog:SHOP_CATALOG,loader:{load:async()=>interpreter},
    requestAiProposal:async()=>{proposals++;return {kind:'unavailable'};},
    requestShoppingAdvice:async request=>{advice.push(structuredClone(request));
      return {kind:'advice',message:'Для дороги можно рассмотреть яблоки и хлеб. Проверь состав и упаковку.'};}});
  const send=async text=>{flow.edit();return flow.run(text);};
  return {basket,needs,flow,send,advice,proposals:()=>proposals};
}

test('live advice follow-up keeps compound exclusions out of the shopping list',async()=>{
  const s=session();
  await s.send('ПП');assert.equal(s.advice.length,1);
  const beforeNeeds=s.needs.getSnapshot(),beforeBasket=s.basket.getSnapshot();
  await s.send('Не добавляй молоко, сыр и кефир. Готовить не хочу. Что из предложенного взять в дорогу?');
  assert.deepEqual(s.needs.getSnapshot().lines,beforeNeeds.lines);
  assert.deepEqual(s.basket.getSnapshot(),beforeBasket);
  for(const key of ['milk','cheese','kefir'])assert.equal(s.flow.getConversation().rejected[key]?.value,true,key);
  assert.equal(s.flow.getConversation().facts.cookingEffort?.value,'minimal');
  assert.equal(s.advice.length,2);
  assert.deepEqual(s.advice[1].context.excluded.toSorted(),['cheese','kefir','milk']);
  assert.equal(s.advice[1].context.cookingEffort,'minimal');
  assert.deepEqual(s.advice[1].history,[{role:'user',text:'ПП'},
    {role:'assistant',text:'Для дороги можно рассмотреть яблоки и хлеб. Проверь состав и упаковку.'}]);
  await s.send('А что ещё можно взять в дорогу?');
  assert.equal(s.advice.length,3);
  assert.deepEqual(s.advice[2].context.excluded.toSorted(),['cheese','kefir','milk']);
  assert.equal(s.advice[2].history.length,4);
  assert.deepEqual(s.needs.getSnapshot().lines,beforeNeeds.lines);
  assert.equal(s.proposals(),0);
});

test('a known multi-product dislike is a preference even with existing manual needs',async()=>{
  const s=session();await s.send('тофу, рис');
  const before=s.needs.getSnapshot().lines;
  await s.send('Не люблю молоко, сыр и кефир');
  assert.deepEqual(s.needs.getSnapshot().lines,before);
  for(const key of ['milk','cheese','kefir'])assert.equal(s.flow.getConversation().rejected[key]?.value,true,key);
  assert.deepEqual(s.basket.getSnapshot(),[]);assert.equal(s.proposals(),0);
});

test('compound exclusions with cooking preferences never become named products',async()=>{
  for(const text of ['Без молока и сыра, готовить не хочу','Молоко не добавляй, сыр не клади']){
    const s=session();await s.send(text);
    assert.deepEqual(s.needs.getSnapshot().lines,[],text);
    for(const key of ['milk','cheese'])assert.equal(s.flow.getConversation().rejected[key]?.value,true,text+' / '+key);
    assert.deepEqual(s.basket.getSnapshot(),[]);assert.equal(s.proposals(),0);
  }
});
