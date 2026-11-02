import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceGuidedIntake} from '../src/intelligence/guidedShoppingPlan.mjs';

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
