import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const mime = name => ({mjs:'text/javascript',js:'text/javascript',css:'text/css',html:'text/html',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',ico:'image/x-icon',txt:'text/plain',avif:'image/avif'})[name.split('.').at(-1)] ?? 'application/octet-stream';
const idPattern = /^[a-f0-9]{64}$/u;
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.env.RELEASE_ROOT || '.');
  const ids = await releaseCandidates(root);
  for (const id of ids) await verifyLocal(root,id);
  console.log(JSON.stringify({status:ids.length?'verified-local-release-content':'NO_RELEASE_CANDIDATE_NOT_A_VERIFIED_RELEASE',releases:ids}));
}
