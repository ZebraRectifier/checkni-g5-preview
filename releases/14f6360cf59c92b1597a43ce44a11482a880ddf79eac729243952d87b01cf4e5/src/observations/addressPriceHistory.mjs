// Histories are isolated by retailer, source, delivery address, SKU and condition.
export function observationTime(snapshot) {
  const date = snapshot?.observedDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return null;
  if (snapshot.observedAt !== undefined) {
    const precise = Date.parse(snapshot.observedAt);
    if (!Number.isFinite(precise) || snapshot.observedAt.slice(0, 10) !== date) return null;
    return precise;
  }
  return ms;
}

export function validDeliverySnapshot(snapshot) {
  if (snapshot?.retailerId !== 'okey' || snapshot.salesChannel !== 'yandex-eda-delivery' ||
      snapshot.priceScope !== 'selected-delivery-address-not-proven-physical-store' ||
      snapshot.physicalStoreId !== null || snapshot.physicalStoreAddress !== null ||
      typeof snapshot.selectedDeliveryAddress !== 'string' || !snapshot.selectedDeliveryAddress.trim() ||
      observationTime(snapshot) === null || !Array.isArray(snapshot.products) ||
      snapshot.products.length > 20000 || snapshot.products.length === 0) return false;
  const ids = new Set();
  return snapshot.products.every(p => {
    if (typeof p.sourceProductId !== 'string' || !p.sourceProductId || ids.has(p.sourceProductId) ||
        typeof p.name !== 'string' || !p.name.trim() || !Number.isSafeInteger(p.displayedPriceKopeks) ||
        p.displayedPriceKopeks <= 0 || p.priceWithCardKopeks !== null ||
        p.priceWithoutCardKopeks !== null || p.availability !== 'unknown') return false;
    let url;
    try { url = new URL(p.productUrl); } catch { return false; }
    if (url.protocol !== 'https:' || url.hostname !== 'eda.yandex.ru' ||
        !url.pathname.startsWith('/retail/okej_retail/product/') ||
        url.pathname.split('/').at(-1) !== p.sourceProductId) return false;
    if(p.sourceObservedAt!==undefined){
      const measured=Date.parse(p.sourceObservedAt);
      if(!Number.isFinite(measured)||!snapshot.observedAt||measured>observationTime(snapshot)||
        observationTime(snapshot)-measured>86400000)return false;
    }
    ids.add(p.sourceProductId);
    return true;
  });
}

export function historySnapshots(bundle) {
  if (bundle?.version !== 1 || !Array.isArray(bundle.snapshots) || bundle.snapshots.length > 1000) return [];
  return bundle.snapshots.filter(validDeliverySnapshot).sort((a,b) => observationTime(a)-observationTime(b));
}

export function latestForAddress(bundle, address, nowMs = Date.now()) {
  return historySnapshots(bundle).filter(s => s.selectedDeliveryAddress === address &&
    observationTime(s) <= nowMs).at(-1) ?? null;
}

export function priceSeries(bundle, address, sourceProductId, {days = 30, nowMs = Date.now()} = {}) {
  if (![7,30,90,365,null].includes(days) || !Number.isFinite(nowMs)) return [];
  const cutoff = days === null ? -Infinity : nowMs - days * 86400000;
  const points = new Map();
  for (const s of historySnapshots(bundle)) {
    if (s.selectedDeliveryAddress !== address) continue;
    const p = s.products.find(p => p.sourceProductId === sourceProductId);
    if (!p) continue;
    const ms = p.sourceObservedAt ? Date.parse(p.sourceObservedAt) : observationTime(s);
    if(ms < cutoff || ms > nowMs)continue;
    const key = p.sourceObservedAt ?? s.observedAt ?? s.observedDate;
    const old = points.get(key);
    // Equal-time contradictions are omitted; a crossed-out price is never a historical point.
    if (old && old.priceMinor !== p.displayedPriceKopeks) { points.set(key, {...old, conflict:true}); continue; }
    if (!old) points.set(key, {ms, date:key.slice(0,10), observedAt:p.sourceObservedAt ?? s.observedAt ?? null,
      priceMinor:p.displayedPriceKopeks, sourceUrl:p.productUrl});
  }
  return [...points.values()].filter(p=>!p.conflict).sort((a,b)=>a.ms-b.ms);
}

export function mergeDeliverySnapshot(bundle, snapshot) {
  if (!validDeliverySnapshot(snapshot)) throw new Error('Invalid address-bound delivery snapshot');
  const current = historySnapshots(bundle);
  const stamp = snapshot.observedAt ?? snapshot.observedDate;
  const existing = current.find(s => s.selectedDeliveryAddress === snapshot.selectedDeliveryAddress &&
    (s.observedAt ?? s.observedDate) === stamp);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(snapshot)) throw new Error('Conflicting observation time');
    return bundle;
  }
  const merged={version:1,refresh:{status:'collected',lastAttemptDate:snapshot.observedDate},
    snapshots:[...current,snapshot].sort((a,b)=>observationTime(a)-observationTime(b)).slice(-90)};
  // Bound a public mobile artifact; keep the newest evidence if history grows too large.
  while(new TextEncoder().encode(JSON.stringify(merged)).byteLength>8*1024*1024){
    if(merged.snapshots.length===1)throw new Error('Snapshot exceeds mobile artifact limit');
    merged.snapshots.shift();
  }
  return merged;
}
