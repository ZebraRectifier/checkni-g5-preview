import assert from 'node:assert/strict';
import test from 'node:test';
import { SHOP_CATALOG } from '../src/data/shopCatalog.mjs';
import { createBasketStore } from '../src/state/basketStore.mjs';
import { createShoppingConversationFlow } from '../src/runtime/shoppingConversationFlow.mjs';
import { resolveHybridBasketProposal } from '../src/intelligence/hybridBasketResolver.mjs';
import * as interpreter from '../src/runtime/hybridBasketInterpreter.mjs';

function session() {
  const basket = createBasketStore({ storage: null });
  const flow = createShoppingConversationFlow({ basket, localCatalog: SHOP_CATALOG,
    preferenceStorage: null, loader: { load: async () => interpreter } });
  return { basket, flow };
}

test('an unknown real product is not automatically changed to its nearest spelling', async () => {
  const { basket, flow } = session();
  const state = await flow.run('2 пачки тофу');
  assert.deepEqual(basket.getSnapshot(), []);
  assert.equal(state.status, 'clarification');
  assert.match(state.presentation.message, /тофу/u);
  assert.match(state.presentation.message, /похож|совпад|уточн/iu);
});

test('the same protection applies inside a multi-product request', async () => {
  const { basket, flow } = session();
  await flow.run('2 бутылки кефира, хлеб, 3 пачки тофу');
  assert.deepEqual(basket.getSnapshot(), [], 'an unreviewed approximate row cannot ride an exact list');
});

test('a unique typo candidate requires review before any provider or mutation', async () => {
  let calls = 0;
  const result = await resolveHybridBasketProposal('маско 2', [
    { id: 'butter', name: 'Масло', unit: '180 г', category: 'dairy' }
  ], { requestAiProposal: async () => { calls++; throw new Error('must stay local'); } });
  assert.equal(result.kind, 'clarification');
  assert.equal(result.triggerReason, 'approximate_match');
  assert.equal(calls, 0);
});

test('a completed operation answers acknowledgement with the actual list, without reapplying', async () => {
  const { basket, flow } = session();
  const first = await flow.run('хочу 12 бутылок кефира');
  assert.equal(first.status, 'success');
  assert.match(first.presentation.headline, /добавлен|добавил/iu);
  const before = basket.getSnapshot();
  const reply = await flow.run('да');
  assert.doesNotMatch(reply.presentation.message, /черновика.*нет/iu);
  assert.match(reply.presentation.message, /12/u);
  assert.deepEqual(basket.getSnapshot(), before);
  await flow.run('да!');
  assert.deepEqual(basket.getSnapshot(), before);
});

test('an old receipt cannot claim a manually changed quantity is still present', async () => {
  const { basket, flow } = session();
  await flow.run('кефир 12');
  basket.setQuantity('kefir-1l', 6);
  const reply = await flow.run('да');
  assert.doesNotMatch(reply.presentation.message, /×12|12 бутыл/iu);
  assert.equal(basket.getSnapshot()[0].quantity, 6);
});
