import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {selectRetention,requireCompletePrFiles} from './dynamic-retention.mjs';
const id=n=>String(n).repeat(64),a=id(1),b=id(2),c=id(3),d=id(4),e=id(5);
const s=()=>({inventory:[a,b,c,d],baseline:[a],added:[b],active:c,live:[a,a],references:[],prReferences:[d,e]});
test('retains baseline, new stages, active, live and PR references present on main',()=>assert.deepEqual(selectRetention(s()),[a,b,c,d]));
test('retains literal references',()=>{const v=s();v.prReferences=[];v.references=[d];assert.ok(selectRetention(v).includes(d));});
test('rejects mixed live roots or unavailable active',()=>{for(const change of [v=>v.live=[a,b],v=>v.live=[a],v=>v.active=e]){const v=s();change(v);assert.throws(()=>selectRetention(v));}});
test('refuses missing baseline, stage, or explicit references',()=>{for(const key of ['baseline','added','references']){const v=s();v[key].push(e);assert.throws(()=>selectRetention(v),/required_release_missing/);}});
test('can process consecutive data-only runs without fixed PR snapshot',()=>assert.deepEqual(selectRetention(s()),selectRetention(s())));
test('keeps baseline even after live and active move',()=>{const v=s();v.live=[c,c];assert.ok(selectRetention(v).includes(a));});

test('rejects PR file responses at GitHub 3000 file limit',()=>{assert.equal(requireCompletePrFiles(Array(2999).fill({})).length,2999);assert.throws(()=>requireCompletePrFiles(Array(3000).fill({})),/possibly_truncated/);});
