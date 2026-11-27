import {
  defineSensorSource,
  SENSOR_SOURCE_ROLE,
  SENSOR_SOURCE_STATE
} from "../sourceDescriptor.mjs";

export const yandexMapsEdadealExactStoreSource = defineSensorSource({
  id: "yandex-maps-edadeal-exact-store",
  name: "Яндекс Карты / Едадил — исследование org-specific цен",
  role: SENSOR_SOURCE_ROLE.PROMO_AGGREGATOR,
  state: SENSOR_SOURCE_STATE.RESEARCH,
  publicUrl: "https://yandex.ru/maps/",
  capabilities: {
    manualHandoff: true,
    publicPageResearch: true,
    exactStoreContext: false
  },
  notes:
    "UNPROVEN. Prior assistant-supplied /prices/ rows were retracted as fabricated. Org-specific rows may be staged for audit, but cannot become comparison truth until CHECKNI independently proves the rendered public page binds visible prices to that exact organization/store."
});
