// Exact component equality only. No edit distance, transliteration, substring
// house matching, district inference or postcode-to-coordinate inference.
const clean=value=>String(value??'').replaceAll('№',' ').normalize('NFKC').toLowerCase().replaceAll('ё','е').replace(/\s+/gu,' ').trim();
const roadTypes=new Map([['улица','улица'],['ул','улица'],['проспект','проспект'],['пр-кт','проспект'],['шоссе','шоссе'],['ш','шоссе'],['переулок','переулок'],['пер','переулок'],['проезд','проезд'],['пр-д','проезд'],['бульвар','бульвар'],['б-р','бульвар'],['аллея','аллея']]);
const typePattern='улица|ул\\.?|проспект|пр-кт|шоссе|ш\\.?|переулок|пер\\.?|проезд|пр-д|бульвар|б-р|аллея';
const start=new RegExp('^('+typePattern+')\\s+(.+)$','u'),end=new RegExp('^(.+)\\s+('+typePattern+')$','u');
export function exactMagnitAddressKey(address){
 if(typeof address!=='string'||address.length>300)return null;
 const parts=address.split(',').map(clean).filter(Boolean);
 if(/^\d{6}$/u.test(parts[0]??''))parts.shift();
 if(/^(?:московская область|московская обл\.?)$/u.test(parts[0]??''))parts.shift();
 if(parts.length<3||parts.length>5)return null;
 const locality=parts.shift().replace(/^(?:г\.?|город)\s+/u,'').replace(/\s+(?:г\.?|город)$/u,'');
 if(!locality||/\d|район|р-н|область|обл\./u.test(locality))return null;
 const road=parts.shift(),a=road.match(start),b=road.match(end);
 const type=a?.[1]??b?.[2],name=a?.[2]??b?.[1];
 if(!type||!name)return null;
 const house=parts.join(' ').replace(/^(?:дом|д\.?)\s*(?:№\s*)?/u,'')
  .replace(/(?:корпус|корп\.?|к\.?)\s*/gu,'к').replace(/(?:строение|стр\.?|с\.?)\s*/gu,'с').replace(/\s/gu,'');
 if(!/^\d+[а-яa-z]?(?:[\/-]\d+[а-яa-z]?)?(?:(?:к|с)\d+[а-яa-z]?)*$/u.test(house))return null;
 return [locality,roadTypes.get(type.replace(/\.$/u,'')),name,house].join('|');
}

export function uniqueMagnitAddressBindings(stores){
 const result=new Map();
 for(const store of stores){
  if(!/^\d+$/u.test(store?.shopCode??''))continue;
  const key=exactMagnitAddressKey(store.address);if(!key)continue;
  const previous=result.get(key);
  if(previous===undefined)result.set(key,store);
  else if(previous?.shopCode!==store.shopCode)result.set(key,null);
 }
 return result;
}
