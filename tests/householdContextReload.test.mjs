import test from 'node:test';
import assert from 'node:assert/strict';
import {createShoppingConversationFlow} from '../src/runtime/shoppingConversationFlow.mjs';
import {createShoppingPreferenceStore,SHOPPING_PREFERENCE_STORAGE_KEY} from '../src/runtime/shoppingPreferenceStorage.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {createShoppingNeedsStore} from '../src/state/shoppingNeedsStore.mjs';
import {SHOP_CATALOG} from '../src/data/shopCatalog.mjs';
import {shoppingDaysText} from '../src/intelligence/shoppingNeedContext.mjs';
import {createShoppingConversation} from '../src/intelligence/shoppingConversation.mjs';
import * as interpreter from '../src/runtime/hybridBasketInterpreter.mjs';

function storage() {
  const data=new Map();return {getItem:key=>data.get(key)??null,
    setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
}
function session(disk,basket=createBasketStore({storage:null})) {
  let providerCalls=0;
  const needs=createShoppingNeedsStore({storage:null,allowUnlockedForTests:true});
  const flow=createShoppingConversationFlow({basket,localCatalog:SHOP_CATALOG,
    needsStore:needs,preferenceStorage:disk,
    loader:{load:async()=>interpreter},requestAiProposal:async()=>{providerCalls++;return {kind:'unavailable'};}});
  return {flow,basket,needs,calls:()=>providerCalls};
}

test('reload restores the explicit household and duration without changing the confirmed basket',async()=>{
  for(const [people,days] of [[1,3],[4,10],[6,14],[12,31]]){
    const disk=storage(),first=session(disk);first.basket.add(SHOP_CATALOG[0]);
    const before=first.basket.getSnapshot();
    await first.flow.run(`Нас ${people} человек, покупки на ${shoppingDaysText(days)}`);
    assert.equal(first.flow.getConversation().facts.peopleCount.value,people);
    const second=session(disk,first.basket),memory=second.flow.getConversation();
    assert.equal(memory.facts.peopleCount?.value,people);
    assert.equal(memory.facts.shoppingDays?.value,days);
    assert.equal(memory.facts.peopleCount.origin,'explicit');
    assert.equal(memory.facts.shoppingDays.scope,'goal');
    second.flow.confirm('confirm_all');await second.flow.run('го');
    assert.deepEqual(second.basket.getSnapshot(),before);
    assert.equal(second.calls(),0);
  }
});

test('a new basket clears restored goal sizing while keeping explicit cooking preferences',async()=>{
  const disk=storage(),first=session(disk);
  await first.flow.run('Нас четверо, покупки на десять дней');
  first.flow.edit();await first.flow.run('Не хочу готовить');
  const second=session(disk);
  assert.equal(second.flow.getConversation().facts.peopleCount?.value,4);
  await second.flow.run('Новая корзина');
  const third=session(disk).flow.getConversation();
  assert.equal(third.facts.peopleCount,undefined);
  assert.equal(third.facts.shoppingDays,undefined);
  assert.equal(third.facts.cookingEffort?.value,'minimal');
  assert.deepEqual(second.basket.getSnapshot(),[]);
});

test('corrupt stored household and duration fail closed instead of becoming default portions',()=>{
  const base={version:1,facts:{},rejected:{},exceptions:{},wishes:{}};
  for(const [key,invalid] of [['peopleCount',[0,-1,13,2.5,'4']],['shoppingDays',[0,-1,32,1.5,'10']]]){
    for(const value of invalid){
      const disk=storage();disk.setItem(SHOPPING_PREFERENCE_STORAGE_KEY,JSON.stringify({...base,
        facts:{[key]:{value,scope:'goal'}}}));
      const memory=createShoppingPreferenceStore({storage:disk}).read();
      assert.ok(memory.facts.unresolvedConstraints,key+' / '+value);
      assert.equal(memory.facts.peopleCount,undefined);
      assert.equal(memory.facts.shoppingDays,undefined);
    }
  }
});

test('a new visitor has no inferred household or period',()=>{
  const memory=session(storage()).flow.getConversation();
  assert.equal(memory.facts.peopleCount,undefined);
  assert.equal(memory.facts.shoppingDays,undefined);
});

test('standalone cooking preferences update memory instead of becoming products',async()=>{
  for(const text of ['Не хочу готовить','Не люблю готовить','Не хочу готовить, что взять?']){
    const disk=storage(),s=session(disk);await s.flow.run(text);
    assert.equal(s.flow.getConversation().facts.cookingEffort?.value,'minimal',text);
    assert.deepEqual(s.needs.getSnapshot().lines,[],text);
    assert.deepEqual(s.basket.getSnapshot(),[],text);
    assert.equal(session(disk).flow.getConversation().facts.cookingEffort?.value,'minimal',text);
    assert.equal(s.calls(),0);
  }
});

test('restorable sizing excludes model guesses, location and commercial data',()=>{
  const disk=storage(),preferences=createShoppingPreferenceStore({storage:disk});
  const entry=(value,origin='explicit')=>({value,scope:'goal',origin,confidence:'high',evidenceTurn:1});
  const memory={...createShoppingConversation(),facts:{peopleCount:entry(4,'inferred'),shoppingDays:entry(10),
    location:entry('Пушкино'),retailer:entry('Магнит')},transcript:'model guess',priceMinor:1};
  assert.equal(preferences.write(memory),true);
  const restored=createShoppingPreferenceStore({storage:disk}).read();
  assert.equal(restored.facts.peopleCount,undefined);
  assert.equal(restored.facts.shoppingDays.value,10);
  assert.doesNotMatch(disk.getItem(SHOPPING_PREFERENCE_STORAGE_KEY),/Пушкино|Магнит|priceMinor|transcript|model guess|evidenceTurn/u);
});
