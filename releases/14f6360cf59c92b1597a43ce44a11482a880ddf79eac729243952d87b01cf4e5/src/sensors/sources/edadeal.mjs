import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sourceDescriptor.mjs";

export const edadealSource = defineSensorSource({
  id: "edadeal",
  name: "Едадил",
  role: SENSOR_SOURCE_ROLE.PROMO_AGGREGATOR,
  state: SENSOR_SOURCE_STATE.RESEARCH,
  publicUrl: "https://edadeal.ru/",
  capabilities: {
    manualHandoff: true,
    publicPageResearch: true
  },
  notes: "Promotion evidence must stay separate from ordinary shelf/online price truth."
});
