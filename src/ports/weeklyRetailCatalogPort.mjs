import { createRetailCatalogClient,readBoundedJsonResponse } from './retailCatalogPort.mjs';
import { WEEKLY_MAGNIT_IDENTITIES } from '../catalog/weeklyMagnitIdentities.mjs';
import { validPublishedSnapshot,currentPublishedProducts,PUBLISHED_URL } from '../observations/okeyPublishedPromotions.mjs';

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
  if(scope?.retailerId!=='okey')return false;
  const id=card?.sourceProductId,unit=okeyUnits[id];
  return scope.storeId===OKEY_WEEKLY_SCOPE.storeId&&unit&&card.id===`retail:okey:${scope.storeId}:${id}`
    &&card.retailerId==='okey'&&card.productUrl===PUBLISHED_URL+'#id_product_'+id&&card.sourceUrl===card.productUrl
    &&card.physicalStoreId===null&&card.priceScope==='city-promotion'&&card.unit===unit.unit
    &&normalize(card.name)===normalize(unit.name.replace(/^БЗМЖ\s+/u,''));
}
export function createWeeklyRetailCatalogPort({fetchImpl=globalThis.fetch,createMagnitClient=createRetailCatalogClient,now=Date.now}={}) {
  let cached=null,inFlight=null,checkedAt=0;
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
    if(scope?.retailerId==='okey'&&scope.storeId===OKEY_WEEKLY_SCOPE.storeId){
      const q=normalize(query);return {kind:'catalog',products:(await okey()).filter(p=>normalize(p.name).includes(q)).slice(0,Math.min(40,limit))};
    }
    if(scope?.retailerId==='magnit'&&scope.store?.shopCode){
      const response=await createMagnitClient({retailerId:'magnit',store:scope.store}).search(query,{limit});
      return response?.kind==='catalog'?{...response,products:response.products.map(weeklyMagnitCard)}:response;
    }
    return {kind:'unavailable'};
  }};
}
