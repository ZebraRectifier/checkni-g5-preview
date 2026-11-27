import { defineSensorSource, SENSOR_SOURCE_ROLE, SENSOR_SOURCE_STATE } from "../sourceDescriptor.mjs";

export const yandexEdaSource = defineSensorSource({
  id: "yandex-eda",
  name: "Яндекс Еда",
  role: SENSOR_SOURCE_ROLE.AGGREGATOR,
  state: SENSOR_SOURCE_STATE.RESEARCH,
  publicUrl: "https://eda.yandex.ru/",
  capabilities: {
    manualHandoff: true,
    publicPageResearch: true
  },
  notes: "No automated production observation until a separate evidence gate passes."
});
