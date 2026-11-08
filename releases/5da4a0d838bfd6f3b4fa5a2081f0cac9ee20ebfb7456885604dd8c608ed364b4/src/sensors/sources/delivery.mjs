import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sourceDescriptor.mjs";

export const deliverySource = defineSensorSource({
  id: "delivery",
  name: "Деливери",
  role: SENSOR_SOURCE_ROLE.AGGREGATOR,
  state: SENSOR_SOURCE_STATE.RESEARCH,
  publicUrl: "https://market-delivery.yandex.ru/",
  capabilities: {
    manualHandoff: true,
    publicPageResearch: true
  },
  notes: "Official consumer service; automated observation remains disabled until evidence/terms review passes."
});
