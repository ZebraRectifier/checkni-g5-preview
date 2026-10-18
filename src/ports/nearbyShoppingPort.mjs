import{CATALOG_SEARCH_PUBLISHABLE_KEY}from'./catalogGatewayPort.mjs';
import{readBoundedJsonResponse}from'./retailCatalogPort.mjs';
export const NEARBY_ADDRESS_ENDPOINT='https://cxpneczhczashanbetgj.supabase.co/functions/v1/nearby-address';
export function createNearbyShoppingPort({fetchImpl=globalThis.fetch}={}){
  let cached=null,pending=null;
  return{
    async directory(){
      if(cached)return cached;
      if(!pending)pending=(async()=>{try{
        const r=await fetchImpl(new URL('../data/nearbyGroceryStores.json',import.meta.url),{credentials:'omit',signal:AbortSignal.timeout(10000)});
        if(!r.ok)throw Error('directory_unavailable');const d=await readBoundedJsonResponse(r,8*1024*1024);
        if(d?.schemaVersion!==1||d.region!=='moscow-and-oblast'||d.exhaustive!==false||d.priceEvidence!==false
          ||!Array.isArray(d.stores)||d.stores.length>25000||!Number.isFinite(Date.parse(d.observedAt)))throw Error('directory_invalid');
        cached=d;return d;
      }finally{pending=null;}})();return pending;
    },
    async address(query){
      if(typeof query!=='string'||query.trim().length<3||query.length>160)return{kind:'invalid',candidates:[]};
      try{const r=await fetchImpl(NEARBY_ADDRESS_ENDPOINT,{method:'POST',credentials:'omit',headers:{'content-type':'application/json',
        apikey:CATALOG_SEARCH_PUBLISHABLE_KEY},
        body:JSON.stringify({query:query.trim(),consent:true}),signal:AbortSignal.timeout(10000)});
        if(!r.ok)return{kind:r.status===429?'limited':'unavailable',candidates:[]};
        const d=await readBoundedJsonResponse(r,32768);
        if(d?.version!==1||!Array.isArray(d.candidates)||d.candidates.length>5)return{kind:'unavailable',candidates:[]};
        return{kind:'results',candidates:d.candidates};
      }catch{return{kind:'unavailable',candidates:[]};}
    }
  };
}
