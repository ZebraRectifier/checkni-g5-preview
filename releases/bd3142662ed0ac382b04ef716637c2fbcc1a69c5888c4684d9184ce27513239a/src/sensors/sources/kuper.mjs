import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sourceDescriptor.mjs";

export const kuperSource = defineSensorSource({
  id: "kuper",
  name: "Купер",
  role: SENSOR_SOURCE_ROLE.AGGREGATOR,
  state: SENSOR_SOURCE_STATE.RESEARCH,
  publicUrl: "https://kuper.ru/",
  capabilities: {
    manualHandoff: true,
    publicPageResearch: true
  },
  notes: "Public catalogues are research evidence only until reuse/automation rights are separately cleared."
});
