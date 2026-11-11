import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {planRetention} from './retention-plan.mjs';
const id=n=>String(n).repeat(64), a=id(1),b=id(2),c=id(3),d=id(4),e=id(5);
const sample=()=>({inventory:[a,b,c,d,e],active:a,deployed:b,previous:c,staged:[a,d],published:[b,c,e],references:[e]});
test('retains active, live, rollback, all staged and references',()=>assert.deepEqual(planRetention(sample()),{keep:[a,b,c,d,e],omitted:[]}));
test('only classified unreferenced historical release can be omitted',()=>{const s=sample();s.references=[];assert.deepEqual(planRetention(s).omitted,[e]);});
test('refuses unclassified, double-classified and unknown releases',()=>{for(const change of [s=>s.staged.pop(),s=>s.published.push(d),s=>s.references.push(id(6))]){const s=sample();change(s);assert.throws(()=>planRetention(s));}});
test('requires confirmed live and previous deployments',()=>{for(const key of ['deployed','previous']){const s=sample();s[key]=d;assert.throws(()=>planRetention(s));}});
test('stage before activation retains both old and new',()=>{const s=sample();s.active=b;assert.ok(planRetention(s).keep.includes(a));});
test('unknown release after stage blocks filtering',()=>{const s=sample();s.inventory.push(id(6));assert.throws(()=>planRetention(s));});
test('rejects duplicate and malformed ids',()=>{for(const change of [s=>s.inventory.push(a),s=>s.active='bad']){const s=sample();change(s);assert.throws(()=>planRetention(s));}});

test('retains rollback even if it is not active or directly referenced',()=>{const s=sample();s.references=[];assert.ok(planRetention(s).keep.includes(c));});
test('previous distinct from actual live retained across activation',()=>{const s=sample();s.active=a;s.deployed=b;s.previous=c;const p=planRetention(s);assert.ok([a,b,c].every(v=>p.keep.includes(v)));});
test('cannot omit an explicit reference after publication',()=>{const s=sample();assert.ok(planRetention(s).keep.includes(e));});
test('refuses duplicate staged or published lifecycle entries',()=>{for(const key of ['staged','published']){const s=sample();s[key].push(s[key][0]);assert.throws(()=>planRetention(s));}});
