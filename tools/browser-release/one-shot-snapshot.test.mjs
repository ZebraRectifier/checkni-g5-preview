import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {checkSnapshot} from './one-shot-snapshot.mjs';
const a='a'.repeat(64), b='b'.repeat(64);
function sample(){return {inventory:{releases:[a,b],priorMain:'old',live:b,openPRs:[{number:3,head:'x'}]},active:a,parent:'old',main:true,prs:[{number:3,head:'x'}],live:[b,b]};}
test('happy path accepts exact reviewed snapshot',()=>assert.equal(checkSnapshot(sample()),true));
test('rejects stale main parent',()=>{const s=sample();s.parent='new';assert.throws(()=>checkSnapshot(s),/main_parent_changed/);});
test('rejects changed, missing and mixed live pages',()=>{for(const live of [[a,a],[b],[a,b]]){const s=sample();s.live=live;assert.throws(()=>checkSnapshot(s),/live_snapshot_changed/);}});
test('rejects changed head, added and removed open PR',()=>{for(const prs of [[{number:3,head:'z'}],[{number:3,head:'x'},{number:4,head:'y'}],[]]){const s=sample();s.prs=prs;assert.throws(()=>checkSnapshot(s),/open_pr_snapshot_changed/);}});
test('rejects active release absent from retained set',()=>{const s=sample();s.active='c'.repeat(64);assert.throws(()=>checkSnapshot(s),/active_not_retained/);});
