import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {credentialFindings} from '../security/scan-public-secrets.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const binary = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/iu;
const validFile = name => typeof name === 'string' && /^[A-Za-z0-9_./-]+$/u.test(name)
  && !name.split('/').some(s => !s || s === '.' || s === '..')
  && (['index.html','prices.html'].includes(name) || name.startsWith('src/'));
const mime = name => ({mjs:'text/javascript',js:'text/javascript',css:'text/css',html:'text/html',json:'application/json',
  svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',
  woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',ico:'image/x-icon',txt:'text/plain',avif:'image/avif'})[name.split('.').at(-1)] ?? 'application/octet-stream';

// Read Git blobs, not checkout line endings or unreviewed working-tree edits.
export function readReleaseSource(repo, ref = 'HEAD') {
  const git = (...args) => execFileSync('git',args,{cwd:repo,maxBuffer:64*1024*1024});
  const sourceCommit = git('rev-parse','--verify',`${ref}^{commit}`).toString().trim();
  if(!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw Error('invalid_source_commit');
  const rows = git('ls-tree','-r','-z',sourceCommit,'--','src','index.html','prices.html').toString().split('\0').filter(Boolean);
  const files = new Map();
  for(const row of rows) {
    const [metadata,name] = row.split('\t');
    if(!metadata.startsWith('100644 blob ') && !metadata.startsWith('100755 blob ')) throw Error('unsupported_source_entry');
    if(!validFile(name)) throw Error('invalid_source_path');
    files.set(name,git('show',`${sourceCommit}:${name}`));
  }
  return {sourceCommit,files};
}

export function sourceHtml(html) {
  return html.replace(/(\b(?:src|href)\s*=\s*["'])\.\/releases\/[a-f0-9]{64}\/src\//gu,'$1./src/');
}
export function activationHtml(html, releaseId) {
  if(!/^[a-f0-9]{64}$/u.test(releaseId)) throw Error('invalid_release_id');
  const normalized=sourceHtml(html);
  if(!normalized.includes('./src/')) throw Error('missing_source_entry');
  return normalized.replace(/(\b(?:src|href)\s*=\s*["'])\.\/src\//gu,`$1./releases/${releaseId}/src/`);
}

async function safeTarget(root, relative) {
  const base=path.resolve(root),target=path.resolve(base,relative);
  if(!target.startsWith(base+path.sep)) throw Error('target_outside_release_root');
  // Reject links throughout the output path; do not follow them to another tree.
  let current=path.parse(target).root;
  for(const segment of target.slice(current.length).split(path.sep)) {
    current=path.join(current,segment);
    const stat=await fs.lstat(current).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(stat?.isSymbolicLink()) throw Error('linked_output_path');
  }
  return target;
}
async function immutableWrite(root,name,bytes) {
  const target=await safeTarget(root,name);
  await fs.mkdir(path.dirname(target),{recursive:true});
  try {await fs.writeFile(target,bytes,{flag:'wx'});}
  catch(error) {
    if(error.code!=='EEXIST') throw error;
    if(!(await fs.readFile(target)).equals(Buffer.from(bytes))) throw Error('immutable_release_conflict');
  }
}

export async function stageRelease({sourceCommit,files,outputRoot}) {
  if(!/^[a-f0-9]{40}$/u.test(sourceCommit??'')) throw Error('invalid_source_commit');
  const prepared=new Map();
  for(const [name,bytes] of files) {
    if(!validFile(name)) throw Error('invalid_source_path');
    const body=['index.html','prices.html'].includes(name)?Buffer.from(sourceHtml(Buffer.from(bytes).toString())):Buffer.from(bytes);
    if(!binary.test(name) && credentialFindings(body.toString(),{publicArtifact:true}).length) throw Error('public_credential_scan_failed');
    prepared.set(name,body);
  }
  for(const required of ['index.html','prices.html','src/app.mjs','src/priceCapture.mjs'])
    if(!prepared.has(required)) throw Error('missing_release_entry');
  const entries=[...prepared].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([file,body])=>({file,bytes:body.length,sha256:digest(body),mime:mime(file)}));
  const descriptor={schemaVersion:1,sourceCommit,entries};
  const releaseId=digest(JSON.stringify(descriptor));
  const manifest={...descriptor,releaseId};
  validateManifest(manifest);
  for(const [file,bytes] of prepared) await immutableWrite(outputRoot,`releases/${releaseId}/${file}`,bytes);
  await immutableWrite(outputRoot,`releases/${releaseId}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

function validateManifest(manifest) {
  const {schemaVersion,sourceCommit,entries,releaseId}=manifest??{};
  if(schemaVersion!==1 || !/^[a-f0-9]{40}$/u.test(sourceCommit??'') || !Array.isArray(entries) || !entries.length
    || entries.length>2000 || !/^[a-f0-9]{64}$/u.test(releaseId??'')
    || entries.some(e=>!validFile(e.file)||!/^[a-f0-9]{64}$/u.test(e.sha256??'')||!Number.isSafeInteger(e.bytes)||e.bytes<0||e.bytes>20*1024*1024||e.mime!==mime(e.file))
    || new Set(entries.map(e=>e.file)).size!==entries.length
    || digest(JSON.stringify({schemaVersion,sourceCommit,entries}))!==releaseId) throw Error('invalid_release_manifest');
  return manifest;
}
export async function verifyRelease({manifest,baseUrl,fetchImpl=fetch,now=Date.now}) {
  validateManifest(manifest);
  const base=new URL(baseUrl);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/')) throw Error('invalid_site_base');
  const results=[];let index=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(index<manifest.entries.length) {
      const entry=manifest.entries[index++],url=new URL(`releases/${manifest.releaseId}/${entry.file}`,base);
      try {
        const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'});
        const chunks=[];let size=0;
        const reader=response.body?.getReader();
        if(reader) while(true) {
          const {done,value}=await reader.read();if(done)break;
          size+=value.length;
          if(size>entry.bytes) {await reader.cancel();throw Error('oversized_release_response');}
          chunks.push(Buffer.from(value));
        }
        const body=Buffer.concat(chunks);
        const type=(response.headers.get('content-type')??'').split(';')[0].trim();
        const acceptedMime=type===entry.mime || entry.mime==='text/javascript'&&type==='application/javascript';
        results.push({file:entry.file,status:response.status,match:response.ok&&acceptedMime&&body.length===entry.bytes&&digest(body)===entry.sha256});
      }catch{results.push({file:entry.file,match:false});}
    }
  }));
  results.sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
  return {releaseId:manifest.releaseId,sourceCommit:manifest.sourceCommit,baseUrl:base.href,checkedAt:new Date(now()).toISOString(),
    complete:results.length===manifest.entries.length&&results.every(r=>r.match),results};
}

// Fresh remote verification is mandatory immediately before changing local entry pages.
// The caller still reviews/commits/publishes that separate activation change.
export async function activateRelease({outputRoot,releaseId,baseUrl,fetchImpl=fetch,now=Date.now}) {
  if(!/^[a-f0-9]{64}$/u.test(releaseId??'')) throw Error('invalid_release_id');
  const manifest=validateManifest(JSON.parse(await fs.readFile(await safeTarget(outputRoot,`releases/${releaseId}/manifest.json`),'utf8')));
  if(manifest.releaseId!==releaseId) throw Error('release_identity_mismatch');
  for(const entry of manifest.entries) {
    const bytes=await fs.readFile(await safeTarget(outputRoot,`releases/${releaseId}/${entry.file}`));
    if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256) throw Error('modified_local_release');
  }
  const pages=new Map();
  for(const file of ['index.html','prices.html']) {
    const body=await fs.readFile(await safeTarget(outputRoot,`releases/${releaseId}/${file}`));
    if(digest(body)!==manifest.entries.find(e=>e.file===file)?.sha256) throw Error('modified_local_release');
    pages.set(file,activationHtml(body.toString(),releaseId));
  }
  const receipt=await verifyRelease({manifest,baseUrl,fetchImpl,now});
  if(!receipt.complete) throw Error('release_not_fully_published');
  for(const [file,body] of pages) await fs.writeFile(await safeTarget(outputRoot,file),body);
  return receipt;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [command,...args]=process.argv.slice(2);
  if(command==='stage'&&args.length===3) {
    const [repo,ref,outputRoot]=args,manifest=await stageRelease({...readReleaseSource(repo,ref),outputRoot});
    console.log(JSON.stringify({releaseId:manifest.releaseId,sourceCommit:manifest.sourceCommit,files:manifest.entries.length,activated:false}));
  } else if(command==='activate'&&args.length===3) {
    const [outputRoot,releaseId,baseUrl]=args;
    const receipt=await activateRelease({outputRoot,releaseId,baseUrl});
    console.log(JSON.stringify({releaseId:receipt.releaseId,complete:receipt.complete,localEntriesUpdated:true,published:false}));
  } else throw Error('Usage: stage <repo> <git-ref> <output-root> | activate <output-root> <release-id> <site-base-url>');
}
