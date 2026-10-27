import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNeedLine, splitNeedClauses, addDecimal, reviewNeedSelection } from '../src/intelligence/shoppingNeeds.mjs';
import { createShoppingNeedsStore, SHOPPING_NEEDS_KEY } from '../src/state/shoppingNeedsStore.mjs';
import { createShoppingConversationFlow } from '../src/runtime/shoppingConversationFlow.mjs';
import { createBasketStore } from '../src/state/basketStore.mjs';
import { SHOP_CATALOG } from '../src/data/shopCatalog.mjs';
import * as interpreter from '../src/runtime/hybridBasketInterpreter.mjs';
const memoryStorage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
function session(storage=null) {
  const needsStore=createShoppingNeedsStore({storage,allowUnlockedForTests:true});
  const basket=createBasketStore({storage:null});
  let calls=0;
  const flow=createShoppingConversationFlow({basket,needsStore,preferenceStorage:null,localCatalog:SHOP_CATALOG,
    loader:{load:async()=>interpreter},requestAiProposal:async()=>{calls++;return {kind:'unavailable'};}});
  return {flow,basket,store:needsStore,calls:()=>calls,lines:()=>needsStore.getSnapshot().lines};
}
test('a generic need retains twelve bottles without inventing fat, package volume, brand or SKU',async()=>{
  const s=session();const reply=await s.flow.run('хочу 12 бутылок кефира');
  assert.match(reply.presentation.headline,/Записано/u);
  assert.equal(s.lines()[0].quantity.value,'12');assert.equal(s.lines()[0].quantity.unit,'bottle');
  assert.equal(s.lines()[0].requestedName,'кефира');assert.equal(s.lines()[0].packageSize,null);
  assert.deepEqual(s.lines()[0].attributes,{});assert.equal(s.lines()[0].resolution.productId,null);
  assert.deepEqual(s.basket.getSnapshot(),[]);assert.equal(s.calls(),0);
});
test('unknown names survive mixed lists and cannot become nearest known products',async()=>{
  const s=session();await s.flow.run('2 бутылки кефира, хлеб, 3 пачки тофу, комбуча манго');
  assert.deepEqual(s.lines().map(x=>x.requestedName),['кефира','хлеб','тофу','комбуча манго']);
  assert.deepEqual(s.lines().map(x=>x.quantity.value),['2','1','3','1']);assert.deepEqual(s.basket.getSnapshot(),[]);
  assert.equal(s.flow.getUnresolvedNeeds().length,4);assert.equal(s.calls(),0);
});
test('acknowledgement, retries, duplicate messages, corrections, increments and removal have distinct effects',async()=>{
  const s=session();await s.flow.run('хочу 12 бутылок кефира',{requestId:'initial'});
  await s.flow.run('да');assert.equal(s.lines()[0].quantity.value,'12');
  await s.flow.run('хочу 12 бутылок кефира');assert.equal(s.lines().length,1);assert.equal(s.lines()[0].quantity.value,'12');
  await s.flow.run('не 12, а 6');assert.equal(s.lines()[0].quantity.value,'6');
  await s.flow.run('ещё две',{requestId:'increment'});assert.equal(s.lines()[0].quantity.value,'8');
  await s.flow.run('ещё две',{requestId:'increment'});assert.equal(s.lines()[0].quantity.value,'8');
  await s.flow.run('хочу 12 бутылок кефира',{requestId:'initial'});assert.equal(s.lines()[0].quantity.value,'8');
  await s.flow.run('удали кефир');assert.equal(s.lines().length,0);
  await s.flow.run('отмени последнее');assert.equal(s.lines()[0].quantity.value,'8');
});
test('multiple focus candidates cannot be modified by a pronoun',async()=>{
  const s=session();await s.flow.run('молоко, кефир');const before=s.lines();
  const reply=await s.flow.run('его убери');assert.deepEqual(s.lines(),before);assert.match(reply.presentation.headline,/Уточни/u);
});
test('typed quantities distinguish total volume, package size, mass and count',()=>{
  const cases=[['12 бутылок кефира по 0,5 л','12','bottle',{value:'0.5',unit:'l'}],['6 л кефира','6','l',null],['500 г яблок','500','g',null],['1,5 кг картофеля','1.5','kg',null],['10 яиц','10','piece',null],['2 упаковки яиц по 10 штук','2','pack',{value:'10',unit:'piece'}],['100 бутылок воды','100','bottle',null],['половину упаковки масла','0.5','pack',null]];
  for(const [text,amount,unit,pack] of cases){const row=parseNeedLine(text);assert.equal(row.quantity.value,amount,text);assert.equal(row.quantity.unit,unit,text);assert.deepEqual(row.packageSize,pack,text);}
  assert.deepEqual(splitNeedClauses('1,5 кг яблок, 500 г тофу'),['1,5 кг яблок','500 г тофу']);
  assert.equal(addDecimal('0.1','0.2'),'0.3');
});
test('explicit properties remain in the requested name and are not supplied by seed',async()=>{
  const s=session();await s.flow.run('молоко без лактозы 2 шт');
  assert.equal(s.lines()[0].requestedName,'молоко без лактозы');assert.equal(s.lines()[0].attributes['без лактозы'],true);
  assert.deepEqual(s.basket.getSnapshot(),[]);
});

test('unit prefixes cannot consume a product name or erase it from a mixed purchase',async()=>{
  for(const [input,name,amount,unit] of [
    ['два банана','банана','2','piece'],['пять бананов','бананов','5','piece'],
    ['2 грамматики','грамматики','2','piece'],['3 литрес','литрес','3','piece'],
    ['две коробочки тофу','тофу','2','box'],['три баночки тунца','тунца','3','can']
  ]) {
    const row=parseNeedLine(input);assert.ok(row,input);
    assert.equal(row.requestedName,name,input);assert.equal(row.quantity.value,amount,input);assert.equal(row.quantity.unit,unit,input);
  }
  const s=session();await s.flow.run('два банана, 2 банки тунца');
  assert.deepEqual(s.lines().map(row=>[row.requestedName,row.quantity.value,row.quantity.unit]),[['банана','2','piece'],['тунца','2','can']]);
  assert.deepEqual(s.basket.getSnapshot(),[]);assert.equal(s.calls(),0);
});
test('reload restores focus, quantities and idempotent receipt in one persisted record',async()=>{
  const storage=memoryStorage();const one=session(storage);
  await one.flow.run('кефир 12',{requestId:'first'});await one.flow.run('ещё две',{requestId:'plus'});
  const two=session(storage);await two.flow.run('ещё две',{requestId:'plus'});assert.equal(two.lines()[0].quantity.value,'14');
  await two.flow.run('да');assert.equal(two.lines()[0].quantity.value,'14');
  await two.flow.run('не 14, а 6');assert.equal(two.lines()[0].quantity.value,'6');
});
test('stale revisions cannot overwrite a different tab and failing storage cannot report success',async()=>{
  const storage=memoryStorage(),one=session(storage),two=session(storage);
  await one.flow.run('тофу');
  const stale=await two.store.transact({requestId:'stale',revision:0},state=>({state,message:'saved'}));assert.equal(stale.reason,'conflict');
  storage.setItem=()=>{throw new Error('quota');};const reply=await one.flow.run('кефир');
  assert.match(reply.presentation.headline,/не сохранено/u);assert.equal(one.lines().length,1);
});
test('a read of unchanged state does not invalidate an existing comparison',async()=>{
  const s=session(memoryStorage());let notifications=0;s.store.subscribe(()=>notifications++);
  s.store.refresh();assert.equal(notifications,0);await s.flow.run('тофу');assert.equal(notifications,1);
  s.store.refresh();s.store.refresh();assert.equal(notifications,1);
});
test('corrupt storage is retained for recovery instead of overwritten',async()=>{
  const storage=memoryStorage();storage.setItem(SHOPPING_NEEDS_KEY,'{bad');const s=session(storage);
  const reply=await s.flow.run('кефир');assert.match(reply.presentation.headline,/не сохранено/u);assert.equal(storage.getItem(SHOPPING_NEEDS_KEY),'{bad');
});
test('clear is an explicit persisted question and cancellation preserves the need',async()=>{
  const s=session();await s.flow.run('тофу');await s.flow.run('очисти список');assert.equal(s.lines().length,1);
  await s.flow.run('нет');assert.equal(s.lines().length,1);await s.flow.run('очисти список');await s.flow.run('да');assert.equal(s.lines().length,0);
});
test('advice and household inventory do not add shopping needs',async()=>{
  for(const phrase of ['как выбрать кефир?','у меня дома есть молоко','сколько стоит хлеб?','спасибо']){
    const s=session();await s.flow.run(phrase);assert.deepEqual(s.lines(),[],phrase);assert.deepEqual(s.basket.getSnapshot(),[],phrase);
  }
});
test('compound operations validate the entire change before writing',async()=>{
  const s=session();await s.flow.run('хлеб, молоко');
  await s.flow.run('убери хлеб, молоко оставь три, добавь рис');
  assert.deepEqual(s.lines().map(x=>[x.requestedName,x.quantity.value]),[['молоко','3'],['рис','1']]);
  const before=s.lines();await s.flow.run('удали рис, молоко оставь неизвестно');assert.deepEqual(s.lines(),before);
});
test('an intervening question cannot confirm a hidden clear action',async()=>{
  const s=session();await s.flow.run('тофу');await s.flow.run('очисти список');
  await s.flow.run('покажи список');await s.flow.run('да');assert.equal(s.lines().length,1);
});
test('invalid input shows validation while preserving the saved task',async()=>{
  const s=session();await s.flow.run('тофу');await s.flow.run('');
  assert.equal(s.flow.getState().inputReason,'empty');assert.equal(s.lines()[0].requestedName,'тофу');
});
test('number words and package contents remain distinct from the product',()=>{
  assert.equal(parseNeedLine('двадцать две бутылки кефира').quantity.value,'22');
  const row=parseNeedLine('две упаковки по 10 яиц');assert.equal(row.requestedName,'яиц');assert.deepEqual(row.packageSize,{value:'10',unit:'piece'});
  assert.equal(parseNeedLine('Мне 10 яиц').quantity.value,'10');
  assert.equal(parseNeedLine('Полтора килограмма картошки').quantity.value,'1.5');
});
test('an ambiguous edit can be answered after reload without replaying another action',async()=>{
  const storage=memoryStorage(),one=session(storage);await one.flow.run('молоко, кефир');
  await one.flow.run('его убери');const two=session(storage);await two.flow.run('да');assert.equal(two.lines().length,2);
  await two.flow.run('кефир');assert.deepEqual(two.lines().map(x=>x.requestedName),['молоко']);
});
test('total quantity, incremental quantity and inline increment have different meanings',async()=>{
  const s=session();await s.flow.run('молоко 2');await s.flow.run('Молока всего три');assert.equal(s.lines()[0].quantity.value,'3');
  await s.flow.run('Добавь ещё три молока');assert.equal(s.lines()[0].quantity.value,'6');
  const other=session();await other.flow.run('Кефир 2, кефир ещё 3');assert.equal(other.lines().length,1);assert.equal(other.lines()[0].quantity.value,'5');
});
test('catalogue-independent storage accepts a bounded variety of unseen names',async()=>{
  const names=['мисо Хакусэн','Barilla penne','тофу копчёный','комбуча манго','сумах','пакеты для мусора','батарейки AA','йогурт без сахара','растительный напиток','нут','семена чиа','папайя','зира','каперсы','хумус'];
  for(const name of names)for(const count of [1,2,12,100]) {
    const s=session();await s.flow.run(`Добавь ${count} упаковки ${name}`);
    assert.equal(s.lines().length,1,name);assert.equal(s.lines()[0].requestedName,name);assert.equal(s.lines()[0].quantity.value,String(count));
    assert.equal(s.lines()[0].resolution.productId,null);assert.deepEqual(s.basket.getSnapshot(),[]);assert.equal(s.calls(),0);
  }
});

test('compact measures and boxes retain the actual unit rather than becoming one piece',()=>{
  for(const [text,value,unit] of [['2л воды','2','l'],['масло 500г','500','g'],['2 коробки конфет','2','box']]) {
    const row=parseNeedLine(text);assert.equal(row.quantity.value,value);assert.equal(row.quantity.unit,unit);
  }
});

test('a new purchase after advice and an acknowledgement after thanks retain the needs context',async()=>{
  const s=session();await s.flow.run('как выбрать кефир?');await s.flow.run('2 пачки тофу');
  assert.equal(s.lines()[0].requestedName,'тофу');await s.flow.run('спасибо');
  const reply=await s.flow.run('да');assert.match(reply.presentation.headline,/уже сохранён/u);assert.equal(s.lines()[0].quantity.value,'2');
});

test('questions, unsupported orders and attribute fragments cannot masquerade as products',async()=>{
  for(const input of ['проверь, есть ли тофу','закажи всё','жирность 2,5%','2,5%']) {
    const s=session();await s.flow.run('кефир 12');const before=s.lines();await s.flow.run(input);
    assert.deepEqual(s.lines(),before,input);assert.deepEqual(s.basket.getSnapshot(),[],input);
  }
});

test('mixed requests keep purchases while explicitly exposing the unhandled question',async()=>{
  const s=session();const reply=await s.flow.run('500 г масла, покажи сколько это миллилитров');
  assert.equal(s.lines().length,1);assert.equal(s.lines()[0].quantity.unit,'g');assert.equal(s.lines()[0].quantity.value,'500');
  assert.match(reply.presentation.headline,/Отдельно нужно разобрать.*миллилитров/u);
});

test('one duplicate or a negative clause cannot silently discard the other purchase',async()=>{
  const s=session();await s.flow.run('кефир 2');const reply=await s.flow.run('кефир 2, рис 3');
  assert.deepEqual(s.lines().map(x=>[x.requestedName,x.quantity.value]),[['кефир','2'],['рис','3']]);
  assert.match(reply.presentation.headline,/прежнее количество сохранено/u);
  const other=session();await other.flow.run('молоко 2, яйца не надо');assert.deepEqual(other.lines().map(x=>x.requestedName),['молоко']);
});

test('quantity corrections accept the current unit and reject an implicit dimension change',async()=>{
  const s=session();await s.flow.run('12 бутылок кефира');await s.flow.run('не 12, а 6 бутылок');assert.equal(s.lines()[0].quantity.value,'6');
  const before=s.lines();await s.flow.run('не 6, а 3 л');assert.deepEqual(s.lines(),before);
});

test('manual review compares mass, volume, package contents and excess with exact units',()=>{
  const product=(unit,quantity)=>({id:'retail:test:actual',name:'Выбранный товар',unit,quantity});
  for(const [input,unit,count,ok] of [
    ['500 г яблок','1 кг',1,true],['1,5 кг картофеля','500 г',2,false],['1,5 кг картофеля','500 г',3,true],
    ['2 л воды','900 мл',3,true],['2 л воды','900 г',3,false],['10 яиц','10 шт',1,true],
    ['20 яиц','10 шт',1,false],['10 яиц','500 г',1,false],['2 упаковки яиц по 10 штук','10 шт',2,true],
    ['12 бутылок кефира по 0,5 л','900 мл',12,false],['12 бутылок кефира по 0,5 л','500 мл',12,true],
    ['2 упаковки тофу','неизвестно',2,true],['500 г яблок','около 1 кг',1,false],
  ])assert.equal(reviewNeedSelection(parseNeedLine(input),product(unit,count)).ok,ok,input+' / '+unit);
  assert.match(reviewNeedSelection(parseNeedLine('500 г яблок'),product('1 кг',1)).message,/больше потребности на 500 г/u);
  assert.match(reviewNeedSelection(parseNeedLine('2 л воды'),product('900 мл',3)).message,/больше потребности на 700 мл/u);
});

test('an explicit basket association survives reload and becomes unresolved after a manual quantity change',async()=>{
  const storage=memoryStorage(),s=session(storage);await s.flow.run('500 г яблок');
  const product={id:'retail:test:apple',name:'Яблоки',unit:'1 кг',quantity:1};
  s.basket.replaceReviewedBasket([], [product]);const lineId=s.lines()[0].lineId;
  assert.equal((await s.flow.linkNeed(lineId,product)).ok,true);assert.equal(s.flow.getUnresolvedNeeds().length,0);
  assert.equal(createShoppingNeedsStore({storage}).getSnapshot().lines[0].resolution.origin,'explicit_manual_review');
  s.basket.setQuantity(product.id,2);assert.equal(s.flow.getUnresolvedNeeds().length,1);
  assert.equal((await s.flow.linkNeed(lineId,product)).ok,false);
  assert.equal((await s.flow.linkNeed(lineId,s.basket.getSnapshot()[0])).ok,true);
  assert.equal(s.flow.getUnresolvedNeeds().length,0);
});

test('one basket row cannot fulfil two needs and a failed association never changes the basket',async()=>{
  const s=session();await s.flow.run('500 г яблок, 500 г яблок для пирога');
  const product={id:'retail:test:apple',name:'Яблоки',unit:'1 кг',quantity:1};s.basket.replaceReviewedBasket([], [product]);
  assert.equal((await s.flow.linkNeed(s.lines()[0].lineId,product)).ok,true);
  assert.equal((await s.flow.linkNeed(s.lines()[1].lineId,product)).ok,false);
  assert.deepEqual(s.basket.getSnapshot(),[product]);assert.equal(s.flow.getUnresolvedNeeds().length,1);
});

test('manual removal cancels a purchase waiting for the persistence lock',async()=>{
  const storage=memoryStorage(),seed=session(storage);await seed.flow.run('тофу');
  let release,first=true,queue=Promise.resolve();const held=new Promise(resolve=>{release=resolve;});
  const locks={request:(_name,callback)=>{const next=queue.then(async()=>{if(first){first=false;await held;}return callback();});queue=next.catch(()=>{});return next;}};
  const store=createShoppingNeedsStore({storage,locks}),basket=createBasketStore({storage:null});
  const flow=createShoppingConversationFlow({basket,needsStore:store,preferenceStorage:null,localCatalog:SHOP_CATALOG,loader:{load:async()=>interpreter},requestAiProposal:async()=>({kind:'unavailable'})});
  const pending=flow.run('кефир 2');const removal=flow.removeNeed(store.getSnapshot().lines[0].lineId);
  release();await Promise.all([pending,removal]);assert.deepEqual(store.getSnapshot().lines,[]);assert.deepEqual(basket.getSnapshot(),[]);
});

test('a bare product after advice cannot use the legacy path to silently choose a seed SKU',async()=>{
  const s=session();await s.flow.run('как выбрать кефир?');const reply=await s.flow.run('молоко');
  assert.deepEqual(s.basket.getSnapshot(),[]);assert.equal(reply.status,'clarification');
  assert.equal(reply.result.triggerReason,'conversation_draft');
  s.flow.confirm('confirm_all');assert.equal(s.basket.getSnapshot().length,1);
  const before=s.basket.getSnapshot();await s.flow.run('да');assert.deepEqual(s.basket.getSnapshot(),before);
});
