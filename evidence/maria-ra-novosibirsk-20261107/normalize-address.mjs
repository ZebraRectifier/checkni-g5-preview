import {createHash} from 'node:crypto';
// Evidence-only normalization. No fuzzy street expansion or house correction.
export function normalizedMariaRaAddressKey(value){
  let text=String(value??'').normalize('NFKC').trim().toLocaleLowerCase('ru-RU').replaceAll('ё','е');
  if(!/^(?:г\.?\s*)?новосибирск\s*,/u.test(text))return null;
  text=text.replace(/^(?:г\.?\s*)?новосибирск\s*,\s*/u,'');
  text=text.replace(/(^|[\s,])(?:улица|ул)\.?\s*/gu,'$1улица ')
    .replace(/(^|[\s,])(?:проспект|пр-кт|пр-т|пр)\.?\s*/gu,'$1проспект ')
    .replace(/(^|[\s,])(?:микрорайон|мкр)\.?\s*/gu,'$1микрорайон ')
    .replace(/,\s*д\.?\s*(?=\d)/gu,', ').replace(/[\s,.]+/gu,' ').trim();
  return text;
}
export function derivedMariaRaId(value){
  const key=normalizedMariaRaAddressKey(value);
  if(!key)throw new Error('unsupported_source_city');
  return 'derived:maria-ra:novosibirsk:'+createHash('sha256').update('maria-ra|novosibirsk|'+key).digest('hex').slice(0,20);
}
