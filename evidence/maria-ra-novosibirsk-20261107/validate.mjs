import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {derivedMariaRaId,normalizedMariaRaAddressKey} from './normalize-address.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function inRing([x,y],ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
export function withinCity(point,geometry){
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.some(([outer,...holes])=>inRing(point,outer)&&!holes.some(h=>inRing(point,h)));
}
export async function verifyPacket(){
  const [packet,held,ledger,summary,boundary,baseline,receipt,indexed,runtime]=await Promise.all([
    'accepted-candidates.json','held-candidates.json','decisions.json','summary.json','source/city-boundary.geojson',
    'source/published-city-baseline.json','source/official-city-rows.json','source/official-city-rows-with-index.json',
    '../../src/data/nearby-regions/novosibirsk.json'
  ].map(json));
  const expectedSource='dfb8d6dc6e2e8d4a0639f2dd45dd176684ecaf378a4dc6cf67cbe77f51e3d5e1';
  assert.equal(summary.originalOfficialHtml.sha256,expectedSource);
  assert.equal(indexed.totalPageRows,1336);assert.equal(indexed.rows.length,205);
  assert.deepEqual(indexed.rows.map(({sourceRowIndex,...row})=>row),receipt.rows);
  const sourceRows=new Map(indexed.rows.map(r=>[r.sourceRowIndex,r]));
  assert.equal(packet.region,'novosibirsk');assert.equal(packet.exhaustive,false);assert.equal(packet.priceEvidence,false);
  assert.equal(packet.publicationReady,false);assert.equal(packet.observedAt,receipt.checkedAt);
  assert.equal(packet.stores.length,201);assert.equal(held.length,0);assert.equal(ledger.length,201);
  assert.equal(summary.duplicateRowsCollapsed,4);
  assert.equal(ledger.reduce((n,r)=>n+r.sourceRowIndexes.length,0),205);
  assert.equal(new Set(ledger.flatMap(r=>r.sourceRowIndexes)).size,205);
  assert.equal(new Set(packet.stores.map(x=>x.id)).size,201);
  assert.equal(new Set(packet.stores.map(x=>x.idDerivation.normalizedAddressKey)).size,201);
  for(const r of packet.stores){
    assert.equal(r.retailerId,'maria-ra');assert.equal(r.city,'Новосибирск');
    assert.equal(r.sourceStoreId,null);assert.equal(r.idKind,'derived-address-hash');
    assert.equal(r.sourceUrl,'https://www.maria-ra.ru/');assert.equal(r.observedAt,receipt.checkedAt);
    assert.equal(r.coordinateAccuracy,'not-stated-by-source');assert.equal(r.coordinateEvidence,'official-directory-map-point');
    assert.equal(r.openingStatus,'unknown');assert.equal(r.catalogueStatus,'not-connected');assert.equal(r.priceEvidence,false);
    assert.equal(r.verification,'official-listed');assert.equal(r.catalogBinding,undefined);
    assert(Number.isFinite(r.lat)&&Number.isFinite(r.lon));assert(withinCity([r.lon,r.lat],boundary.geometry));
    assert(r.provenance.boundaryDistanceMeters>=20);assert.equal(r.provenance.sourceSha256,expectedSource);
    assert(!r.provenance.cachedExactAddressMatches.length||r.provenance.cachedExactAddressMatches[0].distanceMeters<=250);
    for(const index of r.provenance.sourceRowIndexes){
      const raw=sourceRows.get(index);assert(raw);
      assert.match(raw.NAME,/^г\.?\s*Новосибирск\s*,/iu);
      assert(r.provenance.originalAddresses.includes(raw.NAME));
      assert.deepEqual(raw.COORDINATE.split(',').map(Number),[r.lat,r.lon]);
      assert.equal(normalizedMariaRaAddressKey(raw.NAME),r.idDerivation.normalizedAddressKey);
      assert.equal(derivedMariaRaId(raw.NAME),r.id);
    }
    const decision=ledger.find(d=>d.id===r.id);assert.equal(decision.status,'accepted-geographic-candidate');assert.deepEqual(decision.reasons,[]);
  }
  assert.equal(baseline.stores.length,350);assert.equal(runtime.stores.length,551);
  assert.deepEqual(runtime.stores.slice(0,350),baseline.stores);
  assert.deepEqual(runtime.sources.slice(0,baseline.sources.length),baseline.sources);
  assert.equal(runtime.region,'novosibirsk');assert.equal(runtime.exhaustive,false);assert.equal(runtime.priceEvidence,false);
  assert.equal(new Set(runtime.stores.map(r=>r.id)).size,551);
  for(const r of runtime.stores.slice(350)){
    const full=packet.stores.find(candidate=>candidate.id===r.id);assert(full);
    for(const [key,value] of Object.entries(r))assert.deepEqual(value,full[key],r.id+':'+key);
    assert.equal(r.catalogBinding,undefined);assert.equal(r.priceMinor,undefined);assert.equal(r.storeId,undefined);
  }
  assert.equal(baseline.stores.filter(x=>x.retailerId==='maria-ra').length,0);
  for(const [file,manifest] of Object.entries(summary.sourceManifest)){
    const text=(await readFile(new URL('source/'+file,import.meta.url),'utf8')).replaceAll('\r\n','\n');
    assert.equal(hash(text),manifest.sha256);assert.equal(Buffer.byteLength(text),manifest.bytesLF);
  }
  return {ok:true,before:350,added:201,after:551,held:0,duplicateSourceRows:4,networkRequests:0};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await verifyPacket()));
