import { nearbyGeocoderRegion } from './nearbyRegions.mjs';

export function normalizedAddressCandidate(feature){
  const p=feature?.properties,xy=feature?.geometry?.coordinates;
  if(feature?.geometry?.type!=='Point'||!Array.isArray(xy)||xy.length!==2||!xy.every(Number.isFinite)
    ||typeof p?.countrycode!=='string'||p.countrycode.toUpperCase()!=='RU'
    ||!nearbyGeocoderRegion(p,{lon:xy[0],lat:xy[1]}))return null;
  const parts=[p.state,p.city??p.town??p.village,p.district,p.street,p.housenumber,p.name];
  if(parts.some(v=>v!=null&&(typeof v!=='string'||v.length>160)))return null;
  const label=[...new Set(parts.filter(Boolean))].join(', ');if(!label||label.length>500)return null;
  return{lat:xy[1],lon:xy[0],label,precision:p.housenumber?'house':p.street?'street':'locality'};
}
