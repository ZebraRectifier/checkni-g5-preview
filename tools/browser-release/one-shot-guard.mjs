import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {activationState,verifyLocal} from './verify.mjs';
const inv=JSON.parse(await fs.readFile('tools/browser-release/one-shot-inventory.json','utf8'));
const pattern=/^[a-f0-9]{64}$/;
if(inv.schemaVersion!==1||!Array.isArray(inv.releases)||!inv.releases.every(x=>pattern.test(x))||
   new Set(inv.releases).size!==inv.releases.length||![inv.live,inv.previous].every(x=>inv.releases.includes(x)))throw Error('invalid_inventory');
const active=await activationState('.');if(!active||!inv.releases.includes(active))throw Error('active_not_retained');
for(const id of inv.releases)await verifyLocal('.',id);
// A reviewed snapshot of all open PR heads is a one-shot lease. Never ignore
// updates to the research PR; only this release PR is excluded.
const token=process.env.GITHUB_TOKEN;
if(!token)throw Error('github_token_required');
let prs=[];
for(let page=1;page<=10;page++){
 const url=new URL('https://api.github.com/repos/ZebraRectifier/checkni-g5-preview/pulls');
 url.searchParams.set('state','open');url.searchParams.set('per_page','100');url.searchParams.set('page',String(page));
 const response=await fetch(url,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'checkni-pages-oneshot'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('pr_inventory_unavailable');
 const batch=await response.json();if(!Array.isArray(batch))throw Error('pr_inventory_invalid');
 prs.push(...batch.filter(p=>p.number!==inv.excludedPullRequest).map(p=>({number:p.number,head:p.head?.sha})));
 if(batch.length<100)break;if(page===10)throw Error('pr_inventory_truncated');
}
prs.sort((a,b)=>a.number-b.number);
if(JSON.stringify(prs)!==JSON.stringify(inv.openPRs))throw Error('open_pr_snapshot_changed');
for(const page of ['index.html','prices.html']){
 const res=await fetch('https://zebrarectifier.github.io/checkni-g5-preview/'+page,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!res.ok)throw Error('live_root_unavailable');
 const html=await res.text(), ids=[...new Set([...html.matchAll(/\.\/releases\/([a-f0-9]{64})\/src\//g)].map(x=>x[1]))];
 if(ids.length!==1||ids[0]!==inv.live)throw Error('live_snapshot_changed');
}
let matches='';
try{matches=execFileSync('git',['grep','-I','-o','-h','-E','releases/[a-f0-9]{64}','HEAD','--','.',':!releases/**'],{encoding:'utf8',maxBuffer:8*1024*1024});}
catch(e){if(e.status!==1)throw e;}
for(const match of matches.trim().split('\n').filter(Boolean))if(!inv.releases.includes(match.slice('releases/'.length)))throw Error('referenced_release_not_retained');
console.log(JSON.stringify({result:'one_shot_snapshot_verified',active,live:inv.live,previous:inv.previous,retained:inv.releases.length,openPRs:prs.length}));
