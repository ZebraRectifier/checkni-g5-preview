import { deliverySource } from "./sources/delivery.mjs";
import { edadealSource } from "./sources/edadeal.mjs";
import { kuperSource } from "./sources/kuper.mjs";
import { megamarketSource } from "./sources/megamarket.mjs";
import { openFoodFactsSource } from "./sources/openFoodFacts.mjs";
import { openPricesSource } from "./sources/openPrices.mjs";
import { ozonFreshSource } from "./sources/ozonFresh.mjs";
import { samokatSource } from "./sources/samokat.mjs";
import { vprokSource } from "./sources/vprok.mjs";
import { yandexEdaSource } from "./sources/yandexEda.mjs";
import { yandexMapsEdadealExactStoreSource } from "./sources/yandexMapsEdadealExactStore.mjs";

export const SENSOR_SOURCES = Object.freeze([
  yandexEdaSource,
  yandexMapsEdadealExactStoreSource,
  kuperSource,
  deliverySource,
  megamarketSource,
  edadealSource,
  ozonFreshSource,
  samokatSource,
  vprokSource,
  openFoodFactsSource,
  openPricesSource
]);

export function getSensorSource(sourceId) {
  return SENSOR_SOURCES.find((source) => source.id === sourceId) ?? null;
}

export function getAutomatedObservationSources() {
  return SENSOR_SOURCES.filter(
    (source) => source.capabilities.automatedObservation === true
  );
}

export function getResearchCandidateSources() {
  return SENSOR_SOURCES.filter(
    (source) => source.capabilities.publicPageResearch === true
  );
}

export function getManualHandoffSources() {
  return SENSOR_SOURCES.filter(
    (source) => source.capabilities.manualHandoff === true
  );
}
