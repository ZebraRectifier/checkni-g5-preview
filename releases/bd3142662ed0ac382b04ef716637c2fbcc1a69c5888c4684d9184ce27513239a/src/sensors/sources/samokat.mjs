import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sourceDescriptor.mjs";

export const samokatSource = defineSensorSource({
  id: "samokat",
  name: "Самокат",
  role: SENSOR_SOURCE_ROLE.RETAILER_COMMERCE,
  state: SENSOR_SOURCE_STATE.HANDOFF_ONLY,
  publicUrl: "https://samokat.ru/",
  capabilities: {
    manualHandoff: true
  }
});
