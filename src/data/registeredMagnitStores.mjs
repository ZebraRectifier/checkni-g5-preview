import{MAGNIT_MOSCOW_STORES,resolveMagnitMoscowStore as cityStore}from'./magnitMoscowStores.mjs';
import{MAGNIT_MOSCOW_OBLAST_BINDINGS,resolveMagnitMoscowOblastStore}from'./magnitMoscowOblastBindings.mjs';
export const REGISTERED_MAGNIT_STORES=Object.freeze([...MAGNIT_MOSCOW_STORES,...MAGNIT_MOSCOW_OBLAST_BINDINGS]);
export function resolveRegisteredMagnitStore(options){return cityStore(options)??resolveMagnitMoscowOblastStore(options);}
