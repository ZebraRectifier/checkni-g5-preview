import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const report=JSON.parse(fs.readFileSync(path.join(here,'coverage.json'),'utf8'));
const equal=(actual,expected,label)=>{
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};
if(report.schemaVersion!==1||report.sourceCommit!=='dbb280ae17b1b0e7aa043c89921f12860f30ba32'
  ||report.priceEvidence!==false||report.catalogBindings!==0)throw new Error('invalid_coverage_receipt');

let total=0;const networkTotals={},prefixTotals={};
for(const [slug,expected] of Object.entries(report.cities)){
  const file=path.join(root,'src/data/nearby-regions',`${slug}.json`);
  const text=fs.readFileSync(file,'utf8').replace(/\r\n/gu,'\n');
  const hash=createHash('sha256').update(text).digest('hex');
  if(hash!==expected.sha256Lf)throw new Error(`file_hash_mismatch:${slug}`);
  const directory=JSON.parse(text);
  if(directory.schemaVersion!==1||directory.city!==expected.city||directory.exhaustive!==false
    ||directory.priceEvidence!==false||!Array.isArray(directory.stores))throw new Error(`invalid_directory_contract:${slug}`);
  const ids=new Set(),networks={};
  for(const row of directory.stores){
    if(typeof row.id!=='string'||ids.has(row.id))throw new Error(`duplicate_or_invalid_id:${slug}`);
    if(typeof row.sourceUrl!=='string'||!row.sourceUrl.startsWith('https://'))throw new Error(`invalid_source_url:${slug}:${row.id}`);
    if(!Number.isFinite(row.lat)||Math.abs(row.lat)>90||!Number.isFinite(row.lon)||Math.abs(row.lon)>180)throw new Error(`invalid_coordinate:${slug}:${row.id}`);
    if(['catalog','catalogBinding','price','priceMinor','stock','availability'].some(key=>key in row))throw new Error(`commercial_claim_in_geography:${slug}:${row.id}`);
    ids.add(row.id);networks[row.retailerId]=(networks[row.retailerId]??0)+1;
    networkTotals[row.retailerId]=(networkTotals[row.retailerId]??0)+1;
    const prefix=row.id.split(':')[0];prefixTotals[prefix]=(prefixTotals[prefix]??0)+1;
  }
  const sorted=Object.fromEntries(Object.entries(networks).sort(([a],[b])=>a.localeCompare(b)));
  equal(sorted,expected.networks,`network_counts:${slug}`);
  equal(directory.stores.length,expected.stores,`city_count:${slug}`);
  total+=directory.stores.length;
}
equal(total,report.totalStores,'total_stores');
equal(Object.fromEntries(Object.entries(networkTotals).sort(([a],[b])=>a.localeCompare(b))),report.networkTotals,'network_totals');
equal(prefixTotals,{osm:report.lineage.osmRows,official:report.lineage.officialRows,derived:report.lineage.derivedOfficialRows},'lineage_prefixes');
for(const evidence of report.lineage.evidence)if(!fs.existsSync(path.join(root,evidence)))throw new Error(`missing_evidence:${evidence}`);
console.log(JSON.stringify({status:'verified-regional-coverage',cities:Object.keys(report.cities).length,stores:total,networks:Object.keys(networkTotals).length}));
