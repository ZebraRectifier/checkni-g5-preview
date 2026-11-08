// Explicit source-SKU counterparts only. This establishes product/pack
// identity for discovery; it never carries price, freshness, stock or a winner.
const PAIRS = Object.freeze([
  Object.freeze({
    magnit: '1349400001',
    perekrestok: 'fb3574cb-eba6-47a1-9932-30da895354fb'
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
