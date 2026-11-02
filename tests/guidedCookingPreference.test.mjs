import test from 'node:test';
import assert from 'node:assert/strict';
import {createShoppingConversation,updateShoppingConversation,extractShoppingDelta} from '../src/intelligence/shoppingConversation.mjs';
import {guidedGroupAllowed,createGuidedShoppingPlan,guidedGroupMatches} from '../src/intelligence/guidedShoppingPlan.mjs';

test('explicit no-cook preference excludes automatic cooking ingredients and can be reversed',()=>{
 let memory=updateShoppingConversation(createShoppingConversation(),extractShoppingDelta('Не хочу готовить')).state;
 for(const key of ['mince','chicken','pork','buckwheat','pasta','rice','eggs','potatoes','oats','flakes'])
   assert.equal(guidedGroupAllowed({key,label:key},memory),false,key);
 assert.equal(guidedGroupAllowed({key:'apples',label:'Яблоки'},memory),true);
 memory=updateShoppingConversation(memory,extractShoppingDelta('Можно готовить')).state;
 assert.equal(guidedGroupAllowed({key:'pasta',label:'Макароны'},memory),true);
 memory=updateShoppingConversation(memory,extractShoppingDelta('Без мяса')).state;
 assert.equal(guidedGroupAllowed({key:'chicken',label:'Куриное филе'},memory),false);
});

test('cold-food suggestions respect explicit ingredient exclusions',()=>{
 let memory=updateShoppingConversation(createShoppingConversation(),extractShoppingDelta('Не хочу готовить')).state;
 memory=updateShoppingConversation(memory,extractShoppingDelta('Без молока, сыра и кефира')).state;
 const plan=createGuidedShoppingPlan('Собери недорогую корзину',[],memory);
 const keys=plan.groups.filter(group=>guidedGroupAllowed(group,memory)).map(group=>group.key);
 assert.ok(keys.includes('bread'));
 assert.ok(keys.includes('apples'));
 for(const key of ['milk','cheese','kefir','mince','chicken','pasta'])assert.ok(!keys.includes(key),key);
});

test('the no-cook outline retains proposed replacements within the group limit',()=>{
 const memory=updateShoppingConversation(createShoppingConversation(),extractShoppingDelta('Не хочу готовить')).state;
 const plan=createGuidedShoppingPlan('Собери недорогую корзину',[],memory);
 for(const key of ['bread','kefir','curd','cheese'])assert.ok(plan.groups.some(g=>g.key===key),key);
});

test('cold-food families match the head noun rather than flavour or adjacent categories',()=>{
 assert.equal(guidedGroupMatches({key:'bread'},{name:'Хлеб ржаной 220 г'}),true);
 assert.equal(guidedGroupMatches({key:'bread'},{name:'Хлебцы ржаные 100 г'}),false);
 assert.equal(guidedGroupMatches({key:'kefir'},{name:'Кефир 1% 330 мл'}),true);
 assert.equal(guidedGroupMatches({key:'kefir'},{name:'Напиток со вкусом кефира 330 мл'}),false);
});
