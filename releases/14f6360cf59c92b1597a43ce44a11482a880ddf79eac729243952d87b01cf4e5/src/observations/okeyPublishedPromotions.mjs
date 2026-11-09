import { moscowDate } from './okeyOfficialPromotions.mjs';
export const PUBLISHED_URL='https://mos.proshoper.ru/actions/okej/moskva/';
export const PUBLISHED_SCOPE='third-party-moscow-city-promotion-not-exact-store';
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function date(day,month,year) {
  const m=months.indexOf(month)+1,d=Number(day),y=Number(year),at=new Date(Date.UTC(y,m-1,d));
  return m&&at.getUTCMonth()+1===m&&at.getUTCDate()===d&&at.getUTCFullYear()===y?at.toISOString().slice(0,10):null;
}
export function parseCataloguePeriod(text) {
  const m=text?.trim().toLowerCase().match(/^с (\d{1,2})(?: ([а-яё]+))? по (\d{1,2}) ([а-яё]+) (20\d{2})$/u);
  if(!m)return null;
  const from=date(m[1],m[2]||m[4],m[5]),until=date(m[3],m[4],m[5]);
  return from&&until&&from<=until&&Date.parse(until)-Date.parse(from)<=31*86_400_000?{from,until}:null;
}
function money(rubles,cents) {
  if(!/^[\d\s]+$/u.test(rubles??'')||!/^\d{2}$/.test(cents??''))return null;
  const n=Number(rubles.replace(/\s/gu,''))*100+Number(cents);
  return Number.isSafeInteger(n)&&n>0&&n<=100_000_000?n:null;
}
export function publishedProductUrl(id) {
  return /^\d{5,12}$/.test(id??'')?PUBLISHED_URL+'#id_product_'+id:null;
}
export function parsePublishedCatalogue(raw) {
  const at=Date.parse(raw?.observedAt),period=parseCataloguePeriod(raw?.period);
  if(raw?.sourceUrl!==PUBLISHED_URL||!/^КАТАЛОГ АКЦИЙ\s+«ОКЕЙ ГИПЕРМАРКЕТ»\s*[—–-]\s*МОСКВА$/iu.test(raw.title?.trim()??'')
    ||!Number.isFinite(at)||!period||period.from>moscowDate(at)||period.until<moscowDate(at)||!Array.isArray(raw.products))return null;
  const ids=new Set(),products=[];
  for(const p of raw.products.slice(0,200)) {
    const name=p.name?.replace(/\s+/gu,' ').trim(),priceMinor=money(p.rubles,p.cents),url=publishedProductUrl(p.id);
    const end=p.endText?.trim().toLowerCase().match(/^до (\d{1,2}) ([а-яё]+)$/u);
    const endDate=end?date(end[1],end[2],period.until.slice(0,4)):null;
    if(!url||ids.has(p.id)||!name||name.length>400||!priceMinor||!endDate||endDate<period.from)continue;
    const validUntil=endDate<period.until?endDate:period.until;
    if(validUntil<moscowDate(at))continue;
    ids.add(p.id);products.push({sourceProductId:p.id,name,productUrl:url,priceMinor,
      referenceOldPriceMinor:money(p.oldRubles,p.oldCents),priceWithCardMinor:null,priceWithoutCardMinor:null,
      priceCondition:'promotion-conditions-unconfirmed',availability:'unknown',validFrom:period.from,validUntil,
      observedAt:new Date(at).toISOString()});
  }
  const snapshot={version:1,kind:'okey-published-city-promotions',retailerId:'okey',publisher:'proshoper',
    sourceUrl:PUBLISHED_URL,scope:PUBLISHED_SCOPE,selectedCity:'Москва',physicalStoreId:null,physicalStoreAddress:null,
    complete:false,cataloguePeriod:period,observedAt:new Date(at).toISOString(),products};
  return validPublishedSnapshot(snapshot)?snapshot:null;
}
export function validPublishedSnapshot(s) {
  const at=Date.parse(s?.observedAt),period=s?.cataloguePeriod;
  if(s?.version!==1||s.kind!=='okey-published-city-promotions'||s.retailerId!=='okey'||s.publisher!=='proshoper'
    ||s.sourceUrl!==PUBLISHED_URL||s.scope!==PUBLISHED_SCOPE||s.selectedCity!=='Москва'||s.physicalStoreId!==null
    ||s.physicalStoreAddress!==null||s.complete!==false||!Number.isFinite(at)||!period
    ||![period.from,period.until].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)
    ||period.from>moscowDate(at)||period.until<moscowDate(at)||period.from>period.until
    ||Date.parse(period.until)-Date.parse(period.from)>31*86_400_000
    ||!Array.isArray(s.products)||!s.products.length||s.products.length>200)return false;
  const ids=new Set();
  return s.products.every(p=>{
    if(p.productUrl!==publishedProductUrl(p.sourceProductId)||!publishedProductUrl(p.sourceProductId)||ids.has(p.sourceProductId)
      ||typeof p.name!=='string'||!p.name.trim()||p.name.length>400||!Number.isSafeInteger(p.priceMinor)||p.priceMinor<=0||p.priceMinor>100_000_000
      ||!(p.referenceOldPriceMinor===null||Number.isSafeInteger(p.referenceOldPriceMinor)&&p.referenceOldPriceMinor>0)
      ||p.priceWithCardMinor!==null||p.priceWithoutCardMinor!==null||p.availability!=='unknown'||p.priceCondition!=='promotion-conditions-unconfirmed'
      ||p.observedAt!==s.observedAt||p.validFrom!==period.from||!/^\d{4}-\d{2}-\d{2}$/.test(p.validUntil)
      ||!Number.isFinite(Date.parse(p.validUntil))||new Date(p.validUntil).toISOString().slice(0,10)!==p.validUntil
      ||p.validUntil<moscowDate(at)||p.validUntil>period.until)return false;
    ids.add(p.sourceProductId);return true;
  });
}
export function currentPublishedProducts(s,nowMs=Date.now()) {
  if(!validPublishedSnapshot(s)||Date.parse(s.observedAt)>nowMs||nowMs-Date.parse(s.observedAt)>86_400_000)return [];
  return s.products.filter(p=>p.validFrom<=moscowDate(nowMs)&&p.validUntil>=moscowDate(nowMs));
}
export function verifyPublishedRefresh({startedAt,status,snapshot,nowMs=Date.now()}) {
  const start=Date.parse(startedAt),attempt=Date.parse(status?.lastAttemptAt);
  if(!Number.isFinite(start)||start>nowMs||status?.status!=='collected'||status.sourceUrl!==PUBLISHED_URL||status.scope!==PUBLISHED_SCOPE
    ||!Number.isFinite(attempt)||attempt<start||attempt>nowMs||!validPublishedSnapshot(snapshot)
    ||Date.parse(snapshot.observedAt)<attempt||Date.parse(snapshot.observedAt)>nowMs||status.uniqueProducts!==snapshot.products.length)
    return {fresh:false,reason:status?.status==='blocked'?'published-source-blocked':'no-new-published-evidence'};
  const products=currentPublishedProducts(snapshot,nowMs);
  return {fresh:products.length>0,reason:products.length?'fresh-published-city-promotions':'no-current-promotions',
    scope:PUBLISHED_SCOPE,products:products.length,observedAt:snapshot.observedAt,publisher:'proshoper'};
}
