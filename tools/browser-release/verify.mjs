import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const mime = name => ({mjs:'text/javascript',js:'text/javascript',css:'text/css',html:'text/html',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',ico:'image/x-icon',txt:'text/plain',avif:'image/avif'})[name.split('.').at(-1)] ?? 'application/octet-stream';
const idPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const MAX_GIT_RUNTIME_BYTES = 128 * 1024 * 1024;
const TRUSTED_REPOSITORY_URL = 'https://github.com/ZebraRectifier/checkni-g5-preview.git';
const validFile = name => typeof name === 'string' && /^[A-Za-z0-9_./-]+$/u.test(name)
  && !name.split('/').some(s => !s || s === '.' || s === '..')
  && (['index.html','prices.html'].includes(name) || name.startsWith('src/'));
// Same descriptor/MIME contract as the reviewed private release tool; no staging or activation.
export function validateManifest(m, id = m?.releaseId) {
  const {schemaVersion,sourceCommit,entries,releaseId} = m ?? {};
  if (schemaVersion !== 1 || !/^[a-f0-9]{40}$/u.test(sourceCommit ?? '') || !idPattern.test(releaseId ?? '') || id !== releaseId
    || !Array.isArray(entries) || !entries.length || entries.length > 2000
    || entries.some(e => !validFile(e.file) || !/^[a-f0-9]{64}$/u.test(e.sha256 ?? '') || !Number.isSafeInteger(e.bytes) || e.bytes < 0 || e.bytes > 20*1024*1024 || e.mime !== mime(e.file))
    || new Set(entries.map(e => e.file)).size !== entries.length
    || digest(JSON.stringify({schemaVersion,sourceCommit,entries})) !== releaseId
    || ['index.html','prices.html','src/app.mjs','src/priceCapture.mjs'].some(f => !entries.some(e => e.file === f))) throw Error('invalid_release_manifest');
  return m;
}
export async function verifyLocal(root, id) {
  if (!idPattern.test(id)) throw Error('invalid_release_id');
  const directory = path.join(root,'releases',id);
  if ((await fs.lstat(path.join(root,'releases'))).isSymbolicLink()) throw Error('linked_releases_parent');
  const found = [];
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error('linked_release_file');
      if (entry.isDirectory()) await walk(path.join(dir,entry.name),name+'/');
      else if (entry.isFile()) found.push(name);
      else throw Error('invalid_release_file');
    }
  }
  if ((await fs.lstat(directory)).isSymbolicLink()) throw Error('linked_release_directory');
  await walk(directory);
  const m = validateManifest(JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8')),id);
  if (found.length !== m.entries.length+1 || found.some(f => f !== 'manifest.json' && !m.entries.some(e => e.file === f))) throw Error('release_file_set_mismatch');
  for (const e of m.entries) {
    const body = await fs.readFile(path.join(directory,e.file));
    if (body.length !== e.bytes || digest(body) !== e.sha256) throw Error('release_content_mismatch:'+e.file);
  }
  return m;
}
const sourceEntry = (file, bytes) => ['index.html','prices.html'].includes(file)
  ? Buffer.from(bytes.toString('utf8').replace(/(\b(?:src|href)\s*=\s*["'])\.\/releases\/[a-f0-9]{64}\/src\//gu,'$1./src/'))
  : bytes;
const git = (root, args, input) => execFileSync('git',args,{cwd:root,input,maxBuffer:MAX_GIT_RUNTIME_BYTES,
  stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
export function verifySourceCommitRuntime(root, manifest) {
  validateManifest(manifest);
  const commit=manifest.sourceCommit;
  if(!commitPattern.test(commit))throw Error('invalid_source_commit');
  try{git(root,['cat-file','-e',`${commit}^{commit}`]);}
  catch{git(root,['fetch','--no-tags','--depth=1',TRUSTED_REPOSITORY_URL,commit]);}
  if(git(root,['rev-parse','--verify',`${commit}^{commit}`]).toString('utf8').trim()!==commit)throw Error('source_commit_not_exact');
  if(manifest.entries.reduce((total,entry)=>total+entry.bytes,0)>MAX_GIT_RUNTIME_BYTES/2)throw Error('source_runtime_too_large');
  const buffer=git(root,['cat-file','--batch'],manifest.entries.map(entry=>`${commit}:${entry.file}`).join('\n')+'\n');
  let offset=0;
  for(const entry of manifest.entries){
    const end=buffer.indexOf(10,offset),header=end>=offset?buffer.subarray(offset,end).toString('utf8'):'';
    const match=/^[a-f0-9]{40} blob (\d+)$/u.exec(header);
    if(!match)throw Error('source_commit_missing_runtime:'+entry.file);
    const size=Number(match[1]),raw=buffer.subarray(end+1,end+1+size),bytes=sourceEntry(entry.file,raw);
    if(raw.length!==size)throw Error('invalid_git_blob_batch');
    if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)throw Error('source_commit_runtime_mismatch:'+entry.file);
    offset=end+size+2;
  }
  if(offset!==buffer.length)throw Error('invalid_git_blob_batch');
}
export async function activationState(root) {
  const pages = await Promise.all(['index.html','prices.html'].map(async file=>({file,html:await fs.readFile(path.join(root,file),'utf8')})));
  const ids=pages.map(({html})=>[...html.matchAll(/\.\/releases\/([^/"'\s]+)\/src\//gu)].map(m=>m[1]));
  if (!ids.some(a=>a.length)) return null;
  const unique=new Set(ids.flat());
  if (ids.some(a=>!a.length)||unique.size!==1||!idPattern.test([...unique][0])) throw Error('mixed_active_release');
  const id=[...unique][0];
  for(const {file,html} of pages){
    const preview=await fs.readFile(path.join(root,'releases',id,file),'utf8');
    const expected=preview.replace(/(\b(?:src|href)\s*=\s*["'])\.\/src\//gu,`$1./releases/${id}/src/`);
    if(html!==expected)throw Error('invalid_activation_entry:'+file);
  }
  return id;
}
export async function releaseCandidates(root, {base = process.env.RELEASE_BASE_SHA, exact = process.env.RELEASE_ID} = {}) {
  const ids = new Set();
  if (exact) { if (!idPattern.test(exact)) throw Error('invalid_release_id'); ids.add(exact); }
  if (base) {
    if (!/^[a-f0-9]{40}$/u.test(base)) throw Error('invalid_base_sha');
    const files = execFileSync('git',['diff','--name-only',base,'HEAD','--','releases'],{cwd:root}).toString().trim().split('\n');
    for (const f of files) {
      const match = f.match(/^releases\/([a-f0-9]{64})\//u);
      if (match) ids.add(match[1]); else if (f) throw Error('invalid_release_path');
    }
  } else if (!exact) {
    for (const name of await fs.readdir(path.join(root,'releases')).catch(e => {if(e.code==='ENOENT')return [];throw e;})) {
      if (!idPattern.test(name)) throw Error('invalid_release_path'); ids.add(name);
    }
  }
  const active=await activationState(root);if(active)ids.add(active);
  return [...ids];
}
export function addedReleaseCandidates(root, base = process.env.RELEASE_BASE_SHA) {
  if(!base)return [];
  if(!commitPattern.test(base))throw Error('invalid_base_sha');
  const files=git(root,['diff','--diff-filter=A','--name-only',base,'HEAD','--','releases']).toString('utf8').trim().split('\n');
  const ids=new Set();
  for(const file of files){
    const match=file.match(/^releases\/([a-f0-9]{64})\//u);
    if(match)ids.add(match[1]);else if(file)throw Error('invalid_release_path');
  }
  return [...ids];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.env.RELEASE_ROOT || '.');
  const ids = await releaseCandidates(root);
  const manifests=new Map();
  for (const id of ids) manifests.set(id,await verifyLocal(root,id));
  for (const id of addedReleaseCandidates(root)) verifySourceCommitRuntime(root,manifests.get(id)??await verifyLocal(root,id));
  console.log(JSON.stringify({status:ids.length?'verified-local-release-content':'NO_RELEASE_CANDIDATE_NOT_A_VERIFIED_RELEASE',releases:ids}));
}
