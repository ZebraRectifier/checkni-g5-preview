import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sourceDescriptor.mjs";

export const vprokSource = defineSensorSource({
  id: "vprok",
  name: "Vprok.ru",
  role: SENSOR_SOURCE_ROLE.RETAILER_COMMERCE,
  state: SENSOR_SOURCE_STATE.HANDOFF_ONLY,
  publicUrl: "https://www.vprok.ru/",
  capabilities: {
    manualHandoff: true
  },
  notes: "Do not automate content reuse without a separate rights basis."
});
