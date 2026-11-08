import {
  METRO_MOSCOW_REGION_DIRECTORY_SOURCE,
  resolveMetroMoscowRegionStore
} from "./metroMoscowRegionStores.mjs";

export const METRO_NEARBY_MAP_EVIDENCE = Object.freeze({
  kind: "reviewed-osm-official-exact-address-joins",
  reviewedAt: "2026-11-08",
  coordinateObservedAt: "2026-10-18T00:49:32.311Z",
  coordinateSource: "OpenStreetMap regional snapshot",
  coordinateLicense: "ODbL-1.0",
  attribution: "© OpenStreetMap contributors",
  attributionUrl: "https://www.openstreetmap.org/copyright",
  officialSourceUrl: METRO_MOSCOW_REGION_DIRECTORY_SOURCE.sourceUrl,
  officialObservedAt: METRO_MOSCOW_REGION_DIRECTORY_SOURCE.observedAt
});

const RAW = [
  ["osm:way:36394860", "10", "Москва, Ленинградское шоссе, 71Г", 55.8758342, 37.4473228],
  ["osm:way:38106162", "12", "Москва, Дорожная улица, 1 к1", 55.6307578, 37.6249212],
  ["osm:way:34062122", "17", "Москва, улица Маршала Прошлякова, 14", 55.7910852, 37.3886274],
  ["osm:node:266862392", "18", "Москва, МКАД, 104-й километр, 6", 55.8114853, 37.8373363],
  ["osm:way:46174133", "19", "Москва, Шоссейная улица, 2Б", 55.7007202, 37.7263875],
  ["osm:way:698235411", "67", "Железнодорожный, Советская улица, 60", 55.7500265, 38.0459609],
  ["osm:way:316838104", "1307", "Новые Псарьки, Парковая улица, 4", 55.8314389, 38.3688284],
  ["osm:node:3457055302", "1356", "Москва, 1-я Дубровская улица, 13А с1", 55.7231588, 37.6746347]
];

export const METRO_NEARBY_MAP_BINDINGS = Object.freeze(RAW.map(
  ([pointId, storeNumber, sourceAddress, lat, lon]) => {
    const store = resolveMetroMoscowRegionStore({ storeNumber });
    if (!store?.bindingId || store.onlinePickupStatus !== "proven") {
      throw new Error("reviewed_metro_store_invalid");
    }
    const [, elementType, elementId] = pointId.split(":");
    return Object.freeze({
      pointId,
      storeNumber,
      storeId: store.storeId,
      bindingId: store.bindingId,
      officialAddress: store.address,
      sourceAddress,
      lat,
      lon,
      sourceUrl: `https://www.openstreetmap.org/${elementType}/${elementId}`
    });
  }
));

function catalogBinding(row) {
  return Object.freeze({
    retailerId: "metro",
    kind: "reviewed-osm-official-exact-address-join",
    storeNumber: row.storeNumber,
    storeId: row.storeId,
    bindingId: row.bindingId,
    address: row.officialAddress,
    sourceAddress: row.sourceAddress,
    coordinateObservedAt: METRO_NEARBY_MAP_EVIDENCE.coordinateObservedAt,
    officialObservedAt: METRO_NEARBY_MAP_EVIDENCE.officialObservedAt
  });
}

export function withReviewedMetroNearbyBindings(directory) {
  if (directory?.schemaVersion !== 1 || directory.region !== "moscow-and-oblast"
      || directory.exhaustive !== false || directory.priceEvidence !== false
      || directory.observedAt !== METRO_NEARBY_MAP_EVIDENCE.coordinateObservedAt
      || directory.license !== METRO_NEARBY_MAP_EVIDENCE.coordinateLicense
      || directory.attribution !== METRO_NEARBY_MAP_EVIDENCE.attribution
      || directory.attributionUrl !== METRO_NEARBY_MAP_EVIDENCE.attributionUrl
      || !Array.isArray(directory.stores) || directory.stores.length > 25000) return directory;
  const counts = new Map();
  for (const point of directory.stores) counts.set(point?.id, (counts.get(point?.id) ?? 0) + 1);
  return Object.freeze({ ...directory, stores: Object.freeze(directory.stores.map(point => {
    const row = METRO_NEARBY_MAP_BINDINGS.find(candidate => candidate.pointId === point?.id);
    return row && counts.get(point.id) === 1 && reviewedMetroNearbyBinding(point)
      ? Object.freeze({ ...point, catalogBinding: catalogBinding(row) }) : point;
  })) });
}

export function reviewedMetroNearbyBinding(point) {
  if (!point || typeof point !== "object" || Array.isArray(point)) return null;
  const matches = METRO_NEARBY_MAP_BINDINGS.filter(row => row.pointId === point.id);
  if (matches.length !== 1) return null;
  const row = matches[0];
  if (point.retailerId !== "metro" || typeof point.name !== "string"
      || point.name.toLocaleLowerCase("ru-RU") !== "metro"
      || point.address !== row.sourceAddress || point.lat !== row.lat || point.lon !== row.lon
      || point.sourceUrl !== row.sourceUrl) return null;
  const store = resolveMetroMoscowRegionStore({
    storeNumber: row.storeNumber,
    storeId: row.storeId,
    address: row.officialAddress
  });
  return store?.bindingId === row.bindingId && store.onlinePickupStatus === "proven"
    ? Object.freeze({ retailerId: "metro", store }) : null;
}
