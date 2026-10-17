import { readFile,appendFile } from 'node:fs/promises';
import { verifyPublishedRefresh } from '../../src/observations/okeyPublishedPromotions.mjs';
const [baseline,status,snapshot]=await Promise.all(['../../.okey-refresh-start.json','../../src/data/okeyPublishedRefresh.json','../../src/data/okeyPublishedPromotions.json']
  .map(async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'))));
const result=verifyPublishedRefresh({startedAt:baseline.startedAt,status,snapshot});
console.log(JSON.stringify(result));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
  ['### OKEY published city catalogue — Proshoper','',result.fresh?`Fresh observations: ${result.products}; ${result.observedAt}.`:`No fresh published prices: ${result.reason}.`,
    'Third-party Moscow city catalogue. Not exact-store or delivery prices; stock/card conditions unknown. Partial visible listings only.',''].join('\n'));
if(!result.fresh)process.exitCode=1;
