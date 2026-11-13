// Search envelopes for dated directories. They only choose a local dataset;
// they are not administrative boundaries or a completeness claim.
export const NEARBY_REGIONS = Object.freeze([
  { id: 'moscow-and-oblast', label: 'Москва', lat: 55.7558, lon: 37.6176, aliases: ['москва'], bounds: [35.351, 54.433, 40.073, 56.847], states: ['Москва', 'Московская область'] },
  { id: 'saint-petersburg', label: 'Санкт-Петербург', lat: 59.9343, lon: 30.3351, aliases: ['санкт-петербург', 'санкт петербург', 'спб', 'петербург'], bounds: [28.5, 59.4, 31.45, 60.55], states: ['Санкт-Петербург'] },
  { id: 'kazan', label: 'Казань', lat: 55.7961, lon: 49.1064, aliases: ['казань'], bounds: [48.7, 55.48, 49.51, 56.1], states: ['Татарстан', 'Республика Татарстан'] },
  { id: 'yekaterinburg', label: 'Екатеринбург', lat: 56.8389, lon: 60.6057, aliases: ['екатеринбург'], bounds: [59.75, 56.45, 61.33, 57.33], states: ['Свердловская область'] },
  { id: 'novosibirsk', label: 'Новосибирск', lat: 55.0084, lon: 82.9357, aliases: ['новосибирск'], bounds: [82.42, 54.65, 83.46, 55.37], states: ['Новосибирская область'] },
  { id: 'nizhny-novgorod', label: 'Нижний Новгород', lat: 56.3269, lon: 44.0059, aliases: ['нижний новгород'], bounds: [43.15, 55.92, 44.53, 56.6], states: ['Нижегородская область'] }
].map(region => Object.freeze({ ...region, aliases: Object.freeze(region.aliases), bounds: Object.freeze(region.bounds), states: Object.freeze(region.states) })));

const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/[‐‑–—]/gu, '-').replace(/\s+/gu, ' ').trim();

export function nearbyRegionForPosition(point) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return null;
  return NEARBY_REGIONS.find(({ bounds: [west, south, east, north] }) => point.lon >= west && point.lon <= east && point.lat >= south && point.lat <= north) ?? null;
}

export function nearbyCityQuery(query) {
  const value = normalize(query).replace(/^(?:город\s+|г\.\s*|г\s+)/u, '');
  for (const region of NEARBY_REGIONS) for (const alias of region.aliases) {
    if (!value.startsWith(alias) || value.length > alias.length && !/[\s,.!]/u.test(value[alias.length])) continue;
    return { region, address: value.slice(alias.length).replace(/^[\s,.!]+/u, '').trim() };
  }
  return null;
}

export function nearbyAddressQueryInRegion(query, regionId) {
  if (typeof query !== 'string' || nearbyCityQuery(query)) return query;
  const region = NEARBY_REGIONS.find(row => row.id === regionId && row.id !== 'moscow-and-oblast');
  return region ? `${region.label}, ${query.trim()}` : query;
}

export function nearbyGeocoderRegion(properties, point) {
  const region = nearbyRegionForPosition(point);
  if (!region || !region.states.some(state => normalize(state) === normalize(properties?.state))) return null;
  if (region.id === 'moscow-and-oblast' || region.id === 'saint-petersburg') return region;
  const city = normalize(properties?.city ?? properties?.town ?? properties?.village).replace(/^(?:город\s+|г\.\s*|г\s+)/u, '');
  return city === normalize(region.label) ? region : null;
}
