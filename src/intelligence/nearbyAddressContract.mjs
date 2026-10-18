export function normalizedAddressCandidate(feature){
  const p=feature?.properties,xy=feature?.geometry?.coordinates;
  if(feature?.geometry?.type!=='Point'||!Array.isArray(xy)||xy.length!==2||!xy.every(Number.isFinite)
    ||xy[0]<35||xy[0]>41||xy[1]<54||xy[1]>58||typeof p?.countrycode!=='string'||p.countrycode.toUpperCase()!=='RU'
    ||!['Москва','Московская область'].includes(p.state))return null;
  const parts=[p.state,p.city??p.town??p.village,p.district,p.street,p.housenumber,p.name];
  if(parts.some(v=>v!=null&&(typeof v!=='string'||v.length>160)))return null;
  const label=[...new Set(parts.filter(Boolean))].join(', ');if(!label||label.length>500)return null;
  return{lat:xy[1],lon:xy[0],label,precision:p.housenumber?'house':p.street?'street':'locality'};
}
