import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest,mime,validateManifest,verifyLocal,releaseCandidates} from '../tools/browser-release/verify.mjs';
const files=['index.html','prices.html','src/app.mjs','src/priceCapture.mjs'];
async function cleanup(root,prefix){const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith(prefix));await fs.rm(target,{recursive:true,force:true});}
function manifest(){const descriptor={schemaVersion:1,sourceCommit:'a'.repeat(40),entries:files.map(file=>({file,bytes:2,sha256:digest('ok'),mime:mime(file)}))};return {...descriptor,releaseId:digest(JSON.stringify(descriptor))};}
test('manifest rejects identity, path, type, size, duplicate and absent entrypoints',()=>{
  assert.ok(validateManifest(manifest()));
  const wrong=manifest();wrong.releaseId='b'.repeat(64);assert.throws(()=>validateManifest(wrong));
  for(const mutate of [m=>m.entries[0].file='../index.html',m=>m.entries[0].mime='text/plain',m=>m.entries[0].bytes=-1,m=>m.entries.push(m.entries[0]),m=>m.entries.pop()]){
    const m=manifest();mutate(m);const {releaseId,...d}=m;m.releaseId=digest(JSON.stringify(d));
    assert.throws(()=>validateManifest(m));
  }
});
test('actual files fail closed for tampering, missing and unexpected files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'checkni-release-gate-')),m=manifest(),dir=path.join(root,'releases',m.releaseId);
  try{
    await fs.mkdir(path.join(dir,'src'),{recursive:true});
    await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(m));
    for(const f of files)await fs.writeFile(path.join(dir,f),'ok');
    await verifyLocal(root,m.releaseId);
    await fs.writeFile(path.join(dir,'src/app.mjs'),'no');await assert.rejects(verifyLocal(root,m.releaseId),/content_mismatch/u);
    await fs.writeFile(path.join(dir,'src/app.mjs'),'ok');await fs.unlink(path.join(dir,'src/app.mjs'));await assert.rejects(verifyLocal(root,m.releaseId),/file_set/u);
    await fs.writeFile(path.join(dir,'src/app.mjs'),'ok');await fs.writeFile(path.join(dir,'extra'),'no');await assert.rejects(verifyLocal(root,m.releaseId),/file_set/u);
  }finally{await cleanup(root,'checkni-release-gate-');}
});
test('activation discovers exact IDs while no release is distinguishable',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'checkni-release-selection-'));
  try{
    for(const file of ['index.html','prices.html'])await fs.writeFile(path.join(root,file),'<script src="./src/app.mjs"></script>');
    assert.deepEqual(await releaseCandidates(root,{}),[]);
    const id='a'.repeat(64);await fs.mkdir(path.join(root,'releases',id),{recursive:true});
    for(const file of ['index.html','prices.html']){
      await fs.writeFile(path.join(root,'releases',id,file),'<script src="./src/app.mjs"></script>');
      await fs.writeFile(path.join(root,file),`<script src="./releases/${id}/src/app.mjs"></script>`);
    }
    assert.deepEqual(await releaseCandidates(root,{}),[id]);
    await assert.rejects(releaseCandidates(root,{exact:'../bad'}),/invalid_release_id/u);
    await fs.writeFile(path.join(root,'prices.html'),'<script src="./src/app.mjs"></script>');
    await assert.rejects(releaseCandidates(root,{}),/mixed_active_release/u);
  }finally{await cleanup(root,'checkni-release-selection-');}
});
test('releases parent junction is rejected before reading a release',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'checkni-release-gate-'));
  try{
    const target=path.join(root,'real');await fs.mkdir(target);
    await fs.symlink(target,path.join(root,'releases'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(verifyLocal(root,'a'.repeat(64)),/linked_releases_parent/u);
  }finally{await cleanup(root,'checkni-release-gate-');}
});
test('changed subtree selects its release even with legacy root entrypoints',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'checkni-release-selection-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','pipe']}).toString().trim();
  const commit=()=>{git('add','.');git('-c','user.name=Release test','-c','user.email=release-test@example.invalid','commit','-m','fixture');};
  try{
    git('init');for(const f of ['index.html','prices.html'])await fs.writeFile(path.join(root,f),'legacy');commit();
    const base=git('rev-parse','HEAD'),id='b'.repeat(64);await fs.mkdir(path.join(root,'releases',id),{recursive:true});
    await fs.writeFile(path.join(root,'releases',id,'manifest.json'),'{}');commit();
    assert.deepEqual(await releaseCandidates(root,{base,exact:''}),[id]);
  }finally{await cleanup(root,'checkni-release-selection-');}
});
