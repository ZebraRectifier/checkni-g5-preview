import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sourceDescriptor.mjs";

export const ozonFreshSource = defineSensorSource({
  id: "ozon-fresh",
  name: "Ozon Fresh",
  role: SENSOR_SOURCE_ROLE.RETAILER_COMMERCE,
  state: SENSOR_SOURCE_STATE.HANDOFF_ONLY,
  publicUrl: "https://www.ozon.ru/",
  capabilities: {
    manualHandoff: true
  }
});
