import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { historySnapshots, observationTime } from '../../src/observations/addressPriceHistory.mjs';

export const DELIVERY_ADDRESS = 'Москва, проспект Мира, 211к2';
const BASELINE = new URL('../../.okey-refresh-start.json', import.meta.url);
const STATUS = new URL('../../src/data/okeyDeliveryRefresh.json', import.meta.url);
const HISTORY = new URL('../../src/data/okeyDeliveryHistory.json', import.meta.url);

// A green deploy or a new attempt timestamp does not establish new price evidence.
export function verifyFreshRefresh({ startedAt, status, history, nowMs = Date.now() }) {
  const start = Date.parse(startedAt);
  const attempt = Date.parse(status?.lastAttemptAt);
  if (!Number.isFinite(start) || start > nowMs) return { fresh: false, reason: 'invalid-start' };
  if (status?.status !== 'collected') return {
    fresh: false, reason: status?.status === 'blocked' ? 'source-blocked' : 'collection-unavailable'
  };
  if (status.selectedDeliveryAddress !== DELIVERY_ADDRESS) return { fresh: false, reason: 'wrong-address' };
  if (!Number.isFinite(attempt) || attempt < start || attempt > nowMs) return { fresh: false, reason: 'stale-attempt' };
  const snapshot = historySnapshots(history).filter(s => s.selectedDeliveryAddress === DELIVERY_ADDRESS
    && observationTime(s) >= attempt && observationTime(s) <= nowMs).at(-1);
  if (!snapshot) return { fresh: false, reason: 'no-fresh-snapshot' };
  if (status.uniqueProducts !== snapshot.products.length) return { fresh: false, reason: 'product-count-mismatch' };
  if (!snapshot.products.every(p => Number.isFinite(Date.parse(p.sourceObservedAt))
    && Date.parse(p.sourceObservedAt) >= attempt && Date.parse(p.sourceObservedAt) <= observationTime(snapshot))) {
    return { fresh: false, reason: 'stale-product-evidence' };
  }
  return { fresh: true, reason: 'fresh-observations', observedAt: snapshot.observedAt,
    products: snapshot.products.length, selectedDeliveryAddress: DELIVERY_ADDRESS };
}

async function main() {
  if (process.argv.includes('--start')) {
    await writeFile(BASELINE, JSON.stringify({ startedAt: new Date().toISOString() }));
    return;
  }
  const [baseline, status, history] = await Promise.all([BASELINE, STATUS, HISTORY]
    .map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const result = verifyFreshRefresh({ startedAt: baseline.startedAt, status, history });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    ['### OKEY price collection', '',
      result.fresh ? `Fresh measured prices: ${result.products}. Observed at: ${result.observedAt}.`
        : `No fresh prices: ${result.reason}. Saved prices retain their original observation dates.`,
      'Scope: Yandex Eda delivery to Москва, проспект Мира, 211к2. Physical store and stock remain unknown.', ''].join('\n'));
  if (!result.fresh) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('OKEY freshness evidence could not be verified'); process.exitCode = 1; });
}
