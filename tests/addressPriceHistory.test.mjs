import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {historySnapshots,priceSeries,mergeDeliverySnapshot,validDeliverySnapshot} from '../src/observations/addressPriceHistory.mjs';
import {parseDeliveryProduct,addressMatches} from '../tools/okey-public-catalog/eda-parser.mjs';
const persisted=JSON.parse(await readFile(new URL('../src/data/okeyDeliveryHistory.json',import.meta.url)));
const bundle={version:1,snapshots:[persisted.snapshots[0]]};
const seed=bundle.snapshots[0], address=seed.selectedDeliveryAddress, sku=seed.products[0].sourceProductId;
const nowMs=Date.parse('2026-10-06T12:00:00Z');

test('observed seed validates; parser preserves source prices and keeps loyalty unknown',()=>{
  assert.equal(historySnapshots(persisted).length,persisted.snapshots.length);
  for(const p of seed.products){
    const parsed=parseDeliveryProduct(p,'Молоко, яйца');
    assert.equal(parsed.displayedPriceKopeks,p.displayedPriceKopeks);
    assert.equal(parsed.referenceOldPriceKopeks,p.referenceOldPriceKopeks);
    assert.equal(parsed.priceWithCardKopeks,null);assert.equal(parsed.priceWithoutCardKopeks,null);
  }
  assert.ok(addressMatches('проспект Мира , 211к2'));
  assert.equal(addressMatches('проспект Мира, 211к1'),false);
  assert.equal(addressMatches('проспект Мира, 211к20'),false);
  assert.equal(parseDeliveryProduct({...seed.products[0],displayedText:'Цена неизвестна'},'x'),null);
});
test('one observation is one point, never use crossed-out price as history',()=>{
  const series=priceSeries(bundle,address,sku,{nowMs});
  assert.equal(series.length,1);assert.equal(series[0].priceMinor,seed.products[0].displayedPriceKopeks);
  assert.deepEqual(priceSeries(bundle,'Другой адрес',sku,{nowMs}),[]);
});
test('subsequent refresh appends history without overwriting source or mixing addresses',()=>{
  const next=structuredClone(seed);next.observedDate='2026-10-06';next.products[0].displayedPriceKopeks+=100;
  const merged=mergeDeliverySnapshot(bundle,next);
  assert.equal(priceSeries(merged,address,sku,{nowMs}).length,2);
  assert.equal(seed.products[0].displayedPriceKopeks,bundle.snapshots[0].products[0].displayedPriceKopeks);
  assert.equal(mergeDeliverySnapshot(merged,next),merged);
  const other=structuredClone(next);other.selectedDeliveryAddress='Другой адрес';
  assert.equal(priceSeries(mergeDeliverySnapshot(merged,other),address,sku,{nowMs}).length,2);
});
test('future observations, period exclusions and equal-time conflicts cannot invent trend',()=>{
  const conflict=structuredClone(seed);conflict.products[0].displayedPriceKopeks+=100;
  assert.deepEqual(priceSeries({version:1,snapshots:[seed,conflict]},address,sku,{nowMs}),[]);
  assert.throws(()=>mergeDeliverySnapshot(bundle,conflict),/Conflicting/);
  assert.deepEqual(priceSeries(bundle,address,sku,{nowMs:Date.parse('2026-10-04')}),[]);
  assert.deepEqual(priceSeries(bundle,address,sku,{days:7,nowMs:Date.parse('2026-11-01')}),[]);
});
test('wrong source, duplicate SKU, malformed dates and physical-store inference are rejected',()=>{
  for(const mutation of [
    s=>s.salesChannel='physical-store',s=>s.physicalStoreId='okey-180',s=>s.products[0].priceWithoutCardKopeks=100,
    s=>s.observedDate='2026-02-30',s=>s.products.push(s.products[0]),s=>s.products[0].displayedPriceKopeks=0,
    s=>s.products[0].productUrl='https://attacker.example/price']){
    const altered=structuredClone(seed);mutation(altered);assert.equal(validDeliverySnapshot(altered),false);
  }
});
