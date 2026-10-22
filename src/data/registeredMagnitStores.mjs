import{MAGNIT_MOSCOW_STORES,resolveMagnitMoscowStore as cityStore}from'./magnitMoscowStores.mjs';
import{MAGNIT_MOSCOW_OBLAST_BINDINGS,resolveMagnitMoscowOblastStore}from'./magnitMoscowOblastBindings.mjs';
import { getMagnitLegacySearchAliases } from './magnitLegacyAddressAliases.mjs';
export const REGISTERED_MAGNIT_STORES=Object.freeze([...MAGNIT_MOSCOW_STORES,...MAGNIT_MOSCOW_OBLAST_BINDINGS]
  .map(store => {
    const searchAliases = getMagnitLegacySearchAliases(store);
    return searchAliases.length ? Object.freeze({ ...store, searchAliases }) : store;
  }));
export function resolveRegisteredMagnitStore(options){return cityStore(options)??resolveMagnitMoscowOblastStore(options);}

const normalized = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е');
export function filterRegisteredMagnitStores(query = '') {
  const terms = normalized(query).trim().split(/\s+/u).filter(Boolean);
  return REGISTERED_MAGNIT_STORES.filter(store => [store.address, ...(store.searchAliases ?? [])]
    .some(address => terms.every(term => normalized(address).includes(term))));
}
