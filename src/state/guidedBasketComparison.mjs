import { guidedGroupByKey } from '../intelligence/guidedShoppingPlan.mjs';
import { resolveRegisteredMagnitStore } from '../data/registeredMagnitStores.mjs';
import { PEREKRESTOK_WEEKLY_SCOPE } from '../ports/weeklyRetailCatalogPort.mjs';

export const GUIDED_BASKET_COMPARISON_KEY = 'checkni.guided-comparison-request.v1';
const MAX_BYTES = 20000;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => plain(value) && Object.keys(value).length === allowed.length
  && Object.keys(value).every(key => allowed.includes(key));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value;

// This is a user's comparison request, never a cached quote. Unknown fields
// (including prices, dates, stock, free-form source URLs) fail closed.
export function normalizeGuidedComparisonRequest(value) {
  if (!keys(value,['version','scopes','bindings','unresolvedGroupKeys']) || ![1,2].includes(value.version)
    || !Array.isArray(value.scopes) || value.scopes.length !== 2
    || !Array.isArray(value.bindings) || !value.bindings.length || value.bindings.length > (value.version===2?64:16)
    || !Array.isArray(value.unresolvedGroupKeys) || value.unresolvedGroupKeys.length > 16) return null;
  const scopes = [];
  for (const scope of value.scopes) {
    if (!keys(scope,['retailerId','storeId']) || !id(scope.storeId)) return null;
    if (scope.retailerId === 'magnit') {
      const code = /^magnit-(\d{4,12})$/u.exec(scope.storeId)?.[1];
      if (!code || !resolveRegisteredMagnitStore({shopCode:code})) return null;
    } else if (scope.retailerId !== 'perekrestok' || scope.storeId !== PEREKRESTOK_WEEKLY_SCOPE.storeId) return null;
    if (scopes.some(row => row.retailerId === scope.retailerId)) return null;
    scopes.push({retailerId:scope.retailerId,storeId:scope.storeId});
  }
  const bindings = [], products = new Set(), groups = new Set();
  for (const binding of value.bindings) {
    if (!keys(binding,['productId','sourceProductId','groupKey','retailerId','allowPoultryCuts'])
      || !id(binding.productId) || !id(binding.sourceProductId)
      || !/^[a-zA-Z0-9_-]+$/u.test(binding.sourceProductId)
      || !guidedGroupByKey(binding.groupKey)
      || typeof binding.allowPoultryCuts!=='boolean' || binding.allowPoultryCuts && binding.groupKey!=='chicken'
      || !scopes.some(scope=>scope.retailerId === binding.retailerId)
      || products.has(binding.productId) || value.version===1 && groups.has(binding.groupKey)) return null;
    products.add(binding.productId); groups.add(binding.groupKey);
    bindings.push({...binding});
  }
  const unresolvedGroupKeys=[...new Set(value.unresolvedGroupKeys)];
  if(unresolvedGroupKeys.length!==value.unresolvedGroupKeys.length
    ||unresolvedGroupKeys.some(key=>!guidedGroupByKey(key)||groups.has(key)))return null;
  const normalized={version:value.version,scopes,bindings,unresolvedGroupKeys};
  return JSON.stringify(normalized).length<=MAX_BYTES?normalized:null;
}

export function guidedComparisonForBasket(request, basket) {
  request = normalizeGuidedComparisonRequest(request);
  if (!request || !Array.isArray(basket) || !basket.length) return {kind:'none'};
  const products = new Set();
  for (const row of basket) {
    if (!id(row?.id) || products.has(row.id) || !Number.isSafeInteger(row.quantity)
      || row.quantity < 1 || row.quantity > 99) return {kind:'invalid'};
    products.add(row.id);
  }
  const matched = basket.flatMap(row => {
    const binding = request.bindings.find(binding=>binding.productId === row.id);
    return binding ? [{...binding,quantity:row.quantity}] : [];
  });
  const missingProductIds = basket.filter(row=>!matched.some(binding=>binding.productId === row.id)).map(row=>row.id);
  return {kind:missingProductIds.length?'needs_review':'ready',request,bindings:matched,missingProductIds};
}

export function createGuidedComparisonRequest({rows,drafts}) {
  if (!Array.isArray(rows) || !Array.isArray(drafts)) return null;
  return normalizeGuidedComparisonRequest({version:1,
    scopes:drafts.map(draft=>({retailerId:draft.scope?.retailerId,storeId:draft.scope?.storeId})),
    unresolvedGroupKeys:rows.filter(row=>row.addable!==true).map(row=>row.group?.key),
    bindings:rows.filter(row=>row.addable===true && row.card && row.product).map(row=>({
      productId:row.product.id,sourceProductId:row.card.sourceProductId,
      groupKey:row.group?.key,retailerId:row.card.retailerId,allowPoultryCuts:row.group?.key==='chicken'&&row.group.allowPoultryCuts===true
    }))});
}

function defaultStorage() { try { return globalThis.localStorage; } catch { return null; } }
export function createGuidedComparisonStore({storage=defaultStorage()}={}) {
  let memory = null, saved = true;
  function read() {
    if (!saved) return memory ? normalizeGuidedComparisonRequest(memory) : null;
    let raw;
    try { raw = storage?.getItem(GUIDED_BASKET_COMPARISON_KEY); }
    catch { return memory ? normalizeGuidedComparisonRequest(memory) : null; }
    if (storage) {
      try { memory = raw != null && raw.length <= MAX_BYTES ? normalizeGuidedComparisonRequest(JSON.parse(raw)) : null; }
      catch { memory = null; }
    }
    return memory ? normalizeGuidedComparisonRequest(memory) : null;
  }
  function write(request) {
    const next = normalizeGuidedComparisonRequest(request);
    if (!next) return {ok:false,saved:false};
    memory = next;
    try {
      if (!storage) throw Error('storage unavailable');
      storage.setItem(GUIDED_BASKET_COMPARISON_KEY,JSON.stringify(next)); saved = true;
    } catch { saved = false; }
    return {ok:true,saved};
  }
  function clear() {
    memory = null;
    try { storage?.removeItem(GUIDED_BASKET_COMPARISON_KEY); saved = true; }
    catch { saved = false; }
    return {saved};
  }
  return {read,write,clear,forBasket:basket=>guidedComparisonForBasket(read(),basket),status:()=>({saved})};
}
