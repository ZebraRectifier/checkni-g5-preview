import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceGuidedIntake} from '../src/intelligence/guidedShoppingPlan.mjs';
import {suggestedCatalogQuantity, economicalCatalogCards} from '../src/core/catalogDraft.mjs';

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
  for(const text of ['Бюджет пока не решил','пока не знаю','сумму не определила','не решил пока']){
    const plan={question:'budget',groups:[],people:4,days:10,budgetMinor:undefined};
    const result=advanceGuidedIntake(plan,text,{facts:{},rejected:[],wishes:[],exceptions:[]});
    assert.equal(plan.budgetMinor,null,text);assert.ok(result.delta.unset.includes('budgetMinor'),text);
    assert.equal(plan.people,4,text);assert.equal(plan.days,10,text);
  }
  const plan={question:'constraints',groups:[],people:4,days:10,budgetMinor:500000};
  const result=advanceGuidedIntake(plan,'пока не знаю',{facts:{},rejected:[],wishes:[],exceptions:[]});
  assert.equal(plan.budgetMinor,500000);assert.ok(!result.delta.unset.includes('budgetMinor'));
});
