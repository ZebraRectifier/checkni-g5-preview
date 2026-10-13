import { resolveMagnitMoscowStore } from "../data/magnitMoscowStores.mjs";
import { resolveMagnitMoscowOblastStore } from "../data/magnitMoscowOblastBindings.mjs";
import { resolveMetroMoscowRegionStore, normalizeMetroStoreAddress } from "../data/metroMoscowRegionStores.mjs";
import { resolveGlobusMoscowRegionStore } from "../data/globusMoscowRegionStores.mjs";

const textKey = value => typeof value === "string" ? value.normalize("NFKC")
  .toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, "") : null;
const ref = value => typeof value === "string" && /^\d{1,12}$/u.test(value) ? value : null;

function scope(mode, stores, valid = true) {
  const frozen = Object.freeze(stores.map(store => Object.freeze({ ...store,
    storeIds: Object.freeze(store.storeIds), addressKeys: Object.freeze(store.addressKeys) })));
  return Object.freeze({ kind: "selected-store-scope", valid, mode, stores: frozen,
    key: JSON.stringify([mode, valid, frozen.map(store => [store.retailerId, store.storeIds, store.addressKeys])]) });
}
function magnitStore(shopCode, address) {
  return { retailerId: "magnit", name: "Магнит", address, shopCode,
    storeIds: [`magnit-shop-${shopCode}`, `magnit-${shopCode}`], addressKeys: [textKey(address)] };
}
function metroStore(store) {
  return { retailerId: "metro", name: "METRO", address: store.address,
    storeIds: [store.storeId], addressKeys: [store.address, store.onlinePickupLabel]
      .map(normalizeMetroStoreAddress).filter(Boolean) };
}

export function createSelectedStoreScope(selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)
      || Object.keys(selection).some(key => !["magnit", "metro", "globus"].includes(key))) {
    return scope("selected", [], false);
  }
  const stores = [];
  if (Object.hasOwn(selection, "magnit")) {
    const shopCode = ref(selection.magnit);
    const store = shopCode && (resolveMagnitMoscowStore({ shopCode })
      ?? resolveMagnitMoscowOblastStore({ shopCode }));
    if (!store) return scope("selected", [], false);
    stores.push(magnitStore(shopCode, store.address));
  }
  if (Object.hasOwn(selection, "metro")) {
    const store = ref(selection.metro) && resolveMetroMoscowRegionStore({ storeNumber: selection.metro });
    if (!store || store.onlinePickupStatus !== "proven") return scope("selected", [], false);
    stores.push(metroStore(store));
  }
  if (Object.hasOwn(selection, "globus")) {
    const store = ref(selection.globus) && resolveGlobusMoscowRegionStore(selection.globus);
    if (!store || store.priceStatus !== "verified") return scope("selected", [], false);
    stores.push({ retailerId: "globus", name: store.name, address: store.address,
      storeIds: [`globus-store-${store.officialStoreId}`], addressKeys: [textKey(store.address)] });
  }
  return scope("selected", stores, stores.length > 0);
}

// These are only the existing, explicit live example's source locations.
// They are not additions to the catalogue's official-selector registry.
export function createLiveExampleStoreScope() {
  return scope("live-example", [
    metroStore(resolveMetroMoscowRegionStore({ storeNumber: "10" })),
    magnitStore("777016", "г Москва, ул 1812 года, д 12")
  ]);
}

function magnitUrlMatches(offer, store) {
  try {
    const url = new URL(offer.sourceUrl);
    return url.protocol === "https:" && ["magnit.ru", "www.magnit.ru"].includes(url.hostname)
      && !url.username && !url.password && !url.port && !url.hash
      && url.pathname.startsWith("/product/")
      && url.searchParams.getAll("shopCode").length === 1
      && url.searchParams.get("shopCode") === store.shopCode
      && url.searchParams.getAll("shopType").length === 1
      && url.searchParams.get("shopType") === "1"
      && [...url.searchParams.keys()].every(key => ["shopCode", "shopType"].includes(key));
  } catch { return false; }
}

export function selectStoreScopedOffers(offers, selectedScope) {
  if (!Array.isArray(offers)) throw new TypeError("store-scoped offers require an array");
  if (selectedScope?.kind !== "selected-store-scope" || selectedScope.valid !== true) return [];
  return offers.filter(offer => selectedScope.stores.some(store => (
    offer?.retailerId === store.retailerId
    && offer.locationTruthLevel === "store" && offer.granularity === "exact-store"
    && store.storeIds.includes(offer.storeId)
    && offer.locationId === `${store.retailerId}:${offer.storeId}`
    && store.addressKeys.includes(store.retailerId === "metro"
      ? normalizeMetroStoreAddress(offer.locationLabel) : textKey(offer.locationLabel))
    && (store.retailerId !== "magnit" || magnitUrlMatches(offer, store))
  )));
}
