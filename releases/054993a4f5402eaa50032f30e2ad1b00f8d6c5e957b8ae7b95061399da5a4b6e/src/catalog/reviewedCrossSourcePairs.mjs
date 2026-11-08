// Explicit source-SKU counterparts only. This establishes product/pack
// identity for discovery; it never carries price, freshness, stock or a winner.
const PAIRS = Object.freeze([
  Object.freeze({
    magnit: '1349400001',
    perekrestok: 'fb3574cb-eba6-47a1-9932-30da895354fb'
  }),
  Object.freeze({
    magnit: '1899800733',
    perekrestok: '09fe3ce5-77db-4edd-ab53-18beabd501ba'
  }),
  Object.freeze({
    magnit: '1000151468',
    perekrestok: '3efc55a2-9305-410b-97ea-0620d9fadd71'
  }),
  Object.freeze({
    magnit: '1000461809',
    perekrestok: '246ec37a-906a-4dc2-a03e-907953cf0e2a'
  })
]);

export function reviewedCrossSourceCounterpart({ retailerId, sourceProductId }, targetRetailerId) {
  if (!['magnit', 'perekrestok'].includes(retailerId)
    || !['magnit', 'perekrestok'].includes(targetRetailerId)
    || retailerId === targetRetailerId
    || typeof sourceProductId !== 'string') return null;
  const pair = PAIRS.find(row => row[retailerId] === sourceProductId);
  return pair?.[targetRetailerId] ?? null;
}
