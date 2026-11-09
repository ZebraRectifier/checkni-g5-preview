// Data-only policy core. Every argument is an observed, already validated ID.
// Keep the reviewed baseline and every release added after it, including stages.
const valid=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function selectRetention({inventory,baseline,added,active,live,references,prReferences}){
 for(const [k,v] of Object.entries({inventory,baseline,added,references,prReferences}))if(!Array.isArray(v)||v.some(x=>!valid(x)))throw Error('invalid_'+k);
 if(!valid(active)||!Array.isArray(live)||live.length!==2||live.some(x=>!valid(x))||live[0]!==live[1])throw Error('invalid_live_or_active');
 const all=new Set(inventory),selected=new Set([...baseline,...added,active,...live,...references]);
 for(const id of prReferences)if(all.has(id))selected.add(id); // staged on a PR outside main waits for its merge
 for(const id of selected)if(!all.has(id))throw Error('required_release_missing');
 return [...selected].sort();
}

export function requireCompletePrFiles(files){
 if(!Array.isArray(files)||files.length>=3000)throw Error('pr_files_possibly_truncated');
 return files;
}
