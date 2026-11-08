// Mutable observations stay at the public data root, independently of the
// immutable code release. Names are deliberately not general-purpose paths.
const FILES = new Set([
  'nearbyGroceryStores.json',
  ...['saint-petersburg','kazan','yekaterinburg','novosibirsk','nizhny-novgorod'].map(city => `nearby-regions/${city}.json`),
  'pyaterochkaPublishedPromotions.json',
  'okeyOfficialPromotions.json', 'okeyOfficialRefresh.json',
  'okeyPublishedPromotions.json', 'okeyPublishedRefresh.json',
  'okeyDeliveryHistory.json', 'okeyDeliveryRefresh.json'
]);

export function publicDataUrl(name, moduleUrl = import.meta.url) {
  if (typeof name !== 'string' || !FILES.has(name)) throw new Error('public_data_name_invalid');
  let base;
  try { base = new URL(moduleUrl); } catch { throw new Error('public_data_module_url_invalid'); }
  if (!['https:', 'http:', 'file:'].includes(base.protocol) || base.username || base.password
    || !base.pathname.endsWith('/src/ports/publicDataUrl.mjs')) throw new Error('public_data_module_url_invalid');
  const release = base.pathname.match(/\/releases\/([^/]+)\/src\/ports\/publicDataUrl\.mjs$/u);
  if (release && !/^[a-f0-9]{64}$/u.test(release[1])) throw new Error('public_data_module_url_invalid');
  const url = new URL('../data/' + name, base);
  if (release) url.pathname = url.pathname.replace(/\/releases\/[a-f0-9]{64}(\/src\/data\/.+)$/u, '$1');
  return url;
}
