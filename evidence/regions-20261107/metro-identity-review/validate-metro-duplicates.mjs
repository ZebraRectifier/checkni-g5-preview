import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import { createHash } from 'node:crypto';
const report = JSON.parse(fs.readFileSync(new URL('./metro-duplicate-resolution.json', import.meta.url)));
const read = file => fs.readFileSync(new URL(file, import.meta.url));
const hash = file => createHash('sha256').update(read(file)).digest('hex');
const textHash = file => createHash('sha256').update(read(file).toString('utf8').replaceAll('\r\n', '\n')).digest('hex');
const ids = new Set();
for (const decision of report.decisions) {
  assert(!ids.has(decision.reviewId)); ids.add(decision.reviewId);
  const { identityProof: proof, officialRow, osmObject, sourceEvidence } = decision;
  assert.equal(proof.officialStoreId, String(officialRow.officialId));
  assert.equal(proof.mailboxStoreCode, String(officialRow.officialId));
  assert.equal(proof.mapBusinessMailbox, osmObject.tags['contact:email']);
  assert.equal(decision.existingId, 'official:metro:' + officialRow.officialId);
  assert.equal(textHash(sourceEvidence.extractedProof), sourceEvidence.extractedProofTrackedSha256);
  assert.equal(hash(sourceEvidence.officialSnapshot), sourceEvidence.officialSnapshotCompressedSha256);
  assert.equal(createHash('sha256').update(gunzipSync(read(sourceEvidence.officialSnapshot))).digest('hex'), sourceEvidence.officialSnapshotSha256);
  assert.equal(textHash(sourceEvidence.officialParsed), sourceEvidence.officialParsedTrackedSha256);
  const raw = JSON.parse(read(sourceEvidence.extractedProof));
  assert.deepEqual(raw.objects[decision.reviewId], osmObject);
  const official = JSON.parse(read(sourceEvidence.officialParsed));
  assert.equal(official.filter(row => row.officialId === officialRow.officialId).length, 1);
  assert.deepEqual(official.find(row => row.officialId === officialRow.officialId), officialRow);
  assert(proof.osmStreet && /\d/u.test(proof.osmHouse));
  if (osmObject.tags['not:brand:wikidata'])
    assert.equal(decision.decision, 'held-conflicting-map-identity-tags');
  else assert.equal(decision.decision, 'already-represented-in-cached-sources');
  assert.match(decision.runtimeAction, /^none/u);
  assert.match(decision.catalogueAction, /^none/u);
}
assert.equal(ids.size, 12);
assert.equal(report.decisions.filter(row => row.decision === 'already-represented-in-cached-sources').length, 11);
assert.equal(report.otherHeld[0].sourceId, 900015);
assert.equal(report.summary.queueIfLedgerAccepted, 731);
assert.equal(report.summary.addedStores, 0);
console.log('METRO_CACHED_REVIEW_OK: 11 already represented, 1 conflicting map identity, 1 separate locality hold; no runtime changes');
