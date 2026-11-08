export const OFFICIAL_CATALOG_URL = 'https://www.okmarket.ru/catalogs/';
export const OFFICIAL_SCOPE = 'moscow-city-promotion-not-exact-store';
const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export const moscowDate = ms => new Intl.DateTimeFormat('sv-SE', {
  timeZone:'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit'
}).format(new Date(ms));
export function officialProductUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'www.okmarket.ru' && !u.port && !u.username && !u.password
      && !u.search && !u.hash && /^\/product\/[a-z0-9_-]+\/$/.test(u.pathname) ? u.href : null;
  } catch { return null; }
}
function price(rubles, cents) {
  if (!/^[\d\s]+$/u.test(rubles ?? '') || !/^\d{2}$/.test(cents ?? '')) return null;
  const value = Number(rubles.replace(/\s/gu,''))*100+Number(cents);
  return Number.isSafeInteger(value) && value > 0 && value <= 100_000_000 ? value : null;
}
export function parseOfficialProduct(raw) {
  const url = officialProductUrl(raw?.productUrl), at = Date.parse(raw?.observedAt);
  if (!url || raw.selectedCity !== 'Москва' || !Number.isFinite(at)) return null;
  const today = moscowDate(at);
  const match = raw.endText?.trim().match(/^Акция действует до\s+(\d{1,2})\s+([а-яё]+)$/iu);
  if (!match) return null;
  const month = months.indexOf(match[2].toLowerCase())+1, day = Number(match[1]), year = Number(today.slice(0,4));
  const end = new Date(Date.UTC(year,month-1,day));
  if (!month || end.getUTCFullYear() !== year || end.getUTCMonth()+1 !== month || end.getUTCDate() !== day) return null;
  const validUntil = end.toISOString().slice(0,10);
  const priceMinor = price(raw.rubles,raw.cents), name = raw.name?.replace(/\s+/gu,' ').trim();
  // The source omits the year. Never roll an expired date forward into another year.
  if (!name || name.length > 400 || priceMinor === null || validUntil < today) return null;
  return { sourceProductId:new URL(url).pathname.split('/')[2], name, productUrl:url, priceMinor,
    referenceOldPriceMinor:price(raw.oldRubles,raw.oldCents), priceWithCardMinor:null, priceWithoutCardMinor:null,
    priceCondition:'promotion-conditions-unconfirmed', availability:'unknown', observedAt:new Date(at).toISOString(),
    validUntil, sourceDatePrecision:'day-without-year' };
}
export function validOfficialSnapshot(s) {
  const at = Date.parse(s?.observedAt);
  if (s?.version !== 1 || s.kind !== 'okey-official-city-promotions' || s.retailerId !== 'okey'
    || s.sourceUrl !== OFFICIAL_CATALOG_URL || s.scope !== OFFICIAL_SCOPE || s.selectedCity !== 'Москва'
    || s.physicalStoreId !== null || s.physicalStoreAddress !== null || s.complete !== false
    || !Number.isFinite(at) || !Array.isArray(s.products) || !s.products.length || s.products.length > 36) return false;
  const ids = new Set();
  return s.products.every(p => {
    const observed = Date.parse(p.observedAt), validDate = Date.parse(p.validUntil+'T00:00:00Z');
    if (!officialProductUrl(p.productUrl) || p.sourceProductId !== new URL(p.productUrl).pathname.split('/')[2]
      || ids.has(p.sourceProductId) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 400
      || !Number.isSafeInteger(p.priceMinor) || p.priceMinor <= 0 || p.priceMinor > 100_000_000
      || p.priceWithCardMinor !== null || p.priceWithoutCardMinor !== null || p.availability !== 'unknown'
      || p.priceCondition !== 'promotion-conditions-unconfirmed' || p.sourceDatePrecision !== 'day-without-year'
      || !Number.isFinite(observed) || observed > at || at-observed > 600_000
      || !/^\d{4}-\d{2}-\d{2}$/.test(p.validUntil) || !Number.isFinite(validDate)
      || new Date(validDate).toISOString().slice(0,10) !== p.validUntil || p.validUntil < moscowDate(observed)
      || !(p.referenceOldPriceMinor === null || Number.isSafeInteger(p.referenceOldPriceMinor) && p.referenceOldPriceMinor > 0)) return false;
    ids.add(p.sourceProductId); return true;
  });
}
export function currentOfficialProducts(snapshot, nowMs = Date.now()) {
  if (!validOfficialSnapshot(snapshot)) return [];
  const today = moscowDate(nowMs);
  return snapshot.products.filter(p => Date.parse(p.observedAt) <= nowMs
    && nowMs-Date.parse(p.observedAt) <= 86_400_000 && p.validUntil >= today);
}
export function verifyOfficialRefresh({startedAt,status,snapshot,nowMs=Date.now()}) {
  const start = Date.parse(startedAt), attempt = Date.parse(status?.lastAttemptAt);
  if (!Number.isFinite(start) || start > nowMs || status?.status !== 'collected'
    || !Number.isFinite(attempt) || attempt < start || attempt > nowMs || !validOfficialSnapshot(snapshot)
    || Date.parse(snapshot.observedAt) < attempt || Date.parse(snapshot.observedAt) > nowMs
    || status.uniqueProducts !== snapshot.products.length || snapshot.products.some(p=>Date.parse(p.observedAt)<attempt)) {
    return {fresh:false,reason:status?.status==='blocked'?'official-source-blocked':'no-new-official-evidence'};
  }
  const current = currentOfficialProducts(snapshot,nowMs);
  return {fresh:current.length>0,reason:current.length?'fresh-official-city-promotions':'no-current-promotions',
    scope:OFFICIAL_SCOPE,products:current.length,observedAt:snapshot.observedAt};
}
