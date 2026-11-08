import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyPacket,withinCity} from '../evidence/maria-ra-novosibirsk-20261107/validate.mjs';
import {derivedMariaRaId,normalizedMariaRaAddressKey} from '../evidence/maria-ra-novosibirsk-20261107/normalize-address.mjs';
import {nearbyRegionForPosition} from '../src/intelligence/nearbyRegions.mjs';
import {directoryAddressCandidates} from '../src/ports/addressRecovery.mjs';

test('Maria-Ra packet is additive, reproduces original source rows and preserves the previous 350 addresses',async()=>{
  assert.deepEqual(await verifyPacket(),{ok:true,before:350,added:201,after:551,held:0,duplicateSourceRows:4,networkRequests:0});
});

test('evidence normalizer unifies only formatting and preserves house, letter and other-city distinctions',()=>{
  const a='г. Новосибирск, ул.Плющихинская, 6',b='г. Новосибирск, ул Плющихинская, д. 6';
  assert.equal(derivedMariaRaId(a),derivedMariaRaId(b));
  assert.notEqual(derivedMariaRaId(a),derivedMariaRaId(a+'0'));
  assert.notEqual(derivedMariaRaId(a),derivedMariaRaId(a+'а'));
  assert.notEqual(derivedMariaRaId(a),derivedMariaRaId(a+'/1'));
  assert.equal(normalizedMariaRaAddressKey('г. Барнаул, ул. Новосибирская, 6'),null);
  assert.throws(()=>derivedMariaRaId('г. Москва, Плющихинская 6'),/unsupported_source_city/u);
  assert(!withinCity([1.5,1.5],{type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[0,3],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]]}));
});

test('all 201 additions stay in Novosibirsk, searchable as landmarks and never promise a catalogue',async()=>{
  const data=JSON.parse(await readFile(new URL('../src/data/nearby-regions/novosibirsk.json',import.meta.url)));
  const additions=data.stores.filter(r=>r.retailerId==='maria-ra');assert.equal(additions.length,201);
  for(const row of additions){
    assert.equal(nearbyRegionForPosition(row)?.id,'novosibirsk');
    assert.equal(row.catalogBinding,undefined);assert.equal(row.priceMinor,undefined);
    assert.notEqual(nearbyRegionForPosition(row)?.id,'moscow-and-oblast');
  }
  // Host admission belongs to the separately released runtime and its tests.
  // This data-only check must not depend on an old mutable source copy.
  const search=directoryAddressCandidates(data.stores,'Новосибирск Плющихинская 6',{acceptPosition:r=>nearbyRegionForPosition(r)?.id==='novosibirsk'});
  assert(search.some(r=>r.label==='Мария-Ра · Новосибирск, ул. Плющихинская, 6'));
  assert(search.every(r=>r.precision==='store'&&!r.catalogBinding&&!r.priceMinor));
});
