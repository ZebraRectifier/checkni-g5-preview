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
