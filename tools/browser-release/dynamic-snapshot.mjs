import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {activationState} from './verify.mjs';
import {selectRetention} from './dynamic-retention.mjs';

const inv=JSON.parse(await fs.readFile('tools/browser-release/one-shot-inventory.json','utf8'));
const sha=/^[a-f0-9]{40}$/; if(!sha.test(inv.priorMain??''))throw Error('invalid_base');
execFileSync('git',['cat-file','-e',inv.priorMain+'^{commit}']);
const names=execFileSync('git',['ls-tree','-d','--name-only','HEAD','releases/'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const inventory=names.map(x=>{const m=x.match(/^releases\/([a-f0-9]{64})$/);if(!m)throw Error('invalid_release_tree');return m[1];});
const addedFiles=execFileSync('git',['diff','--name-only',inv.priorMain,'HEAD','--','releases/'],{encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n').filter(Boolean);
const added=[...new Set(addedFiles.map(x=>{const m=x.match(/^releases\/([a-f0-9]{64})\//);if(!m)throw Error('invalid_release_change');return m[1];}))];
let text='';try{text=execFileSync('git',['grep','-I','-o','-h','-E','releases/[a-f0-9]{64}','HEAD','--','.',':!releases/**'],{encoding:'utf8',maxBuffer:16*1024*1024});}catch(e){if(e.status!==1)throw e;}
const references=[...new Set([...text.matchAll(/releases\/([a-f0-9]{64})/g)].map(m=>m[1]))];
const token=process.env.GITHUB_TOKEN;if(!token)throw Error('github_token_required');
const api='https://api.github.com/repos/ZebraRectifier/checkni-g5-preview';
async function request(url){
 const res=await fetch(url,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'checkni-retention'},signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('github_inventory_unavailable:'+res.status);
 return res.json();
}
async function pages(endpoint){
 let all=[];
 for(let page=1;page<=40;page++){
  const d=await request(api+endpoint+(endpoint.includes('?')?'&':'?')+'per_page=100&page='+page);
  if(!Array.isArray(d))throw Error('unexpected_api_response');
  all.push(...d);if(d.length<100)return all;
 }
 throw Error('pagination_limit');
}
const simplify=items=>items.map(p=>({number:p.number,head:p.head?.sha})).sort((a,b)=>a.number-b.number);
let prs=simplify(await pages('/pulls?state=open'));
if(prs.some(p=>!Number.isSafeInteger(p.number)||!sha.test(p.head??'')))throw Error('invalid_pr_inventory');
let prReferences=[];
for(const pr of prs){
 const files=await pages('/pulls/'+pr.number+'/files');
 for(const file of files){
  const m=(file.filename??'').match(/^releases\/([a-f0-9]{64})\//);if(m)prReferences.push(m[1]);
  if(['index.html','prices.html'].includes(file.filename)){
   const d=await request(api+'/contents/'+file.filename+'?ref='+pr.head);
   if(d.encoding!=='base64'||typeof d.content!=='string')throw Error('unreadable_pr_root');
   const content=Buffer.from(d.content,'base64').toString('utf8');
   prReferences.push(...[...content.matchAll(/releases\/([a-f0-9]{64})\//g)].map(m=>m[1]));
  }
 }
}
const again=simplify(await pages('/pulls?state=open'));
if(JSON.stringify(prs)!==JSON.stringify(again))throw Error('open_pr_changed_during_scan');
const live=[];
for(const page of ['index.html','prices.html']){
 const res=await fetch('https://zebrarectifier.github.io/checkni-g5-preview/'+page,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!res.ok)throw Error('live_unavailable');
 const html=await res.text(),ids=[...new Set([...html.matchAll(/\.\/releases\/([a-f0-9]{64})\/src\//g)].map(m=>m[1]))];
 if(ids.length!==1)throw Error('live_root_ambiguous');live.push(ids[0]);
}
const active=await activationState('.');
const ids=selectRetention({inventory,baseline:inv.releases,added,active,live,references,prReferences});
const snapshot={version:1,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),active,live,prs,ids};
const digest=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
const action=process.argv[2];
if(action==='--write'){
 const out=process.env.RETENTION_SNAPSHOT;if(!out)throw Error('snapshot_path_required');
 await fs.writeFile(out,JSON.stringify({digest,ids})+'\n',{flag:'wx'});
 console.log(JSON.stringify({result:'snapshot_written',digest,retained:ids.length,openPRs:prs.length}));
}else if(action==='--check'){
 const expected=process.env.RETENTION_DIGEST;if(!/^[a-f0-9]{64}$/.test(expected??'')||expected!==digest)throw Error('snapshot_changed');
 console.log(JSON.stringify({result:'snapshot_unchanged',digest}));
}else throw Error('invalid_action');
