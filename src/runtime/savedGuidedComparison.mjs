import {sourceScopedRetailListSelection} from '../catalog/sourceScopedRetailList.mjs';
import { guidedComparisonForBasket } from '../state/guidedBasketComparison.mjs';
import { guidedGroupByKey, guidedGroupAllowed, guidedGroupMatches } from '../intelligence/guidedShoppingPlan.mjs';
import { isShoppingProductRejected } from '../intelligence/shoppingConversation.mjs';
import { retailSelectionUrl } from '../intelligence/retailProductSelection.mjs';
import { resolveRegisteredMagnitStore } from '../data/registeredMagnitStores.mjs';
import { createRetailCatalogClient } from '../ports/retailCatalogPort.mjs';
import { createWeeklyRetailCatalogPort, PEREKRESTOK_WEEKLY_SCOPE } from '../ports/weeklyRetailCatalogPort.mjs';
import { getReviewedRetailBasketProduct } from '../catalog/reviewedRetailBasket.mjs';
import { reviewedCrossSourceCounterpart } from '../catalog/reviewedCrossSourcePairs.mjs';
import { catalogPurchaseUnit, catalogRequestForQuantity, economicalCatalogCards,
  suggestedCatalogQuantity, suggestedCatalogQuantityForIntent, quoteCatalogDraft,
  compareCatalogDraftAlternatives } from '../core/catalogDraft.mjs';

export function savedComparisonScopes(request) {
  if(request.version===3)return null; // A retained single-store draft is not a confirmed pair.
  const reference=request.scopes.find(scope=>scope.retailerId==='magnit');
  const code=/^magnit-(\d{4,12})$/u.exec(reference?.storeId??'')?.[1];
  const store=code&&resolveRegisteredMagnitStore({shopCode:code});
  if(!store)return null;
  return [{...createRetailCatalogClient({retailerId:'magnit',store}).definition,store,priceScope:'address-public-price'},
    PEREKRESTOK_WEEKLY_SCOPE];
}
function product(card) {
  return getReviewedRetailBasketProduct(card)??{id:card.id,name:card.name,
    unit:catalogPurchaseUnit(card)?.approximate?catalogPurchaseUnit(card).label:card.unit};
}
function admitted(card,scope,group,memory,now) {
  if(!card||typeof card.sourceProductId!=='string'||card.retailerId!==scope.retailerId
    ||card.id!=='retail:'+scope.retailerId+':'+scope.storeId+':'+card.sourceProductId
    ||typeof card.name!=='string'||card.name.length>300||!card.name.trim()
    ||!Number.isSafeInteger(card.priceMinor)||card.priceMinor<=0||card.currency!=='RUB'
    ||card.availability!=='unknown'||!Number.isFinite(Date.parse(card.observedAt))||Date.parse(card.observedAt)>now
    ||!retailSelectionUrl(card.sourceUrl,card.retailerId)||!retailSelectionUrl(card.productUrl,card.retailerId,'productUrlRules')
    ||!guidedGroupMatches(group,card)||isShoppingProductRejected(card,memory))return false;
  if(scope.retailerId==='perekrestok')return card.sourceUrl===scope.sourceUrl&&card.productUrl===scope.sourceUrl;
  try{
    return [card.sourceUrl,card.productUrl].every(raw=>{
      const url=new URL(raw);
      return ['magnit.ru','www.magnit.ru'].includes(url.host)
        &&(url.pathname==='/product/'+card.sourceProductId||url.pathname.startsWith('/product/'+card.sourceProductId+'-'))
        &&!url.hash&&[...url.searchParams.keys()].every(key=>['shopCode','shopType'].includes(key))
        &&url.searchParams.getAll('shopCode').length===1
        &&url.searchParams.get('shopCode')===scope.store.shopCode
        &&url.searchParams.getAll('shopType').length===1
        &&url.searchParams.get('shopType')===String(scope.store.shopType??'1');
    });
  }catch{return false;}
}
const EMPTY_MEMORY={facts:{},rejected:[],wishes:[],exceptions:[]};
function requestGroup(binding) {
 const group=guidedGroupByKey(binding.groupKey);
 return binding.allowPoultryCuts?{...group,label:'Курица',query:'цыпл',allowPoultryCuts:true}:group;
}


// Only request references are persisted. Every comparison reads source cards
// again; a stored timestamp, price or prior result is never admitted here.
export async function loadSavedGuidedComparison(request,basket,{
  catalog=createWeeklyRetailCatalogPort(),memory=EMPTY_MEMORY,now=Date.now,timeoutMs=15000
}={}) {
  const state=guidedComparisonForBasket(request,basket);
  if(state.kind!=='ready')return {...state,basketPreserved:true};
  const scopes=savedComparisonScopes(state.request);
  if(!scopes)return {kind:'unavailable',basketPreserved:true};
  const started=Date.now(),deadline=started+Math.min(15000,Math.max(1,timeoutMs)),data=new Map();
  const bindingKey=binding=>binding.groupKey+':'+String(binding.allowPoultryCuts);
  const uniqueBindings=[...new Map(state.bindings.map(binding=>[bindingKey(binding),binding])).values()];
  const tasks=scopes.flatMap(scope=>uniqueBindings.map(binding=>({scope,binding})));
  const anchorCards=new Map();
  const failedSources = new Set();
  if(typeof catalog.bySourceProductIds==='function') {
    const batches=scopes.flatMap(scope=>{
      const ids=[...new Set(state.bindings.flatMap(binding=>{
        if(binding.retailerId===scope.retailerId)return [binding.sourceProductId];
        const counterpart=reviewedCrossSourceCounterpart(binding,scope.retailerId);
        return counterpart?[counterpart]:[];
      }))];
      return Array.from({length:Math.ceil(ids.length/40)},(_,index)=>({scope,ids:ids.slice(index*40,index*40+40)}));
    });
    let nextBatch=0;
    await Promise.all([0,1].map(async()=>{
      while(nextBatch<batches.length){
        const {scope,ids}=batches[nextBatch++];if(Date.now()>=deadline)continue;
        let response,timer;
        try{response=await Promise.race([
          Promise.resolve().then(()=>catalog.bySourceProductIds(ids,{scope})),
          new Promise(resolve=>{timer=setTimeout(()=>resolve(null),Math.min(3500,Math.max(1,deadline-Date.now())));})
        ]);}catch{/* A successful group read can still supply the anchor. */}finally{clearTimeout(timer);}
        if(response?.kind!=='catalog') failedSources.add(scope.retailerId);
        if(response?.kind==='catalog'&&Array.isArray(response.products))
          anchorCards.set(scope.retailerId,[...(anchorCards.get(scope.retailerId)??[]),...response.products.filter(card=>ids.includes(card?.sourceProductId))].slice(0,64));
      }
    }));
  }
  let next=0;
  const worker=async()=>{
    while(next<tasks.length){
      const {scope,binding}=tasks[next++],group=requestGroup(binding);
      const key=scope.retailerId+':'+bindingKey(binding);
      if(Date.now()>=deadline){failedSources.add(scope.retailerId);data.set(key,[]);continue;}
      if(!guidedGroupAllowed(group,memory)){data.set(key,[]);continue;}
      let response,timer;
      try{response=await Promise.race([
        Promise.resolve().then(()=>catalog.search(group.query,{scope,limit:40})),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(null),Math.min(3500,Math.max(1,deadline-Date.now())));})
      ]);}catch{/* Other source results remain available. */}finally{clearTimeout(timer);}
      if(response?.kind!=='catalog') failedSources.add(scope.retailerId);
      const seen=new Set();
      data.set(key,(response?.kind==='catalog'&&Array.isArray(response.products)?response.products:[])
        .filter(card=>{
          if(!admitted(card,scope,group,memory,now())||seen.has(card.id))return false;
          seen.add(card.id);return true;
        }).slice(0,40));
    }
  };
  await Promise.all([worker(),worker()]);
  const drafts=scopes.map(scope=>({scope,rows:[]}));
  for(const binding of state.bindings){
    const item=basket.find(row=>row.id===binding.productId),baseGroup=requestGroup(binding);
    const anchorScope=scopes.find(scope=>scope.retailerId===binding.retailerId);
    const anchor=[...(anchorCards.get(binding.retailerId)??[]),...(data.get(binding.retailerId+':'+bindingKey(binding))??[])].find(card=>{
      if(!admitted(card,anchorScope,baseGroup,memory,now()))return false;
      const identity=item.id===card.id
        ?sourceScopedRetailListSelection(card)?.product??product(card):product(card);
      return card.sourceProductId===binding.sourceProductId&&identity.id===item.id
        &&identity.name===item.name&&identity.unit===item.unit;
    });
    const target=anchor&&catalogRequestForQuantity(anchor,item.quantity);
    const group={...baseGroup,...(target?{dailyAmount:target.amount,dimension:target.dimension}:{})};
    for(const draft of drafts){
      const sourceCards=data.get(draft.scope.retailerId+':'+bindingKey(binding))??[];
      let card=null,quantity=1,quantityReview=!target,intent=null;
      if(target){
        if(draft.scope.retailerId===binding.retailerId){card=anchor;quantity=item.quantity;}
        else{
          const exactCards=target.approximate?sourceCards:sourceCards.filter(row=>!catalogPurchaseUnit(row)?.approximate);
          const counterpartId=reviewedCrossSourceCounterpart(binding,draft.scope.retailerId);
          const counterpart=(anchorCards.get(draft.scope.retailerId)??[]).find(row=>
            row.sourceProductId===counterpartId&&admitted(row,draft.scope,baseGroup,memory,now()));
          const anchorUnit=catalogRequestForQuantity(anchor,1),counterpartUnit=catalogRequestForQuantity(counterpart,1);
          const exactCounterpart=counterpart&&anchorUnit&&!anchorUnit.approximate&&counterpartUnit&&!counterpartUnit.approximate
            &&anchorUnit.dimension===counterpartUnit.dimension&&anchorUnit.amount===counterpartUnit.amount?counterpart:null;
          card=exactCounterpart??economicalCatalogCards(group,exactCards,1,1,{nowMs:now()})[0]
            ??economicalCatalogCards(group,sourceCards,1,1,{nowMs:now()})[0]??null;
          if(card)quantity=suggestedCatalogQuantity(group,card,1,1);
        }
        if(!target.approximate){
          intent={amount:target.amount,dimension:target.dimension};
          const converted=card?suggestedCatalogQuantityForIntent(card,intent):null;
          quantityReview=!converted||converted.quantityReview;
          if(converted?.quantity!=null)quantity=converted.quantity;
        }
      }
      draft.rows.push({group,card,quantity,quantityReview,...(intent?{quantityIntent:intent}:{}),product:card?product(card):null});
    }
  }
  const unavailableRetailers = drafts.filter(draft => failedSources.has(draft.scope.retailerId)
    && draft.rows.some(row => !row.card)).map(draft => draft.scope.retailerId);
  return {kind:'catalog_comparison',request:state.request,drafts,unavailableRetailers,
    comparison:compareCatalogDraftAlternatives(drafts,{nowMs:now()}),
    quotes:drafts.map(draft=>quoteCatalogDraft(draft.rows,{nowMs:now()})),
    basketSignature:JSON.stringify(basket),basketPreserved:true,loadedAt:now()};
}
