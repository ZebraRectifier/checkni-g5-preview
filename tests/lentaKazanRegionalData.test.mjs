import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nearbyGroceryMatches} from '../src/intelligence/nearbyShopping.mjs';
import {nearbyRegionForPosition} from '../src/intelligence/nearbyRegions.mjs';
import {directoryAddressCandidates} from '../src/ports/addressRecovery.mjs';

const directory=JSON.parse(await readFile(new URL('../src/data/nearby-regions/kazan.json',import.meta.url)));
const receipt=JSON.parse(await readFile(new URL('../evidence/lenta-kazan-20261108/receipt.json',import.meta.url)));
const additions=directory.stores.filter(row=>['official:lenta:0221','official:lenta:0307'].includes(row.id));

test('two reviewed Lenta stores are added without changing the geography-only contract',()=>{
  assert.equal(directory.stores.length,637);
  assert.equal(additions.length,2);
  assert.deepEqual(additions.map(row=>row.sourceStoreId),['0221','0307']);
  assert.equal(new Set(directory.stores.map(row=>row.id)).size,directory.stores.length);
  for(const row of additions){
    assert.equal(row.retailerId,'lenta');
    assert.equal(row.city,'Казань');
    assert.equal(nearbyRegionForPosition(row)?.id,'kazan');
    assert.match(row.sourceUrl,/^https:\/\/www\.openstreetmap\.org\/(?:relation|way)\/\d+$/u);
    assert.match(row.officialAddressEvidenceUrl,/^https:\/\/lenta\.com\//u);
    assert(!('catalogBinding' in row));
    assert(!('priceMinor' in row));
    assert(!('stock' in row));
    assert.match(row.coordinateAccuracy,/not-entrance$/u);
  }
  assert.equal(receipt.catalogBindings,0);
  assert.equal(receipt.priceEvidence,false);
});

test('official IDs, addresses and coordinate provenance reproduce the evidence receipt',()=>{
  for(const evidence of receipt.stores){
    const row=additions.find(item=>item.sourceStoreId===evidence.officialStoreId);
    assert(row);
    assert.equal(row.address,evidence.address);
    assert.equal(row.lat,evidence.lat);
    assert.equal(row.lon,evidence.lon);
    assert.equal(row.coordinateObservedAt,evidence.coordinateObservedAt);
    assert.equal(row.coordinateObjectVersion,evidence.coordinateObjectVersion);
    assert.equal(row.sourceUrl,evidence.coordinateEvidenceUrl);
    assert.equal(row.currentTenantEvidenceUrl,evidence.currentTenantEvidenceUrl);
  }
});

test('both stores pass regional admission and exact-address search without catalogues',()=>{
  for(const row of additions){
    const nearby=nearbyGroceryMatches(directory.stores,row,1,{regional:true});
    const match=nearby.find(item=>item.id===row.id);
    assert(match);
    assert.equal(match.catalog,null);
    const query=`Казань ${row.address.split(', ').slice(1).join(' ')}`;
    const results=directoryAddressCandidates(directory.stores,query,{acceptPosition:point=>nearbyRegionForPosition(point)?.id==='kazan'});
    assert(results.some(result=>result.label===`Лента · ${row.address}`));
  }
});

test('new Lenta rows neither duplicate an existing address nor claim exact entrances',()=>{
  const addressKey=value=>value.toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  for(const row of additions){
    const duplicates=directory.stores.filter(item=>item.retailerId==='lenta'&&addressKey(item.address)===addressKey(row.address));
    assert.deepEqual(duplicates.map(item=>item.id),[row.id]);
    assert.notEqual(row.coordinateAccuracy,'entrance');
  }
});
