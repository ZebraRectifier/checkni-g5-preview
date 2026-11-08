import {WEEKLY_ROUTE_PRODUCTS} from './weeklyRouteProducts.mjs';

// The shopping recipe is independent from the collector's fifteen identities.
// The ten-product preset is ready only when each currently selected physical
// address has a recent exact-pack observation. Keep previous identities in
// the collector; the old bread is no longer part of this visible preset.
const omitted=new Set(['globus-weekly-chicken-495119','globus-weekly-potatoes-322766','globus-weekly-bread-257140']);
const quantities={
 'globus-rice-uvelka-round-800g':3,
 'globus-weekly-pasta-259667':7,
 'globus-weekly-mince-396265':10
};
export const WEEKLY_BASKET_RECIPE=Object.freeze(WEEKLY_ROUTE_PRODUCTS
 .filter(product=>!omitted.has(product.id))
 .map(product=>Object.freeze({...product,quantity:quantities[product.id]??product.quantity})));
