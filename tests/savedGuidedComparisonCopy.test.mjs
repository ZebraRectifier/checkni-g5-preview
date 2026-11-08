import test from 'node:test';
import assert from 'node:assert/strict';
import {savedComparisonQuantityBasis} from '../src/components/SavedGuidedComparison.mjs';

test('guided saved comparison explains whole-pack recalculation without changing manual-list copy',()=>{
  assert.equal(savedComparisonQuantityBasis({request:{version:1}}),
    'Считаем объём сохранённой корзины. В другом магазине может понадобиться больше упаковок.');
  assert.equal(savedComparisonQuantityBasis({request:{version:2}}),'По количествам из списка.');
  assert.equal(savedComparisonQuantityBasis(null),'По количествам из списка.');
});
