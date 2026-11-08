import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('published five-city coverage receipt matches geography-only data',()=>{
  const output=execFileSync(process.execPath,['evidence/regional-coverage-20261108/validate.mjs'],{encoding:'utf8'});
  assert.deepEqual(JSON.parse(output),{
    status:'verified-regional-coverage',cities:5,stores:3744,networks:9
  });
});
