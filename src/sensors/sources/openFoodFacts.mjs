import {
  defineSensorSource,
  SENSOR_SOURCE_ROLE,
  SENSOR_SOURCE_STATE
} from "../sourceDescriptor.mjs";

export const OPEN_FOOD_FACTS_LICENSE_PROVENANCE = Object.freeze({
  name: "Open Database License (ODbL) v1.0",
  url: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution: "Open Food Facts contributors",
  documentationUrl: "https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/94-are-there-conditions-to-use-the-api"
});

export const openFoodFactsSource = defineSensorSource({
  id: "open-food-facts",
  name: "Open Food Facts",
  role: SENSOR_SOURCE_ROLE.OPEN_DATA,
  state: SENSOR_SOURCE_STATE.READY,
  publicUrl: "https://world.openfoodfacts.org/",
  capabilities: {
    openDataRead: true
  },
  license: OPEN_FOOD_FACTS_LICENSE_PROVENANCE,
  notes: "Zero-cost catalog discovery and barcode identity only. Product presence does not prove retailer presence, price, stock, availability or checkout."
});
