import test from 'node:test';import assert from 'node:assert/strict';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {applyWeeklyBasket} from '../src/runtime/weeklyBasketFlow.mjs';
import {WEEKLY_BASKET_RECIPE} from '../src/catalog/weeklyBasketRecipe.mjs';
import {WEEKLY_ROUTE_PRODUCTS} from '../src/catalog/weeklyRouteProducts.mjs';
const rows=WEEKLY_BASKET_RECIPE.map(({id,name,unit,quantity})=>({id,name,unit,quantity}));
const store=()=>createBasketStore({storage:null,eventTarget:null});
test('visible ten-pack recipe uses the reviewed bran bread while retaining the old collector identity',()=>{
 const oldBread='000000000000257140_ST',replacement='000000000093100502_ST';
 assert.equal(WEEKLY_ROUTE_PRODUCTS.length,13);
 assert.equal(WEEKLY_BASKET_RECIPE.length,10);
 assert.ok(WEEKLY_ROUTE_PRODUCTS.some(p=>p.sourceProductId===oldBread));
 assert.ok(!WEEKLY_BASKET_RECIPE.some(p=>p.sourceProductId===oldBread));
 assert.equal(WEEKLY_BASKET_RECIPE.find(p=>p.sourceProductId===replacement)?.quantity,7);
 assert.equal(WEEKLY_BASKET_RECIPE.find(p=>p.sourceProductId===replacement)?.unit,'350 г');
});
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
