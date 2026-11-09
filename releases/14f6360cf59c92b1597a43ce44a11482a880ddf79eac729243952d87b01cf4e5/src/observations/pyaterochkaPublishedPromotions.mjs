import{parseCataloguePeriod}from'./okeyPublishedPromotions.mjs';
import{moscowDate}from'./okeyOfficialPromotions.mjs';
export const PYAT_PUBLISHED_URL='https://mos.proshoper.ru/actions/pyaterochka/moskva/';
export const PYAT_PUBLISHED_SCOPE='third-party-moscow-city-promotion-not-exact-store';
export const PYAT_WEEKLY_SCOPE=Object.freeze({retailerId:'pyaterochka',storeId:'pyaterochka-moscow-proshoper',
  storeName:'Пятёрочка · акции Москвы (Прошопер)',storeAddress:'Городской каталог, физический магазин не подтверждён',priceScope:'city-promotion',physicalStoreId:null});
const food=new Set(['frukty-ovoshi-zelen','moloko-syr-yajca','myaso-ryba-kolbasy','zamorozhennye-produkty','konservaciya',
  'makarony-krupy-muka','masla-sousy-specii','sladosti-vypechka-hleb','chaj-kofe-kakao','voda-soki-napitki','orehi-sneki']);
const clean=s=>String(s??'').normalize('NFKC').replace(/\s+/gu,' ').trim();
const money=(r,c)=>typeof r==='string'&&typeof c==='string'&&/^[\d\s]+$/u.test(r)&&/^\d{2}$/u.test(c)?Number(r.replace(/\s/gu,''))*100+Number(c):null;
export const pyatProductUrl=id=>typeof id==='string'&&/^\d{5,12}$/u.test(id)?PYAT_PUBLISHED_URL+'#id_product_'+id:null;
export function parsePyatCatalogue(raw){
  const period=parseCataloguePeriod(raw?.period),at=Date.parse(raw?.observedAt);
  if(raw?.sourceUrl!==PYAT_PUBLISHED_URL||!/^КАТАЛОГ АКЦИЙ\s+«ПЯТЕРОЧКА»\s*[—–-]\s*МОСКВА$/iu.test(clean(raw.title))
    ||!period||!Number.isFinite(at)||period.from>moscowDate(at)||period.until<moscowDate(at)||!Array.isArray(raw.products)||raw.products.length>500)return null;
  const seen=new Set(),products=[],counts=new Map();
  for(const p of raw.products)counts.set(p?.id,(counts.get(p?.id)??0)+1);
  for(const p of raw.products){
    if(!p||typeof p!=='object')continue;
    const id=p.id,name=clean(p.name),priceMinor=money(p.rubles,p.cents);
    if(!pyatProductUrl(id)||counts.get(id)!==1||seen.has(id)||typeof p.name!=='string'||p.currency!=='RUB'||!food.has(p.category)||!name||name.length>400||!Number.isSafeInteger(priceMinor)
      ||priceMinor<=0||priceMinor>100_000_000||(p.endText!=null&&(typeof p.endText!=='string'||p.endText.trim())))continue;
    seen.add(id);products.push({sourceProductId:id,name,category:p.category,priceMinor,productUrl:pyatProductUrl(id),
      priceWithCardMinor:null,priceWithoutCardMinor:null,priceCondition:'promotion-conditions-unconfirmed',availability:'unknown',
      validFrom:period.from,validUntil:period.until,observedAt:new Date(at).toISOString()});
  }
  const s={version:1,kind:'pyaterochka-published-city-promotions',retailerId:'pyaterochka',publisher:'proshoper',sourceUrl:PYAT_PUBLISHED_URL,
    scope:PYAT_PUBLISHED_SCOPE,selectedCity:'Москва',physicalStoreId:null,physicalStoreAddress:null,complete:false,
    cataloguePeriod:period,observedAt:new Date(at).toISOString(),products};
  return validPyatSnapshot(s)?s:null;
}
export function validPyatSnapshot(s){
  const at=Date.parse(s?.observedAt),period=s?.cataloguePeriod;
  if(s?.version!==1||s.kind!=='pyaterochka-published-city-promotions'||s.retailerId!=='pyaterochka'||s.publisher!=='proshoper'
    ||s.sourceUrl!==PYAT_PUBLISHED_URL||s.scope!==PYAT_PUBLISHED_SCOPE||s.selectedCity!=='Москва'||s.physicalStoreId!==null
    ||s.physicalStoreAddress!==null||s.complete!==false||!Number.isFinite(at)||new Date(at).toISOString()!==s.observedAt||!period
    ||![period.from,period.until].every(d=>/^\d{4}-\d{2}-\d{2}$/u.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)
    ||period.from>moscowDate(at)||period.until<moscowDate(at)||period.from>period.until||Date.parse(period.until)-Date.parse(period.from)>31*86400000
    ||!Array.isArray(s.products)||!s.products.length||s.products.length>500)return false;
  const ids=new Set();return s.products.every(p=>{
    if(!pyatProductUrl(p.sourceProductId)||p.productUrl!==pyatProductUrl(p.sourceProductId)||ids.has(p.sourceProductId)||!food.has(p.category)
      ||typeof p.name!=='string'||!p.name.trim()||p.name.length>400||!Number.isSafeInteger(p.priceMinor)||p.priceMinor<=0||p.priceMinor>100_000_000
      ||p.observedAt!==s.observedAt||p.validFrom!==period.from||p.validUntil!==period.until||p.availability!=='unknown'
      ||p.priceWithCardMinor!==null||p.priceWithoutCardMinor!==null||p.priceCondition!=='promotion-conditions-unconfirmed')return false;
    ids.add(p.sourceProductId);return true;
  });
}
export function currentPyatProducts(s,nowMs=Date.now()){
  if(!Number.isFinite(nowMs)||!validPyatSnapshot(s)||Date.parse(s.observedAt)>nowMs||nowMs-Date.parse(s.observedAt)>86400000)return[];
  const today=moscowDate(nowMs);return s.products.filter(p=>p.validFrom<=today&&p.validUntil>=today);
}
export function verifyPyatRefresh(snapshot,status,nowMs=Date.now()){
  const current=currentPyatProducts(snapshot,nowMs),attempt=Date.parse(status?.lastAttemptAt);
  const verified=Boolean(current.length&&status?.status==='collected'&&status.collectionMode==='automated'
    &&status.sourceUrl===PYAT_PUBLISHED_URL&&status.scope===PYAT_PUBLISHED_SCOPE&&status.observedAt===snapshot.observedAt
    &&status.uniqueProducts===snapshot.products.length&&Number.isFinite(attempt)&&attempt<=Date.parse(snapshot.observedAt)&&attempt<=nowMs);
  return{verified,currentProducts:current.length,scope:PYAT_PUBLISHED_SCOPE,newMeasurement:verified&&nowMs-Date.parse(snapshot.observedAt)<60000};
}
// Reviewed exact visible packs, not inferred quantities for loose produce or mass-sold milk.
const units=Object.freeze({
  '51936224':{name:'Молоко Му-у ультрапастеризованное 2.5% БЗМЖ 925мл',unit:'925 мл'},
  '51936184':{name:'Гречка ядрица Селяночка быстроразваривающаяся пропаренная 900г',unit:'900 г'},
  '51936229':{name:'Гречка Мистраль 900г',unit:'900 г'},
  '51936105':{name:'Рис Global Village Для плова 800г',unit:'800 г'},
  '51936141':{name:'Рис Селяночка круглозерный шлифованный 900г',unit:'900 г'},
  '51936034':{name:'Рис Селяночка длиннозерный шлифованный 900г',unit:'900 г'}
});
export function pyatWeeklyCards(snapshot,nowMs=Date.now()){
  return currentPyatProducts(snapshot,nowMs).flatMap(p=>{
    const u=units[p.sourceProductId];if(!u||clean(u.name)!==clean(p.name))return[];
    return[{id:`retail:pyaterochka:${PYAT_WEEKLY_SCOPE.storeId}:${p.sourceProductId}`,retailerId:'pyaterochka',sourceProductId:p.sourceProductId,
      name:p.name,sourceName:p.name,unit:u.unit,priceMinor:p.priceMinor,currency:'RUB',availability:'unknown',
      sourceUrl:p.productUrl,productUrl:p.productUrl,observedAt:p.observedAt,validUntil:p.validUntil,
      priceCondition:'promotion-conditions-unconfirmed',priceConditionLabel:'Акция Москвы из Прошопера; условия карты неизвестны',
      priceScope:'city-promotion',physicalStoreId:null,publisher:'proshoper'}];
  });
}
export function validPyatWeeklySource(card,scope){
  const u=units[card?.sourceProductId];
  return Boolean(scope?.retailerId==='pyaterochka'&&scope.storeId===PYAT_WEEKLY_SCOPE.storeId&&u&&card.retailerId==='pyaterochka'
    &&card.id===`retail:pyaterochka:${scope.storeId}:${card.sourceProductId}`&&card.sourceUrl===pyatProductUrl(card.sourceProductId)
    &&card.productUrl===card.sourceUrl&&card.priceScope==='city-promotion'&&card.physicalStoreId===null
    &&card.unit===u.unit&&clean(card.name)===clean(u.name));
}
