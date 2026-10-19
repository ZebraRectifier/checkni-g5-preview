import test from'node:test';import assert from'node:assert/strict';
import{extractShoppingDelta}from'../src/intelligence/shoppingConversation.mjs';
import{createShoppingConversationFlow}from'../src/runtime/shoppingConversationFlow.mjs';
import{createBasketStore}from'../src/state/basketStore.mjs';import{SHOP_CATALOG}from'../src/data/shopCatalog.mjs';import*as interpreter from'../src/runtime/hybridBasketInterpreter.mjs';
import{shoppingAdviceFocus,resolveShoppingAdviceFollowup}from'../src/intelligence/shoppingTurnContext.mjs';

test('an omitted product in a suitability follow-up keeps the previous answer without capturing new foods or commands',async()=>{
 const focus=shoppingAdviceFocus('Как выбрать яблоки для пирога?');
 assert.equal(resolveShoppingAdviceFollowup('А зелёные подойдут?',focus)?.readOnly,true);
 for(const text of ['Зелёные подойдут.','А зелёные подойдут, добавь их?','А яйца подойдут?','А те же яйца можно есть свежими?','А зелёные дешевле?'])
  assert.equal(resolveShoppingAdviceFollowup(text,focus),null,text);
 const calls=[],basket=createBasketStore({storage:null}),flow=createShoppingConversationFlow({basket,localCatalog:SHOP_CATALOG,preferenceStorage:null,priceHints:new Map(),loader:{load:async()=>interpreter},requestAiProposal:async()=>({kind:'unavailable'}),resolveLiveCatalog:async()=>[],requestShoppingAdvice:async request=>{calls.push(structuredClone(request));return{kind:'advice',message:'Для пирога выбирай сорт яблок по рецепту; цвет не определяет вкус.'};}});
 const turns=['Как выбрать яблоки для пирога?','А зелёные подойдут?','А те же яблоки можно есть свежими?'];
 for(const text of turns){flow.edit();await flow.run(text);}
 assert.equal(calls.length,3);assert.deepEqual(calls.map(r=>r.history?.length??0),[0,2,4]);
 assert.equal(calls[1].history[1].text,'Для пирога выбирай сорт яблок по рецепту; цвет не определяет вкус.');
 assert.deepEqual(basket.getSnapshot(),[]);
});

test('negative suitability questions do not invent a refusal or an unresolved dietary condition',()=>{
 for(const text of ['Ты же сам предложил треску — теперь она не подходит?','Она не подходит для духовки?','А треска не подходит для супа?',
 'Яйца не подходят для пирога?','Почему те же яблоки не подходят для выпечки?']){
  const delta=extractShoppingDelta(text);assert.deepEqual(delta.reject,[],text);assert.deepEqual(delta.unresolved,[],text);assert.deepEqual(delta.allow,[],text);
 }
});

test('explicit refusals remain binding even when followed by a question',()=>{
 for(const[text,target]of [['рис не подходит','rice'],['Мне не подходит рис, что выбрать?','rice'],['Рис не подходит, убери его?','rice'],
 ['Не ем яйца, что посоветуешь?','eggs'],['Без яиц, что можно?','eggs']])assert.ok(extractShoppingDelta(text).reject.includes(target),text);
 for(const text of ['Мне не подходят морепродукты, что выбрать?','Мне не подходит рыба. Почему?'])assert.ok(extractShoppingDelta(text).unresolved.length,text);
 const mixed=extractShoppingDelta('Яйца не подходят для пирога? Рыбу не ем.');
 assert.deepEqual(mixed.reject,[]);assert.ok(mixed.unresolved.some(s=>s.includes('рыбу')),JSON.stringify(mixed));
});

test('challenging a previous recommendation reaches advice, retains history and leaves the next topic usable',async()=>{
 const calls=[],basket=createBasketStore({storage:null}),flow=createShoppingConversationFlow({basket,localCatalog:SHOP_CATALOG,preferenceStorage:null,priceHints:new Map(),loader:{load:async()=>interpreter},requestAiProposal:async()=>({kind:'unavailable'}),resolveLiveCatalog:async()=>[],requestShoppingAdvice:async request=>{calls.push(structuredClone(request));return{kind:'advice',message:'Треска, судак и хек подходят для обсуждения разных способов приготовления.'};}});
 const turns=['Посоветуй рыбу для супа.','Она подойдёт для духовки? Нас двое.','Ты же сам предложил треску — теперь она не подходит?','Теперь посоветуй творог к завтраку.'];
 for(const text of turns){flow.edit();await flow.run(text);}
 assert.equal(calls.length,4);assert.equal(calls[2].text,turns[2]);assert.equal(calls[2].context.peopleCount,2);
 assert.ok(calls[2].history.some(r=>r.text===turns[0]));assert.equal(calls[3].text,turns[3]);assert.deepEqual(basket.getSnapshot(),[]);
});
