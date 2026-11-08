const STORAGE_KEY = 'checkni.basket.presentation.v1';
const MAX_RECORDS = 100;
const memory = new Map();
function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}
function valid(record) {
  return record && typeof record.id === 'string' && typeof record.name === 'string'
    && typeof record.unit === 'string' && typeof record.retailerId === 'string'
    && typeof record.storeId === 'string';
}
function readRecords(storage) {
  try {
    const values = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(values) ? values.filter(valid).slice(-MAX_RECORDS) : [];
  } catch { return []; }
}

/** Display-only evidence from the exact catalogue card the user added. */
export function rememberBasketPresentation(item, card, storage = browserStorage()) {
  const scopedId = typeof card?.id === 'string' ? /^retail:([^:]+):([^:]+):/.exec(card.id) : null;
  const storeId = card?.storeId ?? (scopedId?.[1] === card?.retailerId ? scopedId[2] : null);
  if (!item?.id || !card?.retailerId || !storeId) return false;
  const record = {
    id: item.id, name: item.name, unit: item.unit,
    retailerId: card.retailerId, storeId,
    storeName: card.storeName ?? card.retailerDisplayName ?? card.retailerId,
    imageUrl: httpsUrl(card.imageUrl),
    sourceUrl: httpsUrl(card.sourceUrl ?? card.productUrl),
    priceMinor: Number.isSafeInteger(card.priceMinor) && card.priceMinor > 0 ? card.priceMinor : null,
    catalogUnit: typeof card.unit === 'string' ? card.unit : '',
    observedAt: Number.isFinite(Date.parse(card.observedAt)) ? new Date(card.observedAt).toISOString() : null,
    condition: typeof card.priceConditionLabel === 'string' ? card.priceConditionLabel : '',
    savedAt: new Date().toISOString()
  };
  if (!valid(record)) return false;
  const previous = memory.get(item.id) ?? readRecords(storage).find(entry => entry.id === item.id);
  if (previous && (previous.conflicted || previous.storeId !== record.storeId || previous.retailerId !== record.retailerId)) {
    record.conflicted = true;
    record.priceMinor = null;
    record.imageUrl = null;
    record.sourceUrl = null;
  }
  memory.set(item.id, record);
  const records = readRecords(storage).filter(entry => entry.id !== item.id);
  records.push(record);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS))); } catch {}
  return true;
}

export function basketPresentation(item, storage = browserStorage()) {
  const record = memory.get(item.id) ?? readRecords(storage).find(entry => entry.id === item.id);
  if (!record || record.name !== item.name || record.unit !== item.unit) return null;
  return {
    ...record,
    imageUrl: httpsUrl(record.imageUrl),
    sourceUrl: httpsUrl(record.sourceUrl),
    priceMinor: Number.isSafeInteger(record.priceMinor) && record.priceMinor > 0 ? record.priceMinor : null,
    observedAt: Number.isFinite(Date.parse(record.observedAt)) ? record.observedAt : null
  };
}

export function retainBasketPresentations(items, storage = browserStorage()) {
  const ids = new Set(items.map(item => item.id));
  for (const id of memory.keys()) if (!ids.has(id)) memory.delete(id);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(readRecords(storage).filter(record => ids.has(record.id)))); } catch {}
}
