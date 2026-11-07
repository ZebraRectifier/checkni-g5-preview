import{distanceMeters}from'../runtime/storeGeolocation.mjs';
import{resolveRegisteredMagnitStore}from'../data/registeredMagnitStores.mjs';
import{resolveGlobusMoscowRegionStore}from'../data/globusMoscowRegionStores.mjs';
import{GLOBUS_MAP_LOCATIONS}from'../data/storeMapLocations.mjs';
import{exactMagnitAddressKey}from'./magnitAddressJoin.mjs';
import{nearbyRegionForPosition}from'./nearbyRegions.mjs';
import{extractShoppingDelta,normalizeShoppingText,shoppingTargets,shoppingTargetLabel}from'./shoppingConversation.mjs';
export const NEARBY_RADIUS_KM=Object.freeze([1,3,5,10,20]);
const officialMagnitBindings=new WeakMap();
const officialMagnitPoints=new WeakSet();
const officialMagnitSource='https://magnit.ru/shops';
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.now()+60000;
// A catalogue registration alone proves neither a populated catalogue nor a
// location. Admit this separate, dated coordinate packet before making pins.
export function registeredMagnitCoordinatePoints(data){
  if(data?.schemaVersion!==1||data.region!=='moscow-and-oblast'||data.exhaustive!==false||data.priceEvidence!==false
    ||data.sourceUrl!==officialMagnitSource||data.sourceApiUrl!=='https://magnit.ru/webgate/v1/stores-facade/search/detail'
    ||!validDate(data.observedAt)||!Array.isArray(data.stores)||data.stores.length>2000)return Object.freeze([]);
  const catalogEvidence=data.catalogEvidence;
  const catalogChecked=catalogEvidence?.kind==='active-exact-store-rows'&&catalogEvidence.priceFreshnessProven===false
    &&validDate(catalogEvidence.checkedAt);
  const byCode=new Map();
  for(const row of data.stores){
    const code=row?.shopCode,store=typeof code==='string'&&/^\d{6}$/u.test(code)?resolveRegisteredMagnitStore({shopCode:code}):null;
    if(!store)continue;
    if(byCode.has(code)){byCode.set(code,null);continue;}
    byCode.set(code,null);
    const key=typeof row.address==='string'?exactMagnitAddressKey(row.address):null;
    if(row.registeredAddress!==store.address||typeof row.address!=='string'||!row.address||row.address.length>300
      ||!(row.address===store.address||key&&key===exactMagnitAddressKey(store.address))
      ||row.owner!=='OWNER_MAGNIT'||row.isActive!==true||row.status!=='STATUS_ACTIVE'||row.offline!==true
      ||!['MM','MM_MINI','GM'].includes(row.storeType)||nearbyRegionForPosition(row)?.id!=='moscow-and-oblast'
      ||!validDate(row.observedAt)||Date.parse(row.observedAt)>Date.parse(data.observedAt))continue;
    const point={id:`official:magnit:${code}`,name:'Магнит',retailerId:'magnit',sourceStoreId:code,
      address:row.address,lat:row.lat,lon:row.lon,sourceUrl:officialMagnitSource,observedAt:row.observedAt,
      sourceType:'official-store-directory',coordinateEvidence:'official-roster'};
    const c=row.catalog;
    if(catalogChecked&&c?.storeId===`magnit-${code}`&&Number.isSafeInteger(c.activeItems)&&c.activeItems>0&&c.activeItems<=1000000
      &&validDate(c.oldestProductObservedAt)&&validDate(c.newestProductObservedAt)
      &&Date.parse(c.oldestProductObservedAt)<=Date.parse(c.newestProductObservedAt)
      &&Date.parse(c.newestProductObservedAt)<=Date.parse(catalogEvidence.checkedAt)){
      point.catalogBinding=Object.freeze({retailerId:'magnit',shopCode:code,address:store.address,
        kind:'official-registered-store-code',sourceAddress:point.address,catalogCheckedAt:catalogEvidence.checkedAt});
      // Keep an admitted coordinate separate from the caller's mutable copy.
      // A forged or subsequently moved point cannot borrow a valid binding.
      officialMagnitBindings.set(point.catalogBinding,Object.freeze({...point}));
    }
    officialMagnitPoints.add(point);
    byCode.set(code,Object.freeze(point));
  }
  return Object.freeze([...byCode.values()].filter(Boolean));
}
export function withRegisteredMagnitCoordinates(directory,data){
  if(directory?.schemaVersion!==1||directory.region!=='moscow-and-oblast'||directory.exhaustive!==false
    ||directory.priceEvidence!==false||!Array.isArray(directory.stores)||directory.stores.length>25000)return directory;
  const points=registeredMagnitCoordinatePoints(data);
  if(!points.length)return directory;
  const ids=new Set(directory.stores.map(p=>p.id));
  const bound=new Set(directory.stores.flatMap(p=>{const b=nearbyCatalogBinding(p);return b?.retailerId==='magnit'?[b.store.shopCode]:[];}));
  const additions=points.filter(p=>!ids.has(p.id)&&!bound.has(p.sourceStoreId));
  if(directory.stores.length+additions.length>25000)return directory;
  return {...directory,registeredMagnitCoordinatesObservedAt:data.observedAt,stores:[...directory.stores,...additions]};
}
function separateLocationRestriction(tail){
  const boundaries=[...tail.matchAll(/[.;!?\n,]\s+/gu)];
  for(const boundary of boundaries){
    const preferenceText=tail.slice(boundary.index+boundary[0].length).trim();
    if(!preferenceText)continue;
    // Inspect only the immediate clause: a later refusal must not turn an
    // earlier street abbreviation into a preference. Keep the entire tail so
    // the existing memory guard can reject unknown or oversized constraints.
    const firstClause=preferenceText.split(/[.;!?\n,]/u,1)[0].trim();
    const delta=extractShoppingDelta(firstClause);
    const canonicalFood=shoppingTargets(firstClause).some(target=>normalizeShoppingText(firstClause)===shoppingTargetLabel(target));
    const afterStreetMarker=/(?:^|[\s,])(?:ул|улица|пер|переулок|пр-т|проспект|ш|шоссе|д|дом|к|корпус|стр|строение)$/iu.test(tail.slice(0,boundary.index).trim());
    const listDelta=extractShoppingDelta(preferenceText.split(/[.;!?\n]/u,1)[0]);
    const startsAddress=/^(?:ул(?:ица)?|пер(?:еулок)?|проспект|пр-т|ш(?:оссе)?|д(?:ом)?|к(?:орпус)?|стр(?:оение)?|кв(?:артира)?)(?=$|[\s.,])/iu.test(firstClause);
    // Unknown food in a shared-refusal list is safe to separate after a
    // sentence boundary. A comma alone may still be part of the address.
    const unknownListAfterSentence=boundary[0][0]!==','&&!afterStreetMarker&&!startsAddress
      &&listDelta.unresolved.length>0&&listDelta.reject.length>0;
    if(delta.reject.length||delta.unresolved.length||canonicalFood&&!afterStreetMarker&&(listDelta.reject.length||listDelta.unresolved.length)||unknownListAfterSentence){
      return{location:tail.slice(0,boundary.index).trim(),preferenceText};
    }
  }
  return{location:tail,preferenceText:null};
}
export function nearbyShoppingIntent(text,expectLocation=false){
  const raw=String(text??'').trim(),v=raw.toLowerCase().replaceAll('ё','е');
  if(/^(?:текущий магазин|(?:магнит|о['’]?кей|пятерочка)(?: и (?:магнит|о['’]?кей|пятерочка))*|заветы ильича · до 20 км)$/u.test(v))return null;
  if(expectLocation&&/^(?:без\s|не\s|ограничений нет|на\s+(?:\d|одного|двоих|троих|неделю|две недели)|бюджет\s|подбери подешевле)/u.test(v))return null;
  if(expectLocation&&!/(?:я\s+живу|мой адрес|^адрес[:\s]|^москва[,\s]|^московская область[,\s])/u.test(v)){
    const delta=extractShoppingDelta(raw);
    if(delta.reject.length||delta.unresolved.length)return null;
  }
  const radius=v.match(/(?:до|радиус(?:е|ом)?|в пределах)\s*(\d{1,3})\s*км/u);
  if(!expectLocation&&!/найти магазины рядом|магазины рядом|изменить (?:место|адрес)|моя геолокация|я живу|мой адрес|^адрес[:\s]|^москва[,\s]|^московская область[,\s]/u.test(v))return null;
  // An oversized turn must reach the existing failed-save clarification
  // before the app opens a picker or clears the user's original input.
  if(raw.length>240)return{query:'',radiusKm:null,preferenceText:raw};
  const tail=raw.match(/(?:я\s+живу|мой адрес)\s*[:—-]?\s*(.+)$/ius)?.[1]??raw;
  const {location,preferenceText}=separateLocationRestriction(tail);
  const query=location.replace(/^(?:я\s+)?(?:живу|мой адрес|адрес|магазины рядом с)\s*[:—-]?\s*/iu,'')
    .replace(/[,;]?\s*(?:до|радиус(?:е|ом)?|в пределах)\s*\d{1,3}\s*км[.!]?/iu,'').replace(/[,.!?;]+$/u,'').trim();
  return{query:/найти магазины рядом|изменить (?:место|адрес)|геолокация/u.test(v)?'':query,
    radiusKm:radius?Number(radius[1]):null,...(preferenceText?{preferenceText}:{})};
}
export function nearbyCatalogBinding(point){
  const b=point?.catalogBinding;if(!b)return null;
  if(point.retailerId==='magnit'&&b.kind==='official-registered-store-code'){
    const admitted=officialMagnitBindings.get(b),store=resolveRegisteredMagnitStore({shopCode:b.shopCode});
    return admitted&&store?.address===b.address&&['id','sourceStoreId','address','lat','lon','sourceUrl','observedAt']
      .every(key=>point[key]===admitted[key])?{retailerId:'magnit',store}:null;
  }
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
// The large directory is geography only. Expose registered map points only
// after an exact OSM join or an admitted official-coordinate/catalogue proof.
// It carries no price or availability conclusion.
export function boundMagnitMapLocations(directory){
  if(directory?.schemaVersion!==1||directory.region!=='moscow-and-oblast'
    ||directory.exhaustive!==false||directory.priceEvidence!==false
    ||!Array.isArray(directory.stores)||directory.stores.length>25000
    ||!Number.isFinite(Date.parse(directory.observedAt)))return Object.freeze([]);
  const byCode=new Map();
  for(const point of directory.stores){
    if(point?.retailerId!=='magnit'||!point.catalogBinding)continue;
    const binding=nearbyCatalogBinding(point),store=binding?.store;
    if(!store||typeof store.shopCode!=='string'||!/^\d{6}$/u.test(store.shopCode)
      ||!Number.isFinite(point.lat)||!Number.isFinite(point.lon)
      ||Math.abs(point.lat)>90||Math.abs(point.lon)>180
      ||typeof point.address!=='string'||point.address.length>300)continue;
    const official=point.catalogBinding.kind==='official-registered-store-code';
    if(!official&&(typeof point.id!=='string'||!/^osm:(?:node|way|relation):\d+$/u.test(point.id)
      ||point.sourceUrl!==`https://www.openstreetmap.org/${point.id.split(':')[1]}/${point.id.split(':')[2]}`))continue;
    const code=store.shopCode;
    // Two geography points for one shop are ambiguous: select neither.
    if(byCode.has(code)){byCode.set(code,null);continue;}
    byCode.set(code,Object.freeze({...point,id:official?point.id:`magnit-bound-${code}`,name:'Магнит',shopCode:code,
      storeIds:Object.freeze([`magnit-shop-${code}`,`magnit-${code}`]),
      coordinateKind:official?'official-registered-store-code':'osm-exact-address-join',selectionKind:'registered-store',
      evidenceKind:official?'dated-official-registered-store-code':'dated-osm-exact-address-join',evidenceUrl:point.sourceUrl,
      observedAt:official?point.observedAt:directory.observedAt}));
  }
  // Keep all bounded data; the map limits visible pins nearest its centre and
  // lists render a finite first page. More than 200 stores must not erase it.
  return Object.freeze([...byCode.values()].filter(Boolean));
}
const localDirectoryHosts=new Set(['www.openstreetmap.org','globus.ru','www.globus.ru']);
const regionalDirectoryHosts=new Set(['www.openstreetmap.org','www.metro-cc.ru','magnit.ru','spb.vkusvill.ru','kzn.vkusvill.ru','ekb.vkusvill.ru','nnv.vkusvill.ru']);
export function nearbyGroceryMatches(stores,position,radiusKm,{connectedOnly=false,regional=false}={}){
  if(!Array.isArray(stores)||!Number.isFinite(radiusKm)||radiusKm<1||radiusKm>20)return[];
  const seen=new Set();return stores.flatMap(point=>{
    const meters=distanceMeters(position,point);if(meters===null||meters>radiusKm*1000||typeof point.name!=='string'||!point.id||seen.has(point.id))return[];
    try{const u=new URL(point.sourceUrl);if(u.protocol!=='https:'||u.username||u.password
      ||!((regional?regionalDirectoryHosts:localDirectoryHosts).has(u.hostname)||!regional&&officialMagnitPoints.has(point)))return[];}catch{return[];}
    seen.add(point.id);const binding=regional?null:nearbyCatalogBinding(point);if(connectedOnly&&!binding)return[];
    return[{...point,distanceMeters:meters,catalog:binding}];
  }).sort((a,b)=>a.distanceMeters-b.distanceMeters||a.id.localeCompare(b.id));
}
// The full directory is retained for search and pagination. Only map markers
// are capped, nearest the viewed point; selected pins remain available.
export function nearestStoreMapPins(stores,position,{selectedIds=[]}={}){
  const ranked=[...stores].sort((a,b)=>(distanceMeters(position,a)??Infinity)-(distanceMeters(position,b)??Infinity)||a.id.localeCompare(b.id));
  const selected=new Set(selectedIds),keep=ranked.filter(p=>selected.has(p.id)).slice(0,200);
  const seen=new Set(keep.map(p=>p.id));
  for(const point of ranked){if(keep.length>=200)break;if(!seen.has(point.id)){keep.push(point);seen.add(point.id);}}
  return keep;
}
export{normalizedAddressCandidate}from'./nearbyAddressContract.mjs';
