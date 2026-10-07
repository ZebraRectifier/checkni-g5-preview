export const METRO_MOSCOW_REGION_DIRECTORY_SOURCE = Object.freeze({
  sourceUrl: "https://rabota.metro-cc.ru/kontakty/list/shop/city_moskva-i-moskovskaya-oblast",
  sourceKind: "official-metro-career-store-directory",
  observedAt: "2026-10-07",
  total: 22,
  moscowCity: 12,
  moscowOblast: 10
});

const RAW_STORES = [
  ["10","125445, г. Москва, Ленинградское шоссе 71Г","moscow-city","metro-address-c5gsqz","proven","Ленинградское ш., 71Г"],
  ["11","129226, г. Москва, пр-кт Мира, д.211, корп.1","moscow-city","metro-address-fjag7i","proven","просп. Мира, 211, корп.1 («Европолис»)"],
  ["12","117545, г. Москва, ул.Дорожная, д.1, корп.1","moscow-city","metro-address-5e2aa4","proven","Дорожная ул., 1 корп. 1 (Варшавское ш.)"],
  ["13","121471, г.Москва, ул. Рябиновая, 59","moscow-city","metro-address-ce7cbs","proven","Рябиновая ул., 59 (просп. Генерала Дорохова)"],
  ["14","127204, г. Москва, ш. Дмитровское, д. 165Б","moscow-city","metro-address-19amict","proven","Дмитровское ш., 165Б (Долгопрудный)"],
  ["17","123458, г.Москва ул. Маршала Прошлякова д.14","moscow-city","metro-address-1dnzyn","proven","ул. Маршала Прошлякова, 14 (Строгино)"],
  ["18","105523, г.Москва, 104 км МКАД, строение 6","moscow-city","metro-address-1jk8v9u","proven","МКАД 104-й км, 6 (Щелковское ш.)"],
  ["19","109548, г. Москва, ул. Шоссейная, д.2Б","moscow-city","metro-address-bmth5s","proven","Шоссейная ул., 2Б (Печатники)"],
  ["48","140073, Московская область, Люберецкий район, пос. Томилино, 23 км. Новорязанского шоссе, д.17","moscow-oblast","metro-address-ojxph5","proven","Новорязанское ш., 23й км, 17 (Люберцы)"],
  ["49","108811, г. Москва, внутригородская территория муниципальный округ Ново-Переделкино, квартал 2, д.3, с.1","moscow-city",null,"not-exposed-in-public-pickup",null],
  ["61","141580, РОССИЯ Московская обл., Химки г.о.,Черная Грязь д, Торгово-Промышленная ул, зд. 5","moscow-oblast","metro-address-zgvtf8","proven","Ленинградское ш., 33-й км (д. Черная грязь)"],
  ["67","143987, Московская область, г. Балашиха, мкр. Железнодорожный, ул. Советская, д. 60.","moscow-oblast","metro-address-19g88v3","proven","Железнодорожный, Советская ул., 60"],
  ["73","Московская область, Городской округ Подольск, территория автодорога М-2 Крым, километр 42-й, дом 1, строение 1","moscow-oblast","metro-address-15zne35","proven","Симферопольское ш., 42-й км (Подольск)"],
  ["1307","142434, Московская Область, Богородский городской округ, деревня Новые Псарьки, ул Парковая, дом 4","moscow-oblast",null,"not-exposed-in-public-pickup",null],
  ["1308","127018, г. Москва, ул. Складочная, д. 1, строение 1","moscow-city","metro-address-1dqr3xq","proven","Складочная ул., 1, стр.1 («Станколит»)"],
  ["1317","142204, Московская область, г. Серпухов, городской округ Серпухов, бульвар 65 лет Победы, д.4","moscow-oblast","metro-address-17mcpb2","proven","Серпухов, бул. 65 лет Победы, 4"],
  ["1318","141733,Московская обл., городской округ Лобня, Лобня г., промзона Горки Киовские ул., 15,1,Б,1,1-98,137-157","moscow-oblast","metro-address-da224d","proven","Лобня, ул. Горки Киовские (Рогачевское ш.)"],
  ["1356","115088 г. Москва, улица 1-ая Дубровская, 13А, 1","moscow-city","metro-address-qrnm0l","proven","1-я Дубровская ул., 13А, стр.1 (Дубровка)"],
  ["1444","140054, Московская область, г. Котельники, городской округ Котельники, Новорязанское ш., 5.","moscow-oblast","metro-address-x8scuv","proven","Новорязанское ш., 5 (Котельники)"],
  ["1322","142715, Московская обл., Ленинский г.о., пос. совхоза им. Ленина, влд. 8","moscow-oblast","metro-address-cz1cg2","proven","Каширское ш. (пос. Совхоза им. Ленина)"],
  ["1363","119634, Москва, Боровское шоссе, 10А","moscow-city","metro-address-1qjp6lh","proven","Боровское ш., 10А (Солнцево)"],
  ["77","143020, Московская область, городской округ Одинцовский, Ликино д., Минское шоссе 35 км, тер. 2","moscow-oblast","metro-address-pjvl9r","proven","Минское ш., 35-й км (д. Ликино)"]
];

function clean(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized || null;
}

export function normalizeMetroStoreAddress(value) {
  const normalized = clean(value);
  if (!normalized) return null;
  return normalized
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/^\d{6},\s*/u, "")
    .replace(/^россия\s+/u, "")
    .replace(/^г\.?\s*москва,?\s*/u, "")
    .replace(/^москва,?\s*/u, "")
    .replace(
      /(^|[^\p{L}\p{N}])обл\.?(?=$|[^\p{L}\p{N}])/gu,
      "$1область"
    )
    .replace(
      /(^|[^\p{L}\p{N}])пр-кт(?=$|[^\p{L}\p{N}])/gu,
      "$1проспект"
    )
    .replace(
      /(^|[^\p{L}\p{N}])просп\.?(?=$|[^\p{L}\p{N}])/gu,
      "$1проспект"
    )
    .replace(
      /(^|[^\p{L}\p{N}])ул\.?(?=$|[^\p{L}\p{N}])/gu,
      "$1улица"
    )
    .replace(
      /(^|[^\p{L}\p{N}])ш\.?(?=$|[^\p{L}\p{N}])/gu,
      "$1шоссе"
    )
    .replace(
      /(^|[^\p{L}\p{N}])д\.?\s*(?:№\s*)?(?=\d)/gu,
      "$1"
    )
    .replace(
      /(^|[^\p{L}\p{N}])дом\s+(?:№\s*)?(?=\d)/gu,
      "$1"
    )
    .replace(
      /(^|[^\p{L}\p{N}])корп\.?(?=$|[^\p{L}\p{N}]|\d)/gu,
      "$1корпус"
    )
    .replace(
      /(^|[^\p{L}\p{N}])стр\.?(?=$|[^\p{L}\p{N}]|\d)/gu,
      "$1строение"
    )
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export const METRO_MOSCOW_REGION_STORES = Object.freeze(RAW_STORES.map(
  ([storeNumber,address,scope,bindingId,onlinePickupStatus,onlinePickupLabel]) => Object.freeze({
    storeNumber,
    address,
    scope,
    bindingId,
    storeId: bindingId,
    onlinePickupStatus,
    onlinePickupLabel,
    sourceUrl: METRO_MOSCOW_REGION_DIRECTORY_SOURCE.sourceUrl
  })
));

export const DEFAULT_METRO_MOSCOW_STORE = METRO_MOSCOW_REGION_STORES[0];

export function resolveMetroMoscowRegionStore(value) {
  if (!value) return null;
  const storeNumber = typeof value === "string" ? value : value.storeNumber;
  const storeId = typeof value === "object" ? value.storeId : null;
  const address = typeof value === "object" ? value.address : null;
  const addressKey = address ? normalizeMetroStoreAddress(address) : null;
  const matches = METRO_MOSCOW_REGION_STORES.filter((store) => (
    (storeNumber ? store.storeNumber === String(storeNumber) : true)
    && (storeId ? store.storeId === storeId : true)
    && (addressKey ? normalizeMetroStoreAddress(store.address) === addressKey : true)
  ));
  return matches.length === 1 ? matches[0] : null;
}
