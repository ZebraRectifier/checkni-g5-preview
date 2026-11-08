import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  METRO_NEARBY_MAP_BINDINGS,
  METRO_NEARBY_MAP_EVIDENCE,
  reviewedMetroNearbyBinding,
  withReviewedMetroNearbyBindings
} from "../src/data/metroNearbyMapBindings.mjs";
import {
  nearbyCatalogBinding,
  nearbyGroceryMatches,
  nearestStoreMapPins
} from "../src/intelligence/nearbyShopping.mjs";
import { createRetailCatalogClient } from "../src/ports/retailCatalogPort.mjs";

async function sourceDirectory() {
  return JSON.parse(await readFile(new URL("../src/data/nearbyGroceryStores.json", import.meta.url), "utf8"));
}

test("admits exactly eight reviewed METRO OSM points without price or stock claims", async () => {
  const directory = withReviewedMetroNearbyBindings(await sourceDirectory());
  const admitted = directory.stores.filter(point => nearbyCatalogBinding(point)?.retailerId === "metro");
  assert.equal(METRO_NEARBY_MAP_BINDINGS.length, 8);
  assert.equal(admitted.length, 8);
  assert.equal(new Set(admitted.map(point => nearbyCatalogBinding(point).store.storeNumber)).size, 8);
  assert.equal(METRO_NEARBY_MAP_EVIDENCE.coordinateLicense, "ODbL-1.0");
  assert.equal(METRO_NEARBY_MAP_EVIDENCE.attribution, "© OpenStreetMap contributors");
  for (const point of admitted) {
    const binding = nearbyCatalogBinding(point);
    const reviewed = METRO_NEARBY_MAP_BINDINGS.find(row => row.pointId === point.id);
    assert.ok(reviewed);
    assert.equal(binding.store.storeNumber, reviewed.storeNumber);
    assert.equal(binding.store.storeId, reviewed.storeId);
    assert.equal(point.address, reviewed.sourceAddress);
    assert.equal(point.priceMinor, undefined);
    assert.equal(point.availability, undefined);
    assert.equal(point.stock, undefined);
  }
});

test("reviewed METRO points are active nearby cards and map pins with the exact store context", async () => {
  const directory = withReviewedMetroNearbyBindings(await sourceDirectory());
  for (const reviewed of METRO_NEARBY_MAP_BINDINGS) {
    const point = directory.stores.find(row => row.id === reviewed.pointId);
    const matches = nearbyGroceryMatches(directory.stores, point, 1, { connectedOnly: true });
    const card = matches.find(row => row.id === reviewed.pointId);
    assert.equal(card.catalog.store.storeNumber, reviewed.storeNumber);
    assert.ok(nearestStoreMapPins(matches, point).some(row => row.id === reviewed.pointId));
  }
});

test("exact METRO catalog transport uses the selected binding rather than the default store", async () => {
  const directory = withReviewedMetroNearbyBindings(await sourceDirectory());
  for (const reviewed of METRO_NEARBY_MAP_BINDINGS) {
    const point = directory.stores.find(row => row.id === reviewed.pointId);
    const catalog = nearbyCatalogBinding(point);
    let requested;
    const client = createRetailCatalogClient({
      retailerId: "metro",
      store: catalog.store,
      endpoint: "https://project.supabase.co/rest/v1/retail_catalog_items",
      publishableKey: "test-key",
      fetchImpl: async value => {
        requested = new URL(value);
        return Response.json([]);
      }
    });
    assert.equal(client.definition.storeId, reviewed.storeId);
    assert.ok(client.definition.acceptedLocationLabels.includes(reviewed.officialAddress));
    assert.equal((await client.browse({ limit: 1 })).kind, "catalog");
    assert.equal(requested.searchParams.get("retailer_id"), "eq.metro");
    assert.equal(requested.searchParams.get("store_id"), `eq.${reviewed.storeId}`);
  }
});

test("moved, forged, duplicated and uncertain METRO points fail closed", async () => {
  const raw = await sourceDirectory();
  const reviewed = METRO_NEARBY_MAP_BINDINGS[0];
  const original = raw.stores.find(point => point.id === reviewed.pointId);
  for (const changed of [
    { address: original.address + " корпус 2" },
    { lat: original.lat + 0.0001 },
    { lon: original.lon + 0.0001 },
    { sourceUrl: "https://www.openstreetmap.org/node/1" },
    { retailerId: "magnit" },
    { name: "Другой магазин" }
  ]) {
    const changedDirectory = { ...raw, stores: raw.stores.map(point =>
      point.id === original.id ? { ...point, ...changed } : point) };
    const point = withReviewedMetroNearbyBindings(changedDirectory).stores.find(row => row.id === original.id);
    assert.equal(nearbyCatalogBinding(point), null);
  }
  const duplicated = withReviewedMetroNearbyBindings({ ...raw, stores: [...raw.stores, { ...original }] });
  assert.equal(duplicated.stores.filter(point => point.id === original.id).every(point => !point.catalogBinding), true);
  for (const pointId of ["osm:relation:14347995", "osm:node:7831705436", "osm:way:623061170", "osm:way:730157747"]) {
    const point = withReviewedMetroNearbyBindings(raw).stores.find(row => row.id === pointId);
    assert.equal(nearbyCatalogBinding(point), null);
  }
  const forged = { ...original, catalogBinding: {
    retailerId: "metro", kind: "reviewed-osm-official-exact-address-join",
    storeNumber: "10", storeId: "metro-address-c5gsqz", bindingId: "metro-address-c5gsqz",
    address: "125445, г. Москва, Ленинградское шоссе 71Г", sourceAddress: original.address,
    coordinateObservedAt: "2026-10-18T00:49:32.311Z", officialObservedAt: "2026-10-07"
  } };
  assert.equal(reviewedMetroNearbyBinding(forged)?.store.storeNumber, "10");
  forged.catalogBinding.storeNumber = "12";
  assert.equal(nearbyCatalogBinding(forged), null);
});

test("directory provenance mismatch disables every reviewed METRO binding", async () => {
  const raw = await sourceDirectory();
  for (const changed of [
    { observedAt: "2026-10-19T00:49:32.311Z" },
    { license: "unknown" },
    { attribution: "unknown" },
    { attributionUrl: "https://example.org" },
    { priceEvidence: true },
    { exhaustive: true }
  ]) {
    const directory = withReviewedMetroNearbyBindings({ ...raw, ...changed });
    assert.equal(directory.stores.some(point => nearbyCatalogBinding(point)?.retailerId === "metro"), false);
  }
});
