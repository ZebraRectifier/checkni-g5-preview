import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sourceDescriptor.mjs";

export const OPEN_PRICES_LICENSE_PROVENANCE = Object.freeze({
  name: "Open Database License (ODbL) v1.0",
  url: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution: "Open Prices / Open Food Facts",
  documentationUrl: "https://openfoodfacts.github.io/open-prices/guides/data/#license"
});

export const openPricesSource = defineSensorSource({
  id: "open-prices",
  name: "Open Prices",
  role: SENSOR_SOURCE_ROLE.OPEN_DATA,
  state: SENSOR_SOURCE_STATE.READY,
  publicUrl: "https://prices.openfoodfacts.org/",
  capabilities: {
    manualHandoff: true,
    openDataRead: true,
    historicalPriceRead: true
  },
  license: OPEN_PRICES_LICENSE_PROVENANCE,
  notes: "Open-data historical/cross-check reads are enabled. This source does not become live availability or current exact-store truth."
});
