export function parseDeliveryProduct(row,category) {
  if(typeof row?.displayedText!=='string')return null;
  const m=row.displayedText.match(/^(.*), Цена ([\d\s\u00a0\u2009]+(?:[.,]\d{1,2})?)\s*₽(?: вместо ([\d\s\u00a0\u2009]+(?:[.,]\d{1,2})?)\s*₽)?(?:,\s*(.+))?$/u);
  if(!m)return null;
  const money=s=>s==null?null:Math.round(Number(s.replace(/\s/g,'').replace(',','.'))*100);
  let url;try{url=new URL(row.productUrl);}catch{return null;}
  if(url.protocol!=='https:'||url.hostname!=='eda.yandex.ru'||!url.pathname.startsWith('/retail/okej_retail/product/'))return null;
  const price=money(m[2]),old=money(m[3]);
  if(!Number.isSafeInteger(price)||price<=0||(old!==null&&(!Number.isSafeInteger(old)||old<=0)))return null;
  return {displayedText:row.displayedText,productUrl:url.href,sourceProductId:url.pathname.split('/').at(-1),
    name:m[1].trim(),displayedPriceKopeks:price,referenceOldPriceKopeks:old,displayedPackage:m[4]?.trim()??null,
    category,priceWithCardKopeks:null,priceWithoutCardKopeks:null,availability:'unknown'};
}

export function addressMatches(text) {
  if(typeof text!=='string')return false;
  const normalized=text.toLocaleLowerCase('ru-RU').replace(/[\s,]/g,'');
  return normalized==='проспектмира211к2'||normalized==='москвапроспектмира211к2';
}
