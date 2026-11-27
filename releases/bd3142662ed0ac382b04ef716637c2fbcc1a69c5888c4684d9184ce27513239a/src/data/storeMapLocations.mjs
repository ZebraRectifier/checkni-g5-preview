import { GLOBUS_MOSCOW_REGION_DIRECTORY } from "./globusMoscowRegionStores.mjs";
import { resolveMetroMoscowRegionStore } from "./metroMoscowRegionStores.mjs";

// Geography is presentation evidence only. These points do not establish price,
// stock, service radius, road distance or an entrance that can be used for routing.
const SOURCE_COMMIT = "f717f14295dc7713ec944287d730fc58e7d2447a";
const REPOSITORY_URL = "https://github.com/ZebraRectifier/Checkni";
export const GLOBUS_MAP_LOCATION_EVIDENCE = Object.freeze({
  repositoryCommit: SOURCE_COMMIT,
  artifactPath: "artifacts/globus-address-pass/selection-probe.json",
  artifactBlobSha: "0c3cefed2e9c84252966f1ae850c1b4c9364cdc0",
  evidenceUrl: `${REPOSITORY_URL}/blob/${SOURCE_COMMIT}/artifacts/globus-address-pass/selection-probe.json`,
  sourceUrl: "https://www.globus.ru/catalog/molochnye-produkty-syr-yajcza-10118965",
  observedAt: "2026-10-10T08:14:02.021Z",
  evidenceKind: "official-public-store-directory",
  stateLabel: "selected-shchelkovo-ssr",
  directoryKey: "directories-stores"
});

// Exact store identity and full address from the dated public directory. The
// same artifact also has pickup-point coordinates; those are deliberately not
// used for physical stores. Registry drift fails closed below.
const GLOBUS_DIRECTORY_POINTS = [
  ["5001", "Глобус Щелково", "г. Щелково, Пролетарский пр-т, д. 18", 55.928776, 38.003613],
  ["5002", "Глобус Климовск", "г. Подольск, мкрн Климовск, ул. Молодежная, д. 11", 55.386417, 37.545304],
  ["5010", "Глобус Королёв", "г. Королёв, ул. Коммунальная, д. 1", 55.915419, 37.84628],
  ["5011", "Глобус Красногорск", "г. Москва, вн.тер.г. муниципальный округ Кунцево, Новорижское шоссе 22-й км, д. 1 стр. 1", 55.802136, 37.299144],
  ["5013", "Глобус Электросталь", "г.о. Электросталь, пос. Случайный, массив 1, стр. 2", 55.75938, 38.436006],
  ["5014", "Глобус Пушкино", "г. Пушкино, Красноармейское ш., вл. 105", 56.01942, 37.885139],
  ["5015", "Глобус Одинцово", "Одинцовский г.о., Юдино с., д. 55Е", 55.655867, 37.177234],
  ["5016", "Глобус Котельники", "г. Котельники, Новорязанское ш., д. 24", 55.658464, 37.886401],
  ["5017", "Глобус Балашиха", "г. Балашиха, Шоссе Энтузиастов, д. 48", 55.792997, 37.944375],
  ["5018", "Глобус Саларьево", "г. Москва, Киевское ш., 23-й км, д. 1", 55.622911, 37.424719],
  ["5019", "Глобус Коммунарка", "г. Москва, мун.округ Коммунарка, пос. Коммунарка, ул. Александры Монаховой, 61, стр. 1", 55.557596, 37.496022],
  ["5020", "Глобус Медведково", "г. Москва, м. Медведково, ул. Широкая, 2а", 55.887168, 37.639079],
  ["5023", "Глобус Митино", "Москва, ул. Дубравная, д. 51, стр. 2.", 55.839222, 37.353333],
  ["5024", "Глобус Косино", "г. Москва, ТРЦ Город Косино, ул. Новоухтомское шоссе 2А", 55.713106, 37.844738],
  ["5102", "Глобус Лавка Рождественка", "г. Москва, ул. Рождественка, д. 6/9/20, стр. 1", 55.761431, 37.623816],
  ["5103", "Глобус Лавка Арбат", "г. Москва, ул. Арбат д.1, пом.1А/1/1", 55.751817, 37.599292]
];

function freezeLocation(location) {
  return Object.freeze({
    kind: "store-map-location",
    ...location,
    storeIds: Object.freeze([...location.storeIds])
  });
}

export const GLOBUS_MAP_LOCATIONS = Object.freeze(
  GLOBUS_DIRECTORY_POINTS.flatMap(([officialStoreId, name, address, lat, lon]) => {
    const registered = GLOBUS_MOSCOW_REGION_DIRECTORY.stores.find(store =>
      store.officialStoreId === officialStoreId && store.name === name
      && store.address === address
    );
    if (!registered) return [];
    return [freezeLocation({
      id: `globus-store-${officialStoreId}`,
      retailerId: "globus",
      officialStoreId,
      storeIds: [`globus-store-${officialStoreId}`],
      name,
      address,
      lat,
      lon,
      coordinateKind: "official-directory",
      selectionKind: "registered-store",
      evidenceKind: GLOBUS_MAP_LOCATION_EVIDENCE.evidenceKind,
      evidenceUrl: GLOBUS_MAP_LOCATION_EVIDENCE.evidenceUrl,
      sourceUrl: GLOBUS_MAP_LOCATION_EVIDENCE.sourceUrl,
      observedAt: GLOBUS_MAP_LOCATION_EVIDENCE.observedAt
    })];
  })
);

const metroAddress = "125445, г. Москва, Ленинградское шоссе 71Г";
const metro = resolveMetroMoscowRegionStore({
  storeNumber: "10", storeId: "metro-address-c5gsqz", address: metroAddress
});
const approximateEvidenceUrl =
  `${REPOSITORY_URL}/blob/${SOURCE_COMMIT}/src/components/StoresMap.mjs`;

// Preserve the old map's two orientation points, with their limitations.
// Magnit777016 is an explicit live example, not a selectable catalogue binding.
export const APPROXIMATE_MAP_LOCATIONS = Object.freeze([
  ...(metro?.address === metroAddress ? [freezeLocation({
    id: "metro-leningradskoe",
    retailerId: "metro",
    storeIds: [metro.storeId],
    name: "METRO",
    address: metroAddress,
    lat: 55.8551,
    lon: 37.4778,
    coordinateKind: "approximate",
    selectionKind: "registered-store",
    evidenceKind: "legacy-approximate-orientation",
    evidenceUrl: approximateEvidenceUrl,
    sourceUrl: approximateEvidenceUrl,
    observedAt: null
  })] : []),
  freezeLocation({
    id: "magnit-1812",
    retailerId: "magnit",
    storeIds: ["magnit-shop-777016", "magnit-777016"],
    name: "Магнит",
    address: "г Москва, ул 1812 года, д 12",
    lat: 55.7415,
    lon: 37.5095,
    coordinateKind: "approximate",
    selectionKind: "live-example-only",
    evidenceKind: "legacy-approximate-orientation",
    evidenceUrl: approximateEvidenceUrl,
    sourceUrl: approximateEvidenceUrl,
    observedAt: null
  })
]);

export const KNOWN_STORE_MAP_LOCATIONS = Object.freeze([
  ...GLOBUS_MAP_LOCATIONS,
  ...APPROXIMATE_MAP_LOCATIONS
]);

export function resolveStoreMapLocation(store, { mode = "selected" } = {}) {
  if (!store || typeof store !== "object" || Array.isArray(store)
      || !["selected", "live-example"].includes(mode)
      || !Array.isArray(store.storeIds) || store.storeIds.length === 0
      || new Set(store.storeIds).size !== store.storeIds.length
      || store.storeIds.some(id => typeof id !== "string")) return null;
  const matches = KNOWN_STORE_MAP_LOCATIONS.filter(location =>
    location.retailerId === store.retailerId
    && location.address === store.address
    && store.storeIds.every(id => location.storeIds.includes(id))
    && (location.selectionKind !== "live-example-only" || mode === "live-example")
  );
  return matches.length === 1 ? matches[0] : null;
}

export function resolveSelectedStoreMapLocations(scope) {
  if (scope?.kind !== "selected-store-scope" || scope.valid !== true
      || !Array.isArray(scope.stores)
      || !["selected", "live-example"].includes(scope.mode)) return Object.freeze([]);
  return Object.freeze(scope.stores.flatMap(store => {
    const location = resolveStoreMapLocation(store, { mode: scope.mode });
    return location ? [location] : [];
  }));
}
