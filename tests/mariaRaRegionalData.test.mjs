import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nearbyRegionForPosition} from '../src/intelligence/nearbyRegions.mjs';
import {directoryAddressCandidates} from '../src/ports/addressRecovery.mjs';

test('the active runtime keeps all 201 Maria-Ra additions in Novosibirsk without promising a catalogue',async()=>{
  const data=JSON.parse(await readFile(new URL('../src/data/nearby-regions/novosibirsk.json',import.meta.url)));
  assert.equal(data.stores.length,551);
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
