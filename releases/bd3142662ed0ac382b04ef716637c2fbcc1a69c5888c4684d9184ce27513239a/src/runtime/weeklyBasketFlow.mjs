import {createBasketStore} from '../state/basketStore.mjs';

// Stage through the established basket validator before the real compare-and-
// swap. A quantity or metadata conflict must not add only part of the week.
export function applyWeeklyBasket({basket,rows,replace=false,expected}={}){
 if(replace)return basket.replaceReviewedBasket(expected,rows).applied===true;
 const base=basket.getSnapshot(),draft=createBasketStore({storage:null,eventTarget:null});
 if(!draft.replaceReviewedBasket([],base).applied)return false;
 const merge=draft.mergeValidatedBasket(rows.map(({quantity,...product})=>({product,quantity})));
 if(merge.rejectedRows.length)return false;
 return basket.replaceReviewedBasket(base,draft.getSnapshot()).applied===true;
}
