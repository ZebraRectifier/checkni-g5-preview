import {WEEKLY_MAGNIT_IDENTITIES} from '../catalog/weeklyMagnitIdentities.mjs';
import {WEEKLY_PEREKRESTOK_IDENTITIES} from '../catalog/weeklyPerekrestokIdentities.mjs';
import {PEREKRESTOK_REVIEWED_LIST_CONTEXT as PEREK,PEREKRESTOK_REVIEWED_LIST_PACKS} from '../catalog/perekrestokReviewedList.mjs';
import {getReviewedRetailSourceProductIds,matchesReviewedRetailBasketIdentity} from '../catalog/reviewedRetailBasket.mjs';
import {resolveRegisteredMagnitStore} from '../data/registeredMagnitStores.mjs';
import {guidedGroupsForCard,guidedGroupByKey} from '../intelligence/guidedShoppingPlan.mjs';
import {normalizeGuidedComparisonRequest} from '../state/guidedBasketComparison.mjs';
const key=value=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replaceAll('ё','е').replace(/\s+/gu,' ').trim():null;

// This prepares a user request, not an offer or a name-based equivalence.
// Actual SKU, source, pack, amount and observation are checked by the existing
// saved comparison loader/Core after the user explicitly selects the pair.
export function prepareManualCatalogComparison(basket,{magnitStoreId=null,pinnedMagnitStoreId=null,unresolvedGroupKeys=[]}={}) {
 if(!Array.isArray(basket)||!basket.length)return null;
 if(!Array.isArray(unresolvedGroupKeys)||unresolvedGroupKeys.length>16
   ||new Set(unresolvedGroupKeys).size!==unresolvedGroupKeys.length
   ||unresolvedGroupKeys.some(key=>!guidedGroupByKey(key)))return {kind:'needs_review',reason:'invalid_pending_context',issues:basket};
 const stores=new Set(),references=[],issues=[];
 let relevant=Boolean(pinnedMagnitStoreId);
 for(const item of basket) {
   const scoped=/^retail:(magnit|perekrestok):([^:]+):([A-Za-z0-9_-]+)$/u.exec(item?.id??'');
   let retailerId,sourceProductId,title;
   if(scoped) {
     retailerId=scoped[1];sourceProductId=scoped[3];
     const identity=(retailerId==='magnit'?WEEKLY_MAGNIT_IDENTITIES:WEEKLY_PEREKRESTOK_IDENTITIES)
       .find(row=>row.sourceProductId===sourceProductId);
     // Unknown older source cards keep their independent manual/need flow.
     // Once a reviewed anchor or saved pair opts in, every unmatched line
     // still blocks this comparison rather than silently disappearing.
     relevant ||= Boolean(identity);
     if(!identity||key(identity.name)!==key(item.name)
       ||retailerId==='perekrestok'&&scoped[2]!==PEREK.storeId){issues.push(item);continue;}
     if(retailerId==='magnit')stores.add(scoped[2]);
     title=identity.name;
   } else {
     const delivery=PEREKRESTOK_REVIEWED_LIST_PACKS.find(row=>row.identity.id===item?.id);
     if(delivery&&matchesReviewedRetailBasketIdentity(item)) {
       relevant=true;retailerId='perekrestok';sourceProductId=delivery.sourceProductId;title=delivery.sourceName;
     } else {
       const ids=getReviewedRetailSourceProductIds('magnit',[item]);
       if(ids.length===1){retailerId='magnit';sourceProductId=ids[0];title=item.name;}
       else {issues.push(item);continue;}
     }
   }
   const groups=guidedGroupsForCard({name:title});
   if(groups.length!==1||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>99){issues.push(item);continue;}
   references.push({productId:item.id,sourceProductId,retailerId,groupKey:groups[0].key,
     allowPoultryCuts:groups[0].key==='chicken'&&groups[0].allowPoultryCuts===true});
 }
 if(!relevant)return null;
 if(pinnedMagnitStoreId&&stores.size&&[...stores].some(id=>id!==pinnedMagnitStoreId))return {kind:'needs_review',reason:'different_magnit_addresses',issues:basket};
 if(stores.size>1)return {kind:'needs_review',reason:'different_magnit_addresses',issues:basket};
 // Keep the chosen address visible even when an unmatched line prevents
 // comparison. This context does not admit that line or establish a winner.
 const chosen=stores.size?[...stores][0]:pinnedMagnitStoreId??magnitStoreId;
 const code=/^magnit-(\d{4,12})$/u.exec(chosen??'')?.[1];
 const store=code&&resolveRegisteredMagnitStore({shopCode:code});
 const names=store?['Магнит · '+store.address,PEREK.storeName]:null;
 if(issues.length)return {kind:'needs_review',reason:'unmatched_items',issues,...(names?{names}:{})};
 if(!references.length)return {kind:'needs_review',reason:'empty',issues:basket};
 if(!store)return {kind:'choose_magnit'};
 const request=normalizeGuidedComparisonRequest({version:2,
   scopes:[{retailerId:'magnit',storeId:'magnit-'+code},{retailerId:'perekrestok',storeId:PEREK.storeId}],
   bindings:references,unresolvedGroupKeys:unresolvedGroupKeys.filter(key=>!references.some(binding=>binding.groupKey===key))});
 if(!request)return {kind:'needs_review',reason:'request_limit',issues:basket};
 return {kind:'ready',request,names,pending:request.unresolvedGroupKeys.length};
}
