import{distanceMeters}from'../runtime/storeGeolocation.mjs';
import{resolveRegisteredMagnitStore}from'../data/registeredMagnitStores.mjs';
import{resolveGlobusMoscowRegionStore}from'../data/globusMoscowRegionStores.mjs';
import{GLOBUS_MAP_LOCATIONS}from'../data/storeMapLocations.mjs';
import{exactMagnitAddressKey}from'./magnitAddressJoin.mjs';
export const NEARBY_RADIUS_KM=Object.freeze([1,3,5,10,20]);
export function nearbyShoppingIntent(text,expectLocation=false){
  const raw=String(text??'').trim(),v=raw.toLowerCase().replaceAll('ё','е');
  if(/^(?:текущий магазин|(?:магнит|о['’]?кей|пятерочка)(?: и (?:магнит|о['’]?кей|пятерочка))*|заветы ильича · до 20 км)$/u.test(v))return null;
  if(expectLocation&&/^(?:без\s|не\s|ограничений нет|на\s+(?:\d|одного|двоих|троих|неделю|две недели)|бюджет\s|подбери подешевле)/u.test(v))return null;
  const radius=v.match(/(?:до|радиус(?:е|ом)?|в пределах)\s*(\d{1,3})\s*км/u);
  if(!expectLocation&&!/найти магазины рядом|магазины рядом|изменить (?:место|адрес)|моя геолокация|я живу|мой адрес|^адрес[:\s]|^москва[,\s]|^московская область[,\s]/u.test(v))return null;
  if(raw.length>240)return{query:'',radiusKm:null};
  const tail=raw.match(/(?:я\s+живу|мой адрес)\s*[:—-]?\s*(.+)$/iu)?.[1]??raw;
  const query=tail.replace(/^(?:я\s+)?(?:живу|мой адрес|адрес|магазины рядом с)\s*[:—-]?\s*/iu,'')
    .replace(/[,;]?\s*(?:до|радиус(?:е|ом)?|в пределах)\s*\d{1,3}\s*км[.!]?/iu,'').trim();
  return{query:/найти магазины рядом|изменить (?:место|адрес)|геолокация/u.test(v)?'':query,
    radiusKm:radius?Number(radius[1]):null};
}
export function nearbyCatalogBinding(point){
  const b=point?.catalogBinding;if(!b)return null;
  if(point.retailerId==='magnit'&&b.retailerId==='magnit'&&b.kind==='exact-locality-street-house-join'){
    const store=resolveRegisteredMagnitStore({shopCode:b.shopCode});
    const key=exactMagnitAddressKey(point.address);
    return store?.address===b.address&&point.address===b.sourceAddress&&key&&key===exactMagnitAddressKey(store.address)?{retailerId:'magnit',store}:null;
  }
  if(point.retailerId==='globus'&&b.retailerId==='globus'&&b.kind==='official-directory-point'){
    const store=resolveGlobusMoscowRegionStore(b.officialStoreId);
    const known=GLOBUS_MAP_LOCATIONS.find(p=>p.officialStoreId===b.officialStoreId);
    return store?.priceStatus==='verified'&&store.address===b.address&&point.address===b.address
      &&known?.lat===point.lat&&known?.lon===point.lon
      ?{retailerId:'globus',store}:null;
  }
  return null;
}
export function nearbyGroceryMatches(stores,position,radiusKm,{connectedOnly=false}={}){
  if(!Array.isArray(stores)||!Number.isFinite(radiusKm)||radiusKm<1||radiusKm>20)return[];
  const seen=new Set();return stores.flatMap(point=>{
    const meters=distanceMeters(position,point);if(meters===null||meters>radiusKm*1000||typeof point.name!=='string'||!point.id||seen.has(point.id))return[];
    try{const u=new URL(point.sourceUrl);if(u.protocol!=='https:'||u.username||u.password||!['www.openstreetmap.org','globus.ru','www.globus.ru'].includes(u.hostname))return[];}catch{return[];}
    seen.add(point.id);const binding=nearbyCatalogBinding(point);if(connectedOnly&&!binding)return[];
    return[{...point,distanceMeters:meters,catalog:binding}];
  }).sort((a,b)=>a.distanceMeters-b.distanceMeters||a.id.localeCompare(b.id));
}
export{normalizedAddressCandidate}from'./nearbyAddressContract.mjs';
