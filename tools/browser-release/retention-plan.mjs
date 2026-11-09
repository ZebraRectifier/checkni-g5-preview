const pattern=/^[a-f0-9]{64}$/u;
function set(value,name){
  if(!Array.isArray(value)||value.some(x=>!pattern.test(x))||new Set(value).size!==value.length) throw Error('invalid_'+name);
  return new Set(value);
}
// Pure proof of concept: this function makes no filesystem or network changes.
export function planRetention({inventory,active,deployed,previous,staged,published,references}){
 const all=set(inventory,'inventory'),pending=set(staged,'staged'),done=set(published,'published'),refs=set(references,'references');
 for(const id of [active,deployed,previous]) if(!pattern.test(id??'')||!all.has(id))throw Error('unknown_active_or_rollback');
 for(const id of [...pending,...done,...refs])if(!all.has(id))throw Error('unknown_release');
 for(const id of all)if(pending.has(id)===done.has(id))throw Error('unclassified_or_ambiguous_release');
 if(!done.has(deployed)||!done.has(previous))throw Error('deployment_history_unconfirmed');
 const keep=new Set([active,deployed,previous,...pending,...refs]);
 return {keep:[...keep].sort(),omitted:[...all].filter(id=>!keep.has(id)).sort()};
}
