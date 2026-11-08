import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicDataUrl} from '../src/ports/publicDataUrl.mjs';
const root='https://zebrarectifier.github.io/checkni-g5-preview';
const id='a'.repeat(64);
for(const name of ['nearbyGroceryStores.json','okeyPublishedPromotions.json','nearby-regions/kazan.json']) {
 test(`mutable ${name} stays current from root and versioned modules`,()=>{
  const expected=`${root}/src/data/${name}`;
  assert.equal(publicDataUrl(name,`${root}/src/ports/publicDataUrl.mjs`).href,expected);
  assert.equal(publicDataUrl(name,`${root}/releases/${id}/src/ports/publicDataUrl.mjs`).href,expected);
 });
}
test('public data lookup rejects arbitrary paths and malformed release identity',()=>{
 for(const name of ['../secret.json','https://example.org/x','nearby-regions/unknown.json'])assert.throws(()=>publicDataUrl(name));
 assert.throws(()=>publicDataUrl('nearbyGroceryStores.json',`${root}/releases/not-a-hash/src/ports/publicDataUrl.mjs`));
});
