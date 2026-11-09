import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {activationState,verifyLocal} from './verify.mjs';

// Research-only proof: exact source SHA and release set are explicit inputs.
// Does not derive live state, open PRs or external URLs and is NOT a production guard.
const sha=process.env.PROOF_SOURCE_SHA, root=process.env.PROOF_OUTPUT_ROOT;
const list=(process.env.PROOF_RELEASE_IDS??'').split(',').filter(Boolean);
if(!/^[a-f0-9]{40}$/.test(sha??'')||!path.isAbsolute(root??'')||!list.length||
   list.some(id=>!/^[a-f0-9]{64}$/.test(id))||new Set(list).size!==list.length) throw Error('invalid_input');
try { await fs.lstat(root); throw Error('target_exists'); } catch(e) { if(e.code!=='ENOENT')throw e; }
const paths=['.nojekyll','index.html','prices.html','deployment.json','src','release','artifacts',...list.map(id=>'releases/'+id)];
execFileSync('git',['cat-file','-e',sha+'^{commit}']); // exact reviewed commit must be present
const rows=execFileSync('git',['ls-tree','-r','-z',sha,'--',...paths],{maxBuffer:16*1024*1024}).toString('utf8').split('\0').filter(Boolean);
if(!rows.length||rows.some(row=>!/^100644 blob [a-f0-9]{40}\t/.test(row))) throw Error('unsafe_archive_entries');
const names=rows.map(row=>row.slice(row.indexOf('\t')+1));
if(names.some(name=>name.startsWith('/')||name.split('/').some(s=>!s||s==='.'||s==='..'))) throw Error('unsafe_archive_paths');
for(const p of paths)if(!names.some(n=>n===p||n.startsWith(p+'/')))throw Error('missing_archive_path:'+p);
await fs.mkdir(root,{recursive:true});
const source=spawn('git',['archive','--format=tar',sha,'--',...paths],{stdio:['ignore','pipe','inherit']});
const dest=spawn('tar',['--ignore-zeros','-xf','-','-C',root],{stdio:['pipe','inherit','inherit']});
const done=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('process_failed:'+code)));});
await Promise.all([pipeline(source.stdout,dest.stdin),done(source),done(dest)]);
for(const id of list)await verifyLocal(root,id);
const active=await activationState(root);if(!active||!list.includes(active))throw Error('missing_active');
for(const page of ['index.html','prices.html']){
 const html=await fs.readFile(path.join(root,page),'utf8');
 for(const m of html.matchAll(/(?:src|href)\s*=\s*["']\.\/releases\/([a-f0-9]{64})\/([^"'?#\s]+)(?:[?#][^"']*)?["']/gu)){
   if(!list.includes(m[1])||m[2].split('/').some(p=>p==='..'||p==='.'||!p))throw Error('invalid_root_release_url');
   if(!(await fs.stat(path.join(root,'releases',m[1],m[2]))).isFile())throw Error('missing_root_release_url');
 }
}
if(!(await fs.stat(path.join(root,'.nojekyll'))).isFile())throw Error('missing_nojekyll');
console.log(JSON.stringify({result:'compact_proof_verified',sha,active,retained:list,trackedFiles:names.length}));
