import { WEEKLY_ROUTE_PRODUCTS } from '../catalog/weeklyRouteProducts.mjs';
import { quoteCatalogDraft } from './catalogDraft.mjs';

// Price arithmetic stays in Core. Missing/expired observations cannot become a
// complete weekly basket; the UI only presents these results.
export function quoteWeeklyRoute(cards,quantities={},nowMs=Date.now()){
 const index=new Map();
 for(const card of Array.isArray(cards)?cards:[]){
  if(index.has(card.sourceProductId))index.set(card.sourceProductId,null);
  else index.set(card.sourceProductId,card);
 }
 const rows=WEEKLY_ROUTE_PRODUCTS.map(p=>{
  const card=index.get(p.sourceProductId);
  const valid=card?.basketProductId===p.id&&card.name===p.sourceName&&card.unit===p.unit
    &&card.retailerId==='globus'&&card.priceCondition==='regular'&&card.catalogPurchaseBasis==='piece';
  const q=quantities[p.id]??p.quantity;
  return {product:{id:p.id,name:p.name,unit:p.unit},card:valid?card:null,
   quantity:Number.isInteger(q)&&q>=1&&q<=99?q:0};
 });
 const quote=quoteCatalogDraft(rows,{nowMs,maxAgeMs:3600000});
 return {...quote,ready:quote.complete&&quote.allRecent&&quote.basket.length===WEEKLY_ROUTE_PRODUCTS.length,
  missingProductIds:quote.lines.flatMap((line,i)=>!line.addable||line.freshness!=='recent'?[WEEKLY_ROUTE_PRODUCTS[i].id]:[])};
}
