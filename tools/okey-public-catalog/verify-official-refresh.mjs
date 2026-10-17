import { readFile,appendFile } from 'node:fs/promises';
import { verifyOfficialRefresh } from '../../src/observations/okeyOfficialPromotions.mjs';
const [baseline,status,snapshot]=await Promise.all(['../../.okey-refresh-start.json','../../src/data/okeyOfficialRefresh.json','../../src/data/okeyOfficialPromotions.json']
  .map(async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'))));
const result=verifyOfficialRefresh({startedAt:baseline.startedAt,status,snapshot});
console.log(JSON.stringify(result));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
  ['### Official OKEY city promotions','',result.fresh?`Fresh city promotion observations: ${result.products}; ${result.observedAt}.`:`No fresh official prices: ${result.reason}.`,
    'Scope: Moscow city catalogue. No exact physical store, stock, delivery price, card/no-card or full-assortment claim.',''].join('\n'));
if(!result.fresh)process.exitCode=1;
