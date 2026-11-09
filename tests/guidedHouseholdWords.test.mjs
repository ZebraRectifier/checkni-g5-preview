import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceGuidedIntake} from '../src/intelligence/guidedShoppingPlan.mjs';
import {suggestedCatalogQuantity, economicalCatalogCards} from '../src/core/catalogDraft.mjs';
import {extractShoppingDelta} from '../src/intelligence/shoppingConversation.mjs';

test('short household answers support larger families without assuming three people',()=>{
  for(const [text,count] of [['пятеро',5],['шестеро',6],['семеро',7],['восьмеро',8],['девятеро',9],['десятеро',10],['одиннадцать',11],['двенадцать',12]]){
    const plan={question:'people',groups:[],people:null,days:14};
    const memory={facts:{},rejected:[],wishes:[],exceptions:[]};
    const result=advanceGuidedIntake(plan,text,memory);
    assert.equal(result.issue,undefined,text);
    assert.equal(plan.people,count,text);
    assert.equal(result.delta.facts.peopleCount.value,count,text);
    assert.equal(plan.days,14,text);
  }
});

test('different household sizes and periods determine pack counts, with oversized needs excluded from economical selection',()=>{
  const group={dailyAmount:200,dimension:'ml'};
  const milk={unit:'1 л',priceMinor:10000,currency:'RUB',observedAt:'2026-11-02T12:00:00Z'};
  for(const [people,days,quantity] of [[1,3,1],[4,7,6],[5,14,14],[6,10,12]])
    assert.equal(suggestedCatalogQuantity(group,milk,people,days),quantity);
  const tinyPack={...milk,unit:'10 мл'};
  assert.deepEqual(economicalCatalogCards(group,[tinyPack],6,10,{nowMs:Date.parse('2026-11-02T12:30:00Z')}),[]);
});


test('duration answers use the current question and accept spoken days without changing household size',()=>{
  for(const [text,days] of [['десять',10],['четырнадцать',14],['на двадцать один день',21],['тридцать один',31],['10 дней',10]]){
    const plan={question:'days',groups:[],people:6,days:null};
    const result=advanceGuidedIntake(plan,text,{facts:{},rejected:[],wishes:[],exceptions:[]});
    assert.equal(result.issue,undefined,text);
    assert.equal(plan.days,days,text);
    assert.equal(plan.people,6,text);
    assert.equal(result.delta.facts.shoppingDays.value,days,text);
    assert.equal(result.delta.facts.peopleCount,undefined,text);
  }
});

test('duration answers preserve bounds and do not mistake collective household words for days',()=>{
  for(const text of ['тридцать два','0','99']){
    const plan={question:'days',groups:[],people:4,days:null};
    const result=advanceGuidedIntake(plan,text,{facts:{},rejected:[],wishes:[],exceptions:[]});
    assert.ok(result.issue,text);
    assert.equal(plan.days,null,text);
  }
  const plan={question:'days',groups:[],people:4,days:null};
  const result=advanceGuidedIntake(plan,'четверо',{facts:{},rejected:[],wishes:[],exceptions:[]});
  assert.equal(plan.days,null);
  assert.equal(result.delta.facts.shoppingDays,undefined);
});


test('spoken and abbreviated thousands answer a pending total budget question',()=>{
  for(const [text,budget] of [['пять тысяч',500000],['тысяч пять',500000],['до десяти тысяч',1000000],
    ['пять тысяч рублей',500000],['примерно 5,5 тыс',550000],['около 25 тыс.',2500000],['999,99 тыс',99999000]]){
    const plan={question:'budget',groups:[],people:6,days:14,budgetMinor:undefined};
    const result=advanceGuidedIntake(plan,text,{facts:{},rejected:[],wishes:[],exceptions:[]});
    assert.equal(result.issue,undefined,text);
    assert.equal(plan.budgetMinor,budget,text);
    assert.equal(result.delta.facts.budgetMinor.value,budget,text);
    assert.equal(plan.people,6,text);
    assert.equal(plan.days,14,text);
  }
});

test('thousands do not become a budget out of context or overwrite a budget on invalid input',()=>{
  for(const question of ['people','days','constraints']){
    const plan={question,groups:[],people:4,days:10};
    const result=advanceGuidedIntake(plan,'пять тысяч',{facts:{},rejected:[],wishes:[],exceptions:[]});
    assert.equal(result.delta.facts.budgetMinor,undefined,question);
  }
  for(const text of ['0 тыс','1000 тыс','пять тысяч яблок']){
    const plan={question:'budget',groups:[],people:4,days:10,budgetMinor:500000};
    const result=advanceGuidedIntake(plan,text,{facts:{},rejected:[],wishes:[],exceptions:[]});
    assert.equal(plan.budgetMinor,500000,text);
    assert.equal(result.delta.facts.budgetMinor,undefined,text);
  }
});

test('only a pending budget question interprets a deferred amount as unknown',()=>{
  for(const text of ['Бюджет пока не решил','пока не знаю','сумму не определила','не решил пока','пока не определился','не знаю, но хочу фарш и яблоки','не знаю, без рыбы']){
    const plan={question:'budget',groups:[],people:4,days:10,budgetMinor:undefined};
    const result=advanceGuidedIntake(plan,text,{facts:{},rejected:[],wishes:[],exceptions:[]});
    assert.equal(plan.budgetMinor,null,text);assert.ok(result.delta.unset.includes('budgetMinor'),text);
    assert.equal(plan.people,4,text);assert.equal(plan.days,10,text);
  }
  const plan={question:'constraints',groups:[],people:4,days:10,budgetMinor:500000};
  const result=advanceGuidedIntake(plan,'пока не знаю',{facts:{},rejected:[],wishes:[],exceptions:[]});
  assert.equal(plan.budgetMinor,500000);assert.ok(!result.delta.unset.includes('budgetMinor'));
  const mixed={question:'budget',groups:[],people:4,days:10,budgetMinor:undefined};
  const wish=advanceGuidedIntake(mixed,'не знаю, но хочу фарш и яблоки',{facts:{},rejected:[],wishes:[],exceptions:[]});
  assert.deepEqual(mixed.groups.map(g=>g.key),['mince','apples']);assert.equal(wish.delta.directions,null);
  const blocked=advanceGuidedIntake({question:'budget',groups:[],people:4,days:10},'не знаю, без рыбы',{facts:{},rejected:[],wishes:[],exceptions:[]});
  assert.ok(blocked.delta.reject.includes('fish'));
  for(const text of ['не знаю, но бюджет 5000 рублей','не знаю, но бюджет пять тысяч рублей']){
    const pending={question:'budget',groups:[],people:4,days:10,budgetMinor:100000};
    const delta=advanceGuidedIntake(pending,text,{facts:{},rejected:[],wishes:[],exceptions:[]}).delta;
    assert.ok(!delta.unset.includes('budgetMinor'),text);assert.notEqual(pending.budgetMinor,null,text);
  }
  assert.equal(extractShoppingDelta('хочу фарш').directions,null);
  assert.equal(extractShoppingDelta('нужна быстрая готовка').directions,'quick');
});

test('mixed budget deferral keeps quantity and household numbers separate and respects negation',()=>{
 const memory={facts:{},rejected:[],wishes:[],exceptions:[]};
 for(const text of ['не знаю, без рыбы, нас 3','не знаю, но хочу фарш 2 кг']){
  const plan={question:'budget',groups:[],people:4,days:10,budgetMinor:undefined};
  const result=advanceGuidedIntake(plan,text,memory);assert.equal(plan.budgetMinor,null,text);
  assert.ok(result.delta.unset.includes('budgetMinor'),text);assert.deepEqual(result.delta.unresolved,[],text);
  if(text.includes('рыбы')) {assert.ok(result.delta.reject.includes('fish'));assert.equal(plan.people,3);}
  else assert.ok(plan.groups.some(g=>g.key==='mince'));
 }
 for(const [text,removed] of [['не знаю, но хочу не яблоки, а молоко','apples'],['не знаю, но хочу без молока','milk']]){
  const plan={question:'budget',groups:[{key:removed}],people:4,days:10,budgetMinor:undefined};
  const result=advanceGuidedIntake(plan,text,memory);
  assert.ok(result.delta.reject.includes(removed),text);assert.ok(!result.delta.want.includes(removed),text);
  assert.ok(!plan.groups.some(g=>g.key===removed),text);
  if(removed==='apples')assert.ok(plan.groups.some(g=>g.key==='milk'));
 }
});

test('mixed explicit or ambiguous budget amount is kept or explicitly clarified, never silently discarded',()=>{
 const memory={facts:{budgetMinor:{value:100000}},rejected:[],wishes:[],exceptions:[]};
 for(const text of ['не знаю, но бюджет пять тысяч рублей','не знаю, но примерно 5 тысяч','не знаю, 5000']){
  const plan={question:'budget',groups:[],people:4,days:10,budgetMinor:100000};
  const result=advanceGuidedIntake(plan,text,memory);
  assert.match(result.issue,/Уточни общий бюджет/u,text);assert.equal(plan.budgetMinor,100000,text);
 }
 const plan={question:'budget',groups:[],people:4,days:10,budgetMinor:100000};
 const result=advanceGuidedIntake(plan,'не знаю, но бюджет 5000 рублей',memory);
 assert.equal(result.issue,undefined);assert.equal(plan.budgetMinor,500000);
});

test('adjacent wishes and refusals keep their food scopes separate',()=>{
 const memory={facts:{},rejected:[],wishes:[],exceptions:[]};
 for(const [text,wanted,rejected] of [
  ['не знаю, хочу яблоки и не хочу молоко','apples','milk'],
  ['не знаю, но без яблок, хочу молоко','milk','apples'],
  ['не знаю, без яблок и хочу молоко','milk','apples'],
  ['не знаю, хочу яблоки, но не молоко','apples','milk']
 ]){
  const plan={question:'budget',groups:[],people:4,days:10,budgetMinor:undefined};
  const result=advanceGuidedIntake(plan,text,memory);
  assert.equal(result.issue,undefined,text);assert.equal(plan.budgetMinor,null,text);
  assert.ok(result.delta.reject.includes(rejected),text);assert.ok(!result.delta.reject.includes(wanted),text);
  assert.ok(plan.groups.some(g=>g.key===wanted),text);assert.ok(!plan.groups.some(g=>g.key===rejected),text);
 }
});

test('ambiguous food lists request clarification without mutating saved conditions',()=>{
 const memory={facts:{budgetMinor:{value:100000}},rejected:[],wishes:[],exceptions:[]};
 for(const text of ['не знаю, хочу все кроме молока','не знаю, не только яблоки, но и молоко','не знаю, хочу яблоки, молоко и бананы',
   'не знаю, хочу яблоки но молоко нет','не знаю, хочу молоко и не хочу молоко']){
  const plan={question:'budget',groups:[{key:'milk'},{key:'apples'}],people:4,days:10,budgetMinor:100000};
  const before=structuredClone(plan);const result=advanceGuidedIntake(plan,text,memory);
  assert.match(result.issue,/Уточни отдельно/u,text);assert.deepEqual(plan,before,text);
  assert.deepEqual(result.delta.reject,[],text);assert.deepEqual(result.delta.want,[],text);assert.deepEqual(result.delta.unset,[],text);
 }
});
