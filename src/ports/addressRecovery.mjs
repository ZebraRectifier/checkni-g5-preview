// Tab-memory only: never persist a person's query or send it to another provider.
export function createAddressRecovery({request,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const pending=new Map(),cache=new Map();
  let generation=0;
  const recover=async query=>{
    const token=generation;
    const key=query.trim();
    const saved=cache.get(key);
    if(saved&&now()-saved.at<300000)return structuredClone(saved.value);
    cache.delete(key);
    if(pending.has(key))return structuredClone(await pending.get(key));
    const task=(async()=>{
      let value;
      for(let attempt=0;attempt<2;attempt++){
        try{value=await request(key);}catch{value={kind:'unavailable',candidates:[],retryable:true};}
        if(value.kind!=='unavailable'||value.retryable!==true||attempt===1)break;
        // Respect the server's one-second admission interval. Never retry 429,
        // auth failures or invalid payloads; at most two requests per action.
        await wait(1200);
      }
      const result={kind:value.kind,candidates:value.candidates??[]};
      if(token===generation&&result.kind==='results'&&result.candidates.length){
        if(cache.size>=12)cache.delete(cache.keys().next().value);
        cache.set(key,{at:now(),value:structuredClone(result)});
      }
      return result;
    })();
    pending.set(key,task);
    try{return structuredClone(await task);}finally{if(pending.get(key)===task)pending.delete(key);}
  };
  recover.clear=()=>{generation++;cache.clear();pending.clear();};
  return recover;
}

// A directory point is an explicitly selected shop landmark, not a geocoded
// home address. No fuzzy house-number substitution and no retailer requests.
export function directoryAddressCandidates(stores,query){
  const words=value=>String(value??'').toLocaleLowerCase('ru').replaceAll('ё','е').match(/[\p{L}\p{N}]+/gu)??[];
  const terms=words(query).filter(w=>!['г','ул','д','город','улица','дом'].includes(w));
  if(!terms.length)return [];
  const seen=new Set(),result=[];
  for(const row of Array.isArray(stores)?stores:[]){
    if(typeof row?.name!=='string'||typeof row.address!=='string'||!Number.isFinite(row.lat)||!Number.isFinite(row.lon)
      ||row.lat<54||row.lat>58||row.lon<35||row.lon>41)continue;
    const tokens=words(row.name+' '+row.address);
    if(!terms.every(term=>tokens.some(token=>/\d/u.test(term)?token===term:token.startsWith(term))))continue;
    const label=row.name+' · '+row.address,key=JSON.stringify([label,row.lat,row.lon]);
    if(label.length>500||seen.has(key))continue;
    seen.add(key);result.push({lat:row.lat,lon:row.lon,label,precision:'store'});
    if(result.length===5)break;
  }
  return result;
}
