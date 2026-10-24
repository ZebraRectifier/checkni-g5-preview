import {WEEKLY_ROUTE_PRODUCTS} from './weeklyRouteProducts.mjs';

// The shopping recipe is independent from the collector's fourteen identities.
// These ten packs were observed at both addresses in source run 40037356848.
// Keep the original catalogue identities, including omitted packs, unchanged.
const omitted=new Set(['globus-weekly-chicken-495119','globus-weekly-potatoes-322766']);
const quantities={
 'globus-rice-uvelka-round-800g':3,
 'globus-weekly-pasta-259667':7,
 'globus-weekly-mince-396265':10
};
export const WEEKLY_BASKET_RECIPE=Object.freeze(WEEKLY_ROUTE_PRODUCTS
 .filter(product=>!omitted.has(product.id))
 .map(product=>Object.freeze({...product,quantity:quantities[product.id]??product.quantity})));
