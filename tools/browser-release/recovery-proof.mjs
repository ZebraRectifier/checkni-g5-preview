import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyLocal} from './verify.mjs';

// Intended for an isolated CI scratch directory and a reviewed exact release ID.
// Git archive copies the immutable tracked tree, without changing the checkout.
const id=process.env.RECOVERY_RELEASE_ID;
const root=process.env.RECOVERY_ROOT;
if(!/^[a-f0-9]{64}$/.test(id??'')||!root||!path.isAbsolute(root)) throw Error('invalid_recovery_inputs');
const candidate=path.join(root,'releases',id);
try { await fs.lstat(candidate); throw Error('recovery_target_exists'); } catch(e) { if(e.code!=='ENOENT')throw e; }
await fs.mkdir(root,{recursive:true});
const listing=execFileSync('git',['ls-tree','-r','-z','HEAD','--',`releases/${id}/`],{maxBuffer:4*1024*1024}).toString('utf8').split('\0').filter(Boolean);
if(!listing.length || listing.some(row=>!/^100644 blob [a-f0-9]{40}\t/.test(row) || !row.slice(row.indexOf('\t')+1).startsWith(`releases/${id}/`) || row.includes('..'))) throw Error('unsafe_git_tree');
const tar=execFileSync('git',['archive','--format=tar','HEAD','--',`releases/${id}`],{maxBuffer:128*1024*1024});
execFileSync('tar',['-xf','-','-C',root],{input:tar,maxBuffer:1024*1024});
const result=await verifyLocal(root,id);
console.log(JSON.stringify({result:'recovered_and_verified',releaseId:id,files:result.entries.length+1,bytes:result.entries.reduce((n,e)=>n+e.bytes,0),sourceCommit:result.sourceCommit}));
