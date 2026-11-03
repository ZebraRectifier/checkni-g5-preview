import test from 'node:test';
import assert from 'node:assert/strict';
import {createShoppingConversationFlow} from '../src/runtime/shoppingConversationFlow.mjs';
import {createBasketStore} from '../src/state/basketStore.mjs';
import {SHOP_CATALOG} from '../src/data/shopCatalog.mjs';
import * as interpreter from '../src/runtime/hybridBasketInterpreter.mjs';
function session(){
 const basket=createBasketStore({storage:null}),advice=[];
 const firstReply='Можно сделать пасту с томатным соусом или макароны с овощным рагу.';
 const flow=createShoppingConversationFlow({basket,localCatalog:SHOP_CATALOG,preferenceStorage:null,priceHints:new Map(),
  resolveProductFactsCatalog:()=>[],resolveRetailSelectionScope:()=>null,searchGuidedCatalog:async()=>[],
  loader:{load:async()=>interpreter},requestAiProposal:async()=>{throw Error('No proposal call allowed');},
  requestShoppingAdvice:async input=>{advice.push(structuredClone(input));return{kind:'advice',message:advice.length===1?firstReply:'Для второго варианта возьми макароны и овощную смесь: отвари и перемешай.'};}});
 const send=text=>{flow.edit();return flow.run(text);};return{flow,basket,advice,firstReply,send};
}
test('a recipe continuation retains the actual accepted advice and shopping constraints',async()=>{
 const s=session();await s.send('Нас четверо, покупки на десять дней');await s.send('Не хочу готовить');await s.send('Без мяса');
 const question='Как выбрать макароны для быстрых ужинов без мяса? Предложи два простых блюда.';
 await s.send(question);await s.send('Оставим второй вариант. Как приготовить его попроще?');
 assert.equal(s.advice.length,2);
 assert.deepEqual(s.advice[1].history,[{role:'user',text:question},{role:'assistant',text:s.firstReply}]);
 assert.equal(s.advice[1].context.peopleCount,4);assert.equal(s.advice[1].context.shoppingDays,10);
 assert.equal(s.advice[1].context.cookingEffort,'minimal');assert.deepEqual(s.advice[1].context.excluded,['meat']);
 assert.deepEqual(s.basket.getSnapshot(),[]);
});
test('a cooking preference before store selection is intake, not a historical seed basket',async()=>{
 const s=session();await s.send('Нас четверо, покупки на десять дней');const state=await s.send('Не хочу готовить');
 assert.equal(s.flow.getConversation().facts.cookingEffort.value,'minimal');
 assert.deepEqual(state.presentation.items,[]);assert.equal(state.presentation.primaryAction,'Продолжить');
 assert.match(state.presentation.message,/магазин/u);assert.doesNotMatch(state.presentation.message,/Историческ|₽|Колбас|Туш[её]н/u);
 assert.deepEqual(s.basket.getSnapshot(),[]);assert.equal(s.advice.length,0);
});

test('an ordinal recipe reference without a prior answer asks one question without calling a model',async()=>{
 const s=session();const state=await s.send('Оставим второй вариант. Как приготовить его попроще?');
 assert.equal(s.advice.length,0);assert.match(state.presentation.message,/вариант|блюд/u);assert.deepEqual(s.basket.getSnapshot(),[]);
});
