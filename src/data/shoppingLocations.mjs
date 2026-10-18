import { GLOBUS_MAP_LOCATIONS } from './storeMapLocations.mjs';
import { resolveGlobusMoscowRegionStore } from './globusMoscowRegionStores.mjs';

// Public landmark, never a user's home or device location. Distances are
// orientation in a circle, not driving distances or delivery coverage.
export const SHOPPING_LANDMARKS = Object.freeze([Object.freeze({
  id: 'zavety-ilyicha-station', name: 'станция Заветы Ильича',
  lat: 56.0400277778, lon: 37.8543333333,
  sourceUrl: 'https://www.wikidata.org/wiki/Q4183017', observedAt: '2026-10-17',
  coordinateKind: 'public-landmark'
})]);

export function shoppingLocationRequest(text) {
  const value = String(text ?? '').toLowerCase().replaceAll('ё', 'е');
  const radius = value.match(/(?:до|радиус(?:е|ом)?|в пределах)\s*(\d{1,3})\s*км/u);
  const landmark = SHOPPING_LANDMARKS.find(row => row.id === 'zavety-ilyicha-station'
    && /завет(?:ы|ах|ов)\s+ильича/u.test(value));
  if (/не\s+(?:станци\S*\s+)?завет/u.test(value)) return { unsupported: true };
  if (!landmark) return radius || /(?:станци|живу|магазины рядом)/u.test(value) ? { unsupported: true } : null;
  const radiusKm = radius ? Number(radius[1]) : 20;
  if (radiusKm < 1 || radiusKm > 20) return { unsupported: true };
  return { landmark, radiusKm };
}

export function nearbyShoppingStores(location) {
  if (!location || location.unsupported || !SHOPPING_LANDMARKS.includes(location.landmark)
      || !Number.isInteger(location.radiusKm) || location.radiusKm < 1 || location.radiusKm > 20) return [];
  const { lat, lon } = location.landmark, rad = value => value * Math.PI / 180;
  return GLOBUS_MAP_LOCATIONS.flatMap(point => {
    const a = Math.sin(rad(point.lat - lat) / 2) ** 2
      + Math.cos(rad(lat)) * Math.cos(rad(point.lat)) * Math.sin(rad(point.lon - lon) / 2) ** 2;
    const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const store = resolveGlobusMoscowRegionStore(point.officialStoreId);
    return distanceKm <= location.radiusKm && store?.priceStatus === 'verified'
      ? [{ ...store, distanceKm, distanceKind: 'straight-line' }] : [];
  }).sort((a, b) => a.distanceKm - b.distanceKm);
}
