import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NEARBY_REGIONS, nearbyRegionForPosition, nearbyCityQuery, nearbyAddressQueryInRegion } from '../src/intelligence/nearbyRegions.mjs';
import { normalizedAddressCandidate } from '../src/intelligence/nearbyAddressContract.mjs';
import { createNearbyShoppingPort } from '../src/ports/nearbyShoppingPort.mjs';

test('city prefixes work without commas but do not treat similar street names as a city', () => {
  for (const [query, id, address] of [
    ['г. Казань ул. Баумана, 7', 'kazan', 'ул. баумана, 7'],
    ['Санкт Петербург Невский проспект 10', 'saint-petersburg', 'невский проспект 10'],
    ['СПб', 'saint-petersburg', ''], ['Нижний Новгород!', 'nizhny-novgorod', ''],
    ['Екатеринбург, Ленина 7', 'yekaterinburg', 'ленина 7'],
    ['Новосибирск Красный проспект 1', 'novosibirsk', 'красный проспект 1']
  ]) {
    const parsed = nearbyCityQuery(query);
    assert.equal(parsed?.region.id, id); assert.equal(parsed.address, address);
  }
  for (const query of ['Казанская улица 7', 'Московская область, Пушкино', 'Ростов-на-Дону'])
    assert.equal(nearbyCityQuery(query), null);
});

test('device points resolve only covered directory envelopes, including all currently admitted city points', async () => {
  for (const region of NEARBY_REGIONS) {
    assert.equal(nearbyRegionForPosition(region)?.id, region.id);
    const path = region.id === 'moscow-and-oblast' ? 'nearbyGroceryStores.json' : `nearby-regions/${region.id}.json`;
    const directory = JSON.parse(await readFile(new URL('../src/data/' + path, import.meta.url)));
    for (const row of directory.stores) assert.equal(nearbyRegionForPosition(row)?.id, region.id, row.id);
  }
  for (const position of [{ lat: 43.585, lon: 39.72 }, { lat: 0, lon: 0 }, { lat: NaN, lon: 37 }, { lat: 55, lon: '49' }])
    assert.equal(nearbyRegionForPosition(position), null);
});

test('street-only follow-ups retain the selected city while explicit cities and multi-city Moscow region remain unchanged',()=>{
  assert.equal(nearbyAddressQueryInRegion('улица Баумана 7','kazan'),'Казань, улица Баумана 7');
  assert.equal(nearbyAddressQueryInRegion('Казанская улица 7','saint-petersburg'),'Санкт-Петербург, Казанская улица 7');
  assert.equal(nearbyAddressQueryInRegion('СПб Невский проспект 10','kazan'),'СПб Невский проспект 10');
  assert.equal(nearbyAddressQueryInRegion('Москва Тверская 7','kazan'),'Москва Тверская 7');
  assert.equal(nearbyAddressQueryInRegion('Пушкино Красноармейское шоссе 105','moscow-and-oblast'),'Пушкино Красноармейское шоссе 105');
  assert.equal(nearbyAddressQueryInRegion('Ленина 7',null),'Ленина 7');
});

test('regional geocoder requires RU, matching city/state and bounded coordinates', () => {
  const feature = (region, properties = {}, coordinates = [region.lon, region.lat]) => ({
    geometry: { type: 'Point', coordinates }, properties: { countrycode: 'RU', state: region.states[0],
      city: region.label, street: 'Улица Ленина', housenumber: '7', ...properties }
  });
  for (const region of NEARBY_REGIONS) {
    assert.equal(normalizedAddressCandidate(feature(region))?.precision, 'house');
    assert.equal(normalizedAddressCandidate(feature(region, { countrycode: 'US' })), null);
    assert.equal(normalizedAddressCandidate(feature(region, { state: 'Неизвестная область' })), null);
    assert.equal(normalizedAddressCandidate(feature(region, {}, [0, 0])), null);
  }
  const kazan = NEARBY_REGIONS.find(r => r.id === 'kazan');
  assert.equal(normalizedAddressCandidate(feature(kazan, { city: 'Зеленодольск' })), null);
  assert.equal(normalizedAddressCandidate(feature(kazan, { street: {} })), null);
  assert.equal(normalizedAddressCandidate(feature(kazan, { city: 'Казань' }, [49.1, 58])), null);
});

test('regional home search uses the existing endpoint and rejects returned Moscow candidates', async () => {
  let sent;
  const port = createNearbyShoppingPort({ fetchImpl: async (url, options) => {
    assert.match(String(url), /functions\/v1\/nearby-address$/u);
    sent = JSON.parse(options.body);
    return Response.json({ version: 1, candidates: [
      { lat: 55.79, lon: 49.12, label: 'Казань, улица Баумана, 7', precision: 'house' },
      { lat: 55.75, lon: 37.61, label: 'Москва, улица Баумана, 7', precision: 'house' }
    ] });
  } });
  const result = await port.address('Казань улица Баумана 7');
  assert.deepEqual(sent, { query: 'Казань улица Баумана 7', consent: true });
  assert.equal(result.candidates.length, 1); assert.match(result.candidates[0].label, /^Казань/u);
});

test('old server empty result falls back only to exact regional shop landmarks, never a fabricated home address', async () => {
  const urls = [];
  const port = createNearbyShoppingPort({ fetchImpl: async url => {
    urls.push(String(url));
    if (String(url).includes('/functions/')) return Response.json({ version: 1, candidates: [] });
    assert.match(String(url), /nearby-regions\/kazan\.json$/u);
    return Response.json({ schemaVersion: 1, region: 'kazan', exhaustive: false, priceEvidence: false,
      observedAt: '2026-11-05T00:00:00Z', stores: [{ name: 'Магнит', address: 'Казань, Баумана, 70', lat: 55.79, lon: 49.12 }] });
  } });
  const exact = await port.address('Казань Баумана 70');
  assert.equal(exact.kind, 'directory'); assert.equal(exact.candidates[0].precision, 'store');
  assert.match(exact.candidates[0].label, /^Магнит/u);
  const unknown = await port.address('Казань Баумана 7');
  assert.equal(unknown.kind, 'results'); assert.deepEqual(unknown.candidates, []);
  assert.equal(urls.filter(url => url.endsWith('/kazan.json')).length, 1);
  assert.equal(urls.some(url => url.endsWith('/nearbyGroceryStores.json')), false);
});

test('regional cache never admits a catalogue binding without evidence and retries a failed directory read', async () => {
  let calls = 0;
  const port = createNearbyShoppingPort({ fetchImpl: async () => Response.json({ schemaVersion: 1, region: 'kazan',
    exhaustive: false, priceEvidence: false, observedAt: '2026-11-05T00:00:00Z',
    stores: ++calls === 1 ? [{ catalogBinding: { kind: 'invented' } }] : [] }) });
  await assert.rejects(port.regionalDirectory('kazan'), /directory_invalid/u);
  assert.equal((await port.regionalDirectory('kazan')).stores.length, 0);
  assert.equal(calls, 2);
});
