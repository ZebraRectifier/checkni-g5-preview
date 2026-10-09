// Exact public store-selector binding; price evidence is separate.
export const MAGNIT_MOSCOW_OBLAST_BINDINGS = Object.freeze([
  Object.freeze({
    shopCode: "509911",
    address: "141250, Московская обл, Пушкинский р-н, Софрино-1 нп, дом № 21, корпус А, кв.1",
    sourceUrl: "https://magnit.ru/shops?shopCode=509911&shopType=1",
    observedAt: "2026-10-09T06:20:01.864Z"
  })
]);
export function resolveMagnitMoscowOblastStore({shopCode,address}={}) {
  if(typeof shopCode!=="string") return null;
  const store=MAGNIT_MOSCOW_OBLAST_BINDINGS.find(s=>s.shopCode===shopCode);
  if(!store || (address!==undefined && address!==store.address)) return null;
  return store;
}
