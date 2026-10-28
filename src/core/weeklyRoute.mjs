import { WEEKLY_BASKET_RECIPE } from '../catalog/weeklyBasketRecipe.mjs';
import { quoteCatalogDraft } from './catalogDraft.mjs';

// Price arithmetic stays in Core. Missing/expired observations cannot become a
// complete weekly basket; the UI only presents these results.
export function quoteWeeklyRoute(cards,quantities={},nowMs=Date.now(),selectedProductIds=WEEKLY_BASKET_RECIPE.map(p=>p.id)){
 const knownIds=new Set(WEEKLY_BASKET_RECIPE.map(p=>p.id));
 const selectionValid=Array.isArray(selectedProductIds)&&selectedProductIds.length<=knownIds.size
  &&new Set(selectedProductIds).size===selectedProductIds.length&&Array.from(selectedProductIds).every(id=>knownIds.has(id));
 const selected=selectionValid?new Set(selectedProductIds):new Set();
 const products=WEEKLY_BASKET_RECIPE.filter(p=>selected.has(p.id));
 const index=new Map();
 for(const card of Array.isArray(cards)?cards:[]){
  if(index.has(card.sourceProductId))index.set(card.sourceProductId,null);
  else index.set(card.sourceProductId,card);
 }
 const rows=products.map(p=>{
  const card=index.get(p.sourceProductId);
  const valid=card?.basketProductId===p.id&&card.name===p.sourceName&&card.unit===p.unit
    &&card.retailerId==='globus'&&card.priceCondition==='regular'&&card.catalogPurchaseBasis==='piece';
  const q=quantities[p.id]??p.quantity;
  return {product:{id:p.id,name:p.name,unit:p.unit},card:valid?card:null,
   quantity:Number.isInteger(q)&&q>=1&&q<=99?q:0};
 });
 const quote=quoteCatalogDraft(rows,{nowMs,maxAgeMs:3600000});
 return {...quote,selectionValid,selectedCount:products.length,selectedProductIds:products.map(p=>p.id),
  ready:selectionValid&&quote.complete&&quote.allRecent&&quote.basket.length===products.length,
  missingProductIds:quote.lines.flatMap(line=>!line.addable||line.freshness!=='recent'?[line.product.id]:[])};
}
