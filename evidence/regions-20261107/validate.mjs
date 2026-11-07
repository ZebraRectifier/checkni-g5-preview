import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createNearbyShoppingPort } from '../../src/ports/nearbyShoppingPort.mjs';

const root = new URL('../../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = await read('./baseline-manifest.json');
const manifest = await read('./source-manifest.json');
const coverage = await read('./coverage.json');
const review = await read('./review.json');
const allIds = new Set();
const additionsIds = new Set();

function ringContains([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj)
      && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function contains(point, geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.some(([outer, ...holes]) => ringContains(point, outer) && !holes.some(hole => ringContains(point, hole)));
}
function distance(a, b) {
  const r = Math.PI / 180, p = a.lat * r, q = b.lat * r;
  const h = Math.sin((q-p)/2)**2 + Math.cos(p)*Math.cos(q)*Math.sin((b.lon-a.lon)*r/2)**2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

for (const [slug, original] of Object.entries(baseline.cities)) {
  const data = JSON.parse(await readFile(new URL(`src/data/nearby-regions/${slug}.json`, root), 'utf8'));
  const extra = data.stores.slice(original.originalCount);
  const source = manifest.cities[slug];
  const rawById = new Map();
  const datesById = new Map();
  const boundaryBytes = gunzipSync(await readFile(new URL(source.boundary.file, import.meta.url)));
  assert.equal(sha(boundaryBytes), source.boundary.sha256);
  const boundary = JSON.parse(boundaryBytes).geometry;
  let rawCount = 0;
  for (const receipt of source.receipts) {
    const zipped = await readFile(new URL(receipt.file, import.meta.url));
    assert.equal(sha(zipped), receipt.gzipSha256);
    const bytes = gunzipSync(zipped);
    assert.equal(sha(bytes), receipt.sha256);
    assert.equal(bytes.length, receipt.bytes);
    assert.equal(receipt.httpStatus, 200);
    assert.equal(receipt.url, manifest.apiUrl);
    assert.equal(receipt.request.filters.query, data.city);
    const body = JSON.parse(bytes);
    for (const item of body.data) {
      const id = String(item.externalId.storeCode);
      if (rawById.has(id)) {
        assert.deepEqual(item.coordinates, rawById.get(id).coordinates, id);
        assert.equal(item.address, rawById.get(id).address, id);
      } else { rawById.set(id, item); datesById.set(id, receipt.observedAt); }
    }
    rawCount += body.data.length;
  }

  test(`${slug}: every existing ID, record and source is preserved`, () => {
    assert.equal(data.stores.length, original.originalCount + coverage[slug].safeAdditionsPrepared);
    assert.deepEqual(data.stores.slice(0, original.originalCount).map(row => ({ id: row.id, sha256: sha(JSON.stringify(row)) })), original.records);
    for (const [key, value] of Object.entries(original.originalMetadata)) assert.deepEqual(data[key], value, key);
    assert.deepEqual(data.sources.slice(0, original.originalSources.length), original.originalSources);
    assert.equal(data.sources.length, original.originalSources.length + 1);
    assert.equal(data.exhaustive, false);
    assert.equal(data.priceEvidence, false);
    assert.equal(rawCount, coverage[slug].rawReceived);
    assert.equal(rawById.size, coverage[slug].uniqueSourceIds);
    for (const row of data.stores) {
      assert.ok(!allIds.has(row.id), `Cross-city ID collision: ${row.id}`);
      allIds.add(row.id);
    }
  });

  test(`${slug}: additions are official active offline food stores inside city boundaries`, () => {
    for (const row of extra) {
      const raw = rawById.get(row.sourceStoreId);
      assert.ok(raw, row.id);
      assert.equal(raw.isActive, true);
      assert.equal(raw.status, 'STATUS_ACTIVE');
      assert.ok(raw.deliveryTypeList.includes('DELIVERY_TYPE_OFFLINE'));
      assert.ok(['MM','MM_MINI','GM'].includes(raw.storeTypeV2));
      assert.equal(row.id, 'official:magnit:' + raw.externalId.storeCode);
      assert.equal(row.address, raw.address.replace(/\s+/gu,' ').trim());
      assert.equal(row.lat, raw.coordinates.latitude);
      assert.equal(row.lon, raw.coordinates.longitude);
      assert.ok(contains([row.lon,row.lat], boundary), row.id);
      assert.equal(row.city, data.city);
      assert.equal(row.observedAt, datesById.get(row.sourceStoreId));
      assert.ok(Number.isFinite(Date.parse(row.observedAt)));
      assert.equal(row.verification, 'official-listed');
      assert.equal(row.coordinateEvidence, 'official-roster');
      assert.equal(row.sourceUrl, manifest.sourcePage);
      assert.match(row.address, /(?:,\s*(?:д\.?|дом|зд\.?|здание|стр\.?|строение)?\s*\d+[а-яa-z]*(?:[/ -]\d+[а-яa-z]*)*(?:\s|,|$)|(?<!\p{L})(?:д|дом|зд|здание|стр|строение)\.?\s*\d+)/iu);
      for (const key of ['catalogBinding','price','priceMinor','stock','availability','catalog','catalogUrl']) assert.ok(!(key in row), key);
      additionsIds.add(row.id);
    }
  });

  test(`${slug}: uncertain neighbours remain outside runtime; no close duplicate additions`, () => {
    const ids = new Set(extra.map(row => row.id));
    for (const entry of review[slug].possibleDuplicates) assert.ok(!ids.has(entry.official.id), entry.official.id);
    for (const row of extra) {
      for (const old of data.stores.slice(0, original.originalCount)) {
        if (old.retailerId === row.retailerId) assert.ok(distance(row,old) > 100, `${row.id} too near ${old.id}`);
      }
      for (const other of extra) if (other.id !== row.id) assert.ok(distance(row,other) > 60, `${row.id} near ${other.id}`);
    }
  });

  test(`${slug}: existing bounded directory loader accepts updated JSON without catalogue claims`, async () => {
    const port = createNearbyShoppingPort({ fetchImpl: async url => {
      assert.ok(String(url).endsWith(`/nearby-regions/${slug}.json`));
      return Response.json(data);
    } });
    const loaded = await port.regionalDirectory(slug);
    assert.equal(loaded.stores.length, coverage[slug].afterPreparedCount);
    assert.equal(loaded.stores.filter(row => row.catalogBinding != null).length, 0);
  });
}

test('release totals and administrative geometry guard are explicit', () => {
  assert.equal(Object.values(coverage).reduce((sum,r) => sum + r.safeAdditionsPrepared,0),642);
  assert.equal(Object.values(coverage).reduce((sum,r) => sum + r.possibleDuplicatesHeld,0),631);
  assert.equal(Object.values(coverage).reduce((sum,r) => sum + r.existingPublished,0),2897);
  assert.equal(Object.values(coverage).reduce((sum,r) => sum + r.afterPreparedCount,0),3539);
  assert.equal(additionsIds.size,642);
  assert.equal(allIds.size,3539);
  assert.equal(contains([1,1],{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[2,2],[3,2],[3,3],[2,3],[2,2]]]}),true);
  assert.equal(contains([2.5,2.5],{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[2,2],[3,2],[3,3],[2,3],[2,2]]]}),false);
  assert.equal(contains([37.6,55.7],{type:'Polygon',coordinates:[[[48,55],[50,55],[50,56],[48,56],[48,55]]]}),false);
});
