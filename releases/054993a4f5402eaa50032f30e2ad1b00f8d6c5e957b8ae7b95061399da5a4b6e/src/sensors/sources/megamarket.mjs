import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sourceDescriptor.mjs";

export const megamarketSource = defineSensorSource({
  id: "megamarket",
  name: "Мегамаркет",
  role: SENSOR_SOURCE_ROLE.AGGREGATOR,
  state: SENSOR_SOURCE_STATE.RESEARCH,
  publicUrl: "https://megamarket.ru/",
  capabilities: {
    manualHandoff: true,
    publicPageResearch: true
  },
  notes: "Supermarket surface is a candidate; automated price observation remains disabled."
});
