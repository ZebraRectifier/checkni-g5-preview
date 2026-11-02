// A dated catalogue quote is a different contract from a comparable store
// offer. It never supplies stock, cross-store equivalence or a winner.
export function catalogPurchaseUnit(card) {
  const unit = String(card?.unit ?? '').trim();
  const explicit = unit.toLowerCase().replace(',', '.').match(/^(?:цена за\s+)?(\d+(?:\.\d+)?)\s*(кг|г|мл|л|шт\.?|штук)$/u);
  // Only an upstream per-pack basis permits reading the pack size from that
  // exact SKU's displayed title. Variable-weight packages cannot enter here.
  const title = String(card?.name ?? '').toLowerCase().replace(/,\s*/gu, ',');
  let named = card?.catalogPurchaseBasis === 'piece' ? title
    .match(/(?:^|[\s,])(\d+(?:[.,]\d+)?)\s*(кг|г|мл|л|шт)\.?$/u) : null;
  if (named && /[\d.,-]$/u.test(title.slice(0, named.index))) named = null;
  const match = explicit ?? named;
  if (!match || Number(match[1].replace(',', '.')) <= 0) return card?.catalogPurchaseBasis === 'piece'
    ? { label: '1 уп. (масса/объём не уточнены)', amount: 1, dimension: 'package' } : null;
  const dimension = ['кг', 'г'].includes(match[2]) ? 'g' : ['л', 'мл'].includes(match[2]) ? 'ml' : 'piece';
  const amount = Number(match[1].replace(',', '.')) * (['кг', 'л'].includes(match[2]) ? 1000 : 1);
  const label = explicit ? unit : `${match[1]} ${match[2]}`;
  return { label: card?.catalogPurchaseBasis==='weighed-portion'?`≈${label} (весовая порция)`:label, amount, dimension,
    ...(card?.catalogPurchaseBasis==='weighed-portion'?{approximate:true}:{}) };
}

export function suggestedCatalogQuantity(group, card, people, days) {
  const unit = catalogPurchaseUnit(card);
  if (!unit || unit.dimension !== group.dimension) return 1;
  return Math.min(99, Math.max(1, Math.ceil(group.dailyAmount * people * days / unit.amount)));
}

function validQuantityIntent(intent) {
  return Boolean(intent && ['g', 'ml', 'piece'].includes(intent.dimension)
    && Number.isFinite(intent.amount) && intent.amount > 0 && intent.amount <= Number.MAX_SAFE_INTEGER);
}

// Preserve the requested amount, not the number of packages from another store.
// Unknown packs and estimated weights require review rather than an invented conversion.
export function suggestedCatalogQuantityForIntent(card, intent) {
  const unit = catalogPurchaseUnit(card);
  if (!validQuantityIntent(intent) || !unit || unit.approximate
    || unit.dimension !== intent.dimension || !Number.isFinite(unit.amount) || unit.amount <= 0)
    return { quantity: null, quantityReview: true };
  const ratio = intent.amount / unit.amount;
  const nearest = Math.round(ratio);
  // A manual 3 × 100.4 g is represented as 301.20000000000005 in JS.
  // Correct only floating-point noise near a whole pack, never a real shortfall.
  const quantity = nearest >= 1 && Math.abs(ratio - nearest) <= Number.EPSILON * Math.max(1, Math.abs(ratio)) * 4
    ? nearest : Math.ceil(ratio);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 99
    ? { quantity, quantityReview: false } : { quantity: null, quantityReview: true };
}

// Selection and quoting must admit the same observations. In particular, an
// expired promotion must not displace a usable card before the quote rejects it.
function catalogObservation(card, nowMs, maxAgeMs) {
  const observed = Date.parse(card?.observedAt);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  const activePromotion = !card?.validUntil || /^\d{4}-\d{2}-\d{2}$/u.test(card.validUntil) && card.validUntil >= today;
  const valid = Boolean(activePromotion && card && Number.isSafeInteger(card.priceMinor) && card.priceMinor > 0 && card.currency === 'RUB'
    && Number.isFinite(observed) && observed <= nowMs);
  return { valid, freshness: !valid ? 'unknown' : nowMs - observed > maxAgeMs ? 'dated' : 'recent' };
}

// Cost ranking belongs to Core. It is bounded to returned cards, preserves
// source pack units, and makes no cross-store exact-SKU or current-price claim.
export function economicalCatalogCards(group, cards, people, days, { nowMs = Date.now(), maxAgeMs = 3600000 } = {}) {
  return cards.map((card, index) => {
    const unit = catalogPurchaseUnit(card);
    const quantity = suggestedCatalogQuantity(group, card, people, days);
    const observation = catalogObservation(card, nowMs, maxAgeMs);
    const total = card?.priceMinor * quantity;
    const valid = observation.valid && unit?.dimension === group.dimension && unit.amount * quantity >= group.dailyAmount * people * days
      && Number.isSafeInteger(total) && total > 0;
    const recent = observation.freshness === 'recent';
    return { card, index, recent, total: valid ? total : null };
  }).filter(row => row.total !== null).sort((a, b) => Number(b.recent) - Number(a.recent) || a.total - b.total || a.index - b.index).map(row => row.card);
}

export function rankCatalogDrafts(drafts, options) {
  return drafts.map(draft => ({ ...draft, quote: quoteCatalogDraft(draft.rows, options) }))
    .sort((a, b) => Number(b.quote.complete) - Number(a.quote.complete)
      || Number(b.quote.allRecent) - Number(a.quote.allRecent)
      || b.quote.basket.length - a.quote.basket.length
      || (a.quote.knownSubtotalMinor ?? Infinity) - (b.quote.knownSubtotalMinor ?? Infinity));
}

// Different reviewed products for the same grocery needs, not exact-SKU
// offers or a purchase-plan winner. Delivery fees and stock remain unknown.
export function compareCatalogDraftAlternatives(drafts, options) {
  if(!Array.isArray(drafts)||drafts.length!==2)return {kind:'incomplete'};
  const signature=draft=>JSON.stringify(draft.rows.map(r=>[r.group?.key,r.group?.dimension,r.group?.dailyAmount]));
  if(!drafts[0].rows.length||signature(drafts[0])!==signature(drafts[1]))return {kind:'incompatible'};
  if(!drafts.every(d=>typeof d.scope?.storeId==='string')||drafts[0].scope.storeId===drafts[1].scope.storeId)return {kind:'incompatible'};
  for (let i = 0; i < drafts[0].rows.length; i++) {
    const pair = drafts.map(draft => draft.rows[i]);
    if (pair.some(row => row.quantityReview === true)) return { kind: 'incompatible' };
    if (!pair.some(row => row.quantityIntent != null)) continue;
    const intent = pair[0].quantityIntent;
    if (!validQuantityIntent(intent) || pair.some(row => !validQuantityIntent(row.quantityIntent)
      || row.quantityIntent.dimension !== intent.dimension || row.quantityIntent.amount !== intent.amount))
      return { kind: 'incompatible' };
    for (const row of pair) {
      const suggested = suggestedCatalogQuantityForIntent(row.card, intent);
      // Both offers cover the same request with the smallest whole-pack quantity.
      // An unrelated extra package is not a saving or an equivalent basket.
      if (suggested.quantityReview || row.quantity !== suggested.quantity) return { kind: 'incompatible' };
    }
  }
  const quotes=drafts.map(d=>({...d,quote:quoteCatalogDraft(d.rows,options)}));
  if(quotes.some(d=>!d.quote.complete))return {kind:'incomplete'};
  if(quotes.some(d=>!d.quote.allRecent))return {kind:'needs_refresh'};
  quotes.sort((a,b)=>a.quote.knownSubtotalMinor-b.quote.knownSubtotalMinor);
  return {kind:'fresh',lowerStoreName:quotes[0].scope.storeName,
    lowerStoreId:quotes[0].scope.storeId,differenceMinor:quotes[1].quote.knownSubtotalMinor-quotes[0].quote.knownSubtotalMinor,
    estimated:quotes.some(d=>d.quote.hasEstimates),sameProducts:false,includesFees:false,availability:'unknown'};
}

export function quoteCatalogDraft(rows, { nowMs = Date.now(), maxAgeMs = 60 * 60 * 1000 } = {}) {
  const lines = rows.map(row => {
    const card = row.card;
    const quantity = row.quantity;
    const unit = catalogPurchaseUnit(card);
    const observation = catalogObservation(card, nowMs, maxAgeMs);
    const observedPrice = observation.valid;
    const valid = observedPrice && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 99 && unit;
    const lineTotalMinor = valid ? card.priceMinor * quantity : null;
    const safe = lineTotalMinor !== null && Number.isSafeInteger(lineTotalMinor);
    return { ...row, unit, unitPriceMinor: observedPrice ? card.priceMinor : null, lineTotalMinor: safe ? lineTotalMinor : null,
      freshness: observation.freshness,
      addable: Boolean(valid && safe && typeof row.product?.id === 'string' && row.product.id && row.product.name && row.product.unit) };
  });
  const known = lines.filter(row => row.lineTotalMinor !== null);
  const subtotal = known.reduce((sum, row) => sum + row.lineTotalMinor, 0);
  return { lines, hasEstimates: known.some(row=>row.unit?.approximate===true), knownSubtotalMinor: Number.isSafeInteger(subtotal) && known.length ? subtotal : null,
    complete: lines.length > 0 && known.length === lines.length,
    allRecent: lines.length > 0 && lines.every(row => row.freshness === 'recent'),
    basket: lines.filter(row => row.addable).map(row => ({ ...row.product, quantity: row.quantity })),
    winner: null, availability: 'unknown' };
}
