import test from 'node:test';import assert from 'node:assert/strict';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {applyWeeklyBasket} from '../src/runtime/weeklyBasketFlow.mjs';
import {WEEKLY_BASKET_RECIPE} from '../src/catalog/weeklyBasketRecipe.mjs';
const rows=WEEKLY_BASKET_RECIPE.map(({id,name,unit,quantity})=>({id,name,unit,quantity}));
const store=()=>createBasketStore({storage:null,eventTarget:null});
test('a week merges through the existing basket limits and preserves unrelated purchases',()=>{
 const basket=store(),other={id:'other',name:'Existing purchase',unit:'1 шт',quantity:2};basket.replaceReviewedBasket([],[other]);
 assert.equal(applyWeeklyBasket({basket,rows}),true);assert.equal(basket.getSnapshot().length,11);assert.deepEqual(basket.getSnapshot()[0],other);
});
test('one quantity or metadata conflict cannot partially add the remaining recipe products',()=>{
 for(const first of [{...rows[0],quantity:99},{...rows[0],name:'Different exact pack'}]){
  const basket=store();basket.replaceReviewedBasket([],[first]);
  assert.equal(applyWeeklyBasket({basket,rows}),false);assert.deepEqual(basket.getSnapshot(),[first]);
 }
});
test('replacement rejects a stale reviewed basket while an explicitly reviewed current replacement succeeds',()=>{
 const basket=store(),expected=basket.getSnapshot();basket.replaceReviewedBasket(expected,[rows[0]]);
 assert.equal(applyWeeklyBasket({basket,rows,replace:true,expected}),false);assert.deepEqual(basket.getSnapshot(),[rows[0]]);
 assert.equal(applyWeeklyBasket({basket,rows,replace:true,expected:basket.getSnapshot()}),true);assert.deepEqual(basket.getSnapshot(),rows);
});
