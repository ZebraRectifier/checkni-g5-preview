import {WEEKLY_MAGNIT_IDENTITIES} from './weeklyMagnitIdentities.mjs';
import {WEEKLY_PEREKRESTOK_IDENTITIES} from './weeklyPerekrestokIdentities.mjs';
import {PEREKRESTOK_REVIEWED_LIST_CONTEXT as PEREK, matchesReviewedPerekrestokListContext} from './perekrestokReviewedList.mjs';
import {resolveRegisteredMagnitStore} from '../data/registeredMagnitStores.mjs';
import {catalogPurchaseUnit} from '../core/catalogDraft.mjs';
import {weeklyMagnitCard} from './reviewedMagnitCatalogCard.mjs';
const key=s=>typeof s==='string'?s.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim():null;
const unit=s=>key(s)?.replaceAll(' ','').replace(',', '.');

// Selecting a reviewed source SKU into a list does not establish a canonical
// cross-store equivalent or a commercially admitted offer. Keep the exact
// source/store ID. Prices, dates and stock never enter the stored product.
export function sourceScopedRetailListSelection(input) {
 if(!input||typeof input!=='object'||!['magnit','perekrestok'].includes(input.retailerId)
   ||typeof input.sourceProductId!=='string'||!input.sourceProductId||input.sourceProductId.length>80
   ||typeof input.name!=='string'||!input.name.trim()||input.name.length>300
   ||!Number.isSafeInteger(input.priceMinor)||input.priceMinor<=0||input.currency!=='RUB'
   ||input.availability!=='unknown'||typeof input.observedAt!=='string'||input.observedAt.length>40
   ||input.priceConditionLabel!=null&&(typeof input.priceConditionLabel!=='string'||input.priceConditionLabel.length>1000)
   ||!Number.isFinite(Date.parse(input.observedAt))
   ||Date.parse(input.observedAt)>Date.now())return null;
 let card;
 if(input.retailerId==='magnit') {
   const identity=WEEKLY_MAGNIT_IDENTITIES.find(p=>p.sourceProductId===input.sourceProductId&&key(p.name)===key(input.name));
   if(!identity||input.priceCondition!=='public-online')return null;
   let code,store;
   for(const raw of [input.productUrl,input.sourceUrl]) {
     let url;try{url=new URL(raw);}catch{return null;}
     const candidate=url.searchParams.get('shopCode');
     store=resolveRegisteredMagnitStore({shopCode:candidate});
     if(!store||code&&code!==candidate||url.protocol!=='https:'||url.username||url.password||url.hash
       ||!['magnit.ru','www.magnit.ru'].includes(url.host)||url.pathname!==identity.productPath
       ||url.searchParams.getAll('shopCode').length!==1||url.searchParams.getAll('shopType').length!==1
       ||url.searchParams.get('shopType')!==String(store.shopType??'1')
       ||[...url.searchParams.keys()].some(k=>!['shopCode','shopType'].includes(k)))return null;
     code=candidate;
   }
   if(input.id!==`retail:magnit:magnit-${code}:${identity.sourceProductId}`
     ||input.storeId!=null&&input.storeId!==`magnit-${code}`
     ||input.unit&&input.unit!=='упаковка'&&unit(input.unit)!==unit(identity.unit))return null;
   card=weeklyMagnitCard(input);
   if(unit(card.unit)!==unit(identity.unit))return null;
 } else {
   const identity=WEEKLY_PEREKRESTOK_IDENTITIES.find(p=>p.sourceProductId===input.sourceProductId&&key(p.name)===key(input.name));
   if(!identity||!matchesReviewedPerekrestokListContext(input)
     ||input.id!==`retail:perekrestok:${PEREK.storeId}:${identity.sourceProductId}`
     ||input.storeId!=null&&input.storeId!==PEREK.storeId
     ||input.sourceUrl!==PEREK.sourceUrl||input.productUrl!==PEREK.sourceUrl
     ||!['yandex-eda-regular','yandex-eda-promo'].includes(input.priceCondition)
     ||![unit(identity.sourceUnit),unit(identity.unit)].includes(unit(input.unit)))return null;
   card={...input,unit:identity.unit,...(identity.weighed?{catalogPurchaseBasis:'weighed-portion'}:{})};
 }
 const purchaseUnit=catalogPurchaseUnit(card);
 if(!purchaseUnit)return null;
 return {card,product:Object.freeze({id:card.id,name:card.name,
   unit:purchaseUnit.approximate?purchaseUnit.label:card.unit,
   category:typeof card.category==='string'?card.category:'Продукты · выбранный каталог'})};
}
