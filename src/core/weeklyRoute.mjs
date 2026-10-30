import { WEEKLY_BASKET_RECIPE } from '../catalog/weeklyBasketRecipe.mjs';
import { quoteCatalogDraft } from './catalogDraft.mjs';

// An explicit alternative meal, not an identity match or nutritional equivalence.
// Preserve the user's rice amount and replace only the selected oats dry mass.
export function proposeWeeklyRiceBreakfast(quantities={},selectedProductIds=[]){
 const oats=WEEKLY_BASKET_RECIPE.find(p=>p.id==='globus-weekly-oats-31053');
 const rice=WEEKLY_BASKET_RECIPE.find(p=>p.id==='globus-rice-uvelka-round-800g');
 const known=new Set(WEEKLY_BASKET_RECIPE.map(p=>p.id));
 if(!quantities||typeof quantities!=='object'||Array.isArray(quantities)
  ||!Array.isArray(selectedProductIds)||selectedProductIds.length>known.size||new Set(selectedProductIds).size!==selectedProductIds.length
  ||Array.from(selectedProductIds).some(id=>!known.has(id))||!selectedProductIds.includes(oats.id))return null;
 const oatsQuantity=quantities[oats.id]??oats.quantity;
 const riceQuantity=selectedProductIds.includes(rice.id)?quantities[rice.id]??rice.quantity:0;
 if(!Number.isInteger(oatsQuantity)||oatsQuantity<1||oatsQuantity>99
  ||!Number.isInteger(riceQuantity)||riceQuantity<(selectedProductIds.includes(rice.id)?1:0)||riceQuantity>99)return null;
 const addedPacks=Math.ceil(oatsQuantity*500/800),totalPacks=riceQuantity+addedPacks;
 if(totalPacks>99)return null;
 const selected=new Set(selectedProductIds);selected.delete(oats.id);selected.add(rice.id);
 return {oatsId:oats.id,riceId:rice.id,addedPacks,totalPacks,
  selectedProductIds:WEEKLY_BASKET_RECIPE.filter(p=>selected.has(p.id)).map(p=>p.id),
  quantities:{...quantities,[rice.id]:totalPacks}};
}

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
