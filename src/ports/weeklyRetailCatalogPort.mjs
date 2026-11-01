import { createRetailCatalogClient,readBoundedJsonResponse } from './retailCatalogPort.mjs';
import {WEEKLY_PEREKRESTOK_IDENTITIES} from '../catalog/weeklyPerekrestokIdentities.mjs';
import { WEEKLY_MAGNIT_IDENTITIES } from '../catalog/weeklyMagnitIdentities.mjs';
import { validPublishedSnapshot,currentPublishedProducts,PUBLISHED_URL } from '../observations/okeyPublishedPromotions.mjs';
import {validPyatSnapshot,pyatWeeklyCards,validPyatWeeklySource,PYAT_WEEKLY_SCOPE} from '../observations/pyaterochkaPublishedPromotions.mjs';
import {resolveRegisteredMagnitStore} from '../data/registeredMagnitStores.mjs';
import {PEREKRESTOK_REVIEWED_LIST_CONTEXT} from '../catalog/perekrestokReviewedList.mjs';
export {PYAT_WEEKLY_SCOPE};
export const PEREKRESTOK_WEEKLY_SCOPE=Object.freeze({...PEREKRESTOK_REVIEWED_LIST_CONTEXT,
  storeAddress:PEREKRESTOK_REVIEWED_LIST_CONTEXT.locationLabel,priceScope:'delivery-catalog'});

export const OKEY_WEEKLY_SCOPE=Object.freeze({retailerId:'okey',storeId:'okey-moscow-proshoper',storeName:'О’КЕЙ · акции Москвы (Прошопер)',
  storeAddress:'Городской каталог, физический магазин не подтверждён',priceScope:'city-promotion',physicalStoreId:null});
const normalize=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
export function weeklyMagnitCard(card) {
  if(card?.retailerId!=='magnit')return card;
  const condition=`${card.priceConditionLabel??'Условие цены неизвестно'} · условия карты не подтверждены`;
  card={...card,priceConditionLabel:condition};
  if(card?.retailerId==='magnit'&&/весов|примерно|около|[~≈]/iu.test(card.name??''))
    return {...card,unit:'упаковка',catalogPurchaseBasis:null};
  const identity=WEEKLY_MAGNIT_IDENTITIES.find(p=>p.sourceProductId===card?.sourceProductId&&normalize(p.name)===normalize(card.name));
  if(!identity||card.retailerId!=='magnit')return card;
  let url;try{url=new URL(card.productUrl);}catch{return card;}
  if(url.protocol!=='https:'||!['magnit.ru','www.magnit.ru'].includes(url.host)||url.pathname!==identity.productPath
    ||!/^\d{4,12}$/.test(url.searchParams.get('shopCode')??'')||!card.id.startsWith('retail:magnit:magnit-'+url.searchParams.get('shopCode')+':'))return card;
  // An exact, reviewed pack identity can repair missing descriptive weight;
  // it cannot change the observed amount, condition, address or timestamp.
  if(card.unit&&card.unit!=='упаковка'&&normalize(card.unit).replaceAll(' ','')!==normalize(identity.unit).replaceAll(' ',''))return card;
  return {...card,unit:identity.unit,priceConditionLabel:condition,...(identity.purchaseBasis==='weighed-portion'?{
    catalogPurchaseBasis:'weighed-portion',
    priceConditionLabel:`${condition} · весовой товар: цена за ориентировочную порцию ${identity.unit}; стоимость зависит от фактической массы`
  }:{})};
}
const okeyUnits=Object.freeze({
  '51922355':{name:'БЗМЖ Йогурт Даниссимо Фантазия хрустящие шарики6,9%105г',unit:'105 г'},
  '51922403':{name:'БЗМЖ Сыр Ламбер мдж в сух в-е 50% сычужный Россия кг',unit:'1 кг'},
  '51922605':{name:'Свинина шея без кости п/ф охлажденный кг',unit:'1 кг'},
  '51922604':{name:'Свинина шея без кости п/ф охлажденный (прилавок) кг',unit:'1 кг'}
});
export function weeklyOkeyCards(snapshot,nowMs=Date.now()) {
  return currentPublishedProducts(snapshot,nowMs).flatMap(p=>{
    const unit=okeyUnits[p.sourceProductId];if(!unit||normalize(unit.name)!==normalize(p.name))return [];
    return [{id:`retail:okey:${OKEY_WEEKLY_SCOPE.storeId}:${p.sourceProductId}`,retailerId:'okey',sourceProductId:p.sourceProductId,
      name:p.name.replace(/^БЗМЖ\s+/u,''),sourceName:p.name,unit:unit.unit,priceMinor:p.priceMinor,currency:'RUB',availability:'unknown',
      sourceUrl:p.productUrl,productUrl:p.productUrl,observedAt:p.observedAt,validUntil:p.validUntil,
      priceCondition:'promotion-conditions-unconfirmed',priceConditionLabel:'Акция из стороннего городского каталога; условия карты неизвестны',
      priceScope:'city-promotion',physicalStoreId:null,publisher:'proshoper'}];
  });
}
export function validWeeklyCardSource(card,scope) {
  if(scope?.retailerId==='pyaterochka')return validPyatWeeklySource(card,scope);
  if(scope?.retailerId!=='okey')return false;
  const id=card?.sourceProductId,unit=okeyUnits[id];
  return scope.storeId===OKEY_WEEKLY_SCOPE.storeId&&unit&&card.id===`retail:okey:${scope.storeId}:${id}`
    &&card.retailerId==='okey'&&card.productUrl===PUBLISHED_URL+'#id_product_'+id&&card.sourceUrl===card.productUrl
    &&card.physicalStoreId===null&&card.priceScope==='city-promotion'&&card.unit===unit.unit
    &&normalize(card.name)===normalize(unit.name.replace(/^БЗМЖ\s+/u,''));
}
export function createWeeklyRetailCatalogPort({fetchImpl=globalThis.fetch,createMagnitClient=createRetailCatalogClient,now=Date.now}={}) {
  let deliveryPending=null,deliveryChecked=-Infinity;
  function deliveryRows(){
    if(deliveryPending&&now()-deliveryChecked<30000)return deliveryPending;
    deliveryChecked=now();
    const client=createMagnitClient({retailerId:'perekrestok',fetchImpl});
    const ids=WEEKLY_PEREKRESTOK_IDENTITIES.map(p=>p.sourceProductId);
    // Two finite ID reads replace fifteen concurrent wildcard searches.
    // Coalesce both success and failure for 30s; do not hammer an outage.
    deliveryPending=Promise.all([ids.slice(0,40),ids.slice(40)].filter(chunk=>chunk.length)
      .map(chunk=>client.bySourceProductIds(chunk))).then(results=>{
        if(results.some(r=>r?.kind!=='catalog'))return {kind:'unavailable'};
        return {kind:'catalog',products:results.flatMap(r=>r.products)};
      }).catch(()=>({kind:'unavailable'}));
    return deliveryPending;
  }
  let cached=null,inFlight=null,checkedAt=0;
  let pyatCached=null,pyatPending=null,pyatChecked=0;
  async function pyat(){
    if(pyatChecked&&now()-pyatChecked<60000)return pyatCached?pyatWeeklyCards(pyatCached,now()):[];
    if(!pyatPending)pyatPending=(async()=>{try{
      const r=await fetchImpl(new URL('../data/pyaterochkaPublishedPromotions.json',import.meta.url),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(5000)});
      if(!r.ok)return[];const data=await readBoundedJsonResponse(r,262144);if(!validPyatSnapshot(data))return[];
      pyatCached=data;return pyatWeeklyCards(data,now());
    }catch{return[];}finally{pyatChecked=now();pyatPending=null;}})();return pyatPending;
  }
  async function okey() {
    if(checkedAt&&now()-checkedAt<60_000)return cached?weeklyOkeyCards(cached,now()):[];
    if(!inFlight)inFlight=(async()=>{
      try {
        const response=await fetchImpl(new URL('../data/okeyPublishedPromotions.json',import.meta.url),
          {cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(5000)});
        if(!response.ok)return [];
        const data=await readBoundedJsonResponse(response,262144);if(!validPublishedSnapshot(data))return [];
        cached=data;checkedAt=now();return weeklyOkeyCards(data,now());
      }catch{return [];}finally{checkedAt=now();inFlight=null;}
    })();return inFlight;
  }
  return {async search(query,{scope,limit=40}={}) {
    if(scope?.retailerId==='perekrestok'){
      if(scope.storeId!==PEREKRESTOK_WEEKLY_SCOPE.storeId)return {kind:'unavailable'};
      const identities=WEEKLY_PEREKRESTOK_IDENTITIES.filter(p=>p.query===normalize(query));
      if(!identities.length)return {kind:'catalog',products:[]};
      const response=await deliveryRows();
      if(response?.kind!=='catalog')return response;
      return {...response,products:response.products.flatMap(card=>{
        const identity=identities.find(p=>p.sourceProductId===card.sourceProductId);
        if(!identity||normalize(card.name)!==normalize(identity.name)||normalize(card.unit)!==normalize(identity.sourceUnit)
          ||card.id!==`retail:perekrestok:${PEREKRESTOK_WEEKLY_SCOPE.storeId}:${identity.sourceProductId}`
          ||card.productUrl!==PEREKRESTOK_WEEKLY_SCOPE.sourceUrl)return [];
        return [{...card,unit:identity.unit,...(identity.weighed?{catalogPurchaseBasis:'weighed-portion'}:{})}];
      }).slice(0,Math.min(40,limit))};
    }
    if(scope?.retailerId==='pyaterochka'&&scope.storeId===PYAT_WEEKLY_SCOPE.storeId){
      const q=normalize(query);return{kind:'catalog',products:(await pyat()).filter(p=>normalize(p.name).includes(q)).slice(0,Math.min(40,limit))};
    }
    if(scope?.retailerId==='okey'&&scope.storeId===OKEY_WEEKLY_SCOPE.storeId){
      const q=normalize(query);return {kind:'catalog',products:(await okey()).filter(p=>normalize(p.name).includes(q)).slice(0,Math.min(40,limit))};
    }
    if(scope?.retailerId==='magnit'){
      // The current catalogue scope carries storeId without an embedded store.
      // Resolve only that registered ID; an explicit contradictory store fails closed.
      const code=typeof scope.storeId==='string'?/^magnit-(\d{1,12})$/u.exec(scope.storeId)?.[1]:null;
      const store=code?resolveRegisteredMagnitStore({shopCode:code}):null;
      if(!store||(scope.store!==undefined&&scope.store?.shopCode!==code))return{kind:'unavailable'};
      const response=await createMagnitClient({retailerId:'magnit',store}).search(query,{limit});
      return response?.kind==='catalog'?{...response,products:response.products.map(weeklyMagnitCard)}:response;
    }
    return {kind:'unavailable'};
  }};
}
