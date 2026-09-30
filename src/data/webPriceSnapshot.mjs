import { EXTENDED_CATALOG } from "./extendedCatalog.mjs";
import { COLLECTED_WEB_SNAPSHOT_OFFERS } from "./webPriceSnapshotCollected.mjs";

// Web price snapshot: prices read from retailers' public websites.
//
// Truth level (owner decision, 2026-09-28):
// - These are prices shown on the retailer website for its DEFAULT delivery
//   address. The website did not confirm Moscow (or any exact store).
// - Region is NOT confirmed, availability is UNKNOWN, prices are a dated
//   snapshot and are never fed into the live OBSERVED Core truth path.
// - For every canonical product the cheapest comparable item visible in the
//   retailer's search results was chosen and its price is recalculated to the
//   canonical pack size. Liquids sold by weight are treated as 1 g ≈ 1 ml.

export const WEB_SNAPSHOT_META = Object.freeze({
  id: "web-snapshot-2026-09-28",
  observedDate: "2026-09-28",
  observedDateLabel: "28 сентября 2026",
  intendedCity: "Москва",
  regionConfirmed: false,
  availability: "unknown",
  currency: "RUB"
});

export const WEB_SNAPSHOT_RETAILERS = Object.freeze([
  Object.freeze({
    id: "perekrestok",
    name: "Перекрёсток",
    nameIn: "в Перекрёстке",
    siteUrl: "https://www.perekrestok.ru/"
  }),
  Object.freeze({
    id: "vkusvill",
    name: "ВкусВилл",
    nameIn: "во ВкусВилле",
    siteUrl: "https://vkusvill.ru/"
  }),
  Object.freeze({
    id: "chizhik",
    name: "Чижик",
    nameIn: "в Чижике",
    siteUrl: "https://chizhik.club/"
  })
]);

// Canonical pack sizes in base units: ml, g or pcs.
export const WEB_SNAPSHOT_CANONICAL_SIZES = Object.freeze({
  "milk-25-900": Object.freeze({ size: 900, unit: "ml" }),
  "eggs-c1-10": Object.freeze({ size: 10, unit: "pcs" }),
  "chicken-fillet-600": Object.freeze({ size: 600, unit: "g" }),
  "cheese-semi-hard-200": Object.freeze({ size: 200, unit: "g" }),
  "bread-wheat-400": Object.freeze({ size: 400, unit: "g" }),
  "apples-1kg": Object.freeze({ size: 1000, unit: "g" }),
  "buckwheat-800": Object.freeze({ size: 800, unit: "g" }),
  "bananas-1kg": Object.freeze({ size: 1000, unit: "g" }),
  "kefir-1l": Object.freeze({ size: 1000, unit: "ml" }),
  "tomatoes-600": Object.freeze({ size: 600, unit: "g" }),
  "pasta-450": Object.freeze({ size: 450, unit: "g" }),
  "water-15": Object.freeze({ size: 1500, unit: "ml" }),
  ...Object.fromEntries(EXTENDED_CATALOG.map((product) => [
    product.id,
    Object.freeze({ size: product.size, unit: product.sizeUnit })
  ]))
});

function perekrestokSearch(query) {
  return `https://www.perekrestok.ru/cat/search?search=${encodeURIComponent(query)}`;
}

function vkusvillSearch(query) {
  return `https://vkusvill.ru/search/?q=${encodeURIComponent(query)}`;
}

function offer(retailerId, canonicalProductId, itemName, packSize, unit, priceMinor, sourceUrl) {
  return Object.freeze({
    retailerId,
    canonicalProductId,
    itemName,
    packSize,
    unit,
    priceMinor,
    sourceUrl
  });
}

const MANUAL_WEB_SNAPSHOT_OFFERS = Object.freeze([
  // Перекрёсток
  offer("perekrestok", "milk-25-900", "Молоко Навлинское пастеризованное 2,5%, 900 мл", 900, "ml", 4599, perekrestokSearch("молоко 2,5%")),
  offer("perekrestok", "eggs-c1-10", "Яйцо куриное С1 Пр!ст, 10 шт", 10, "pcs", 7699, perekrestokSearch("яйца")),
  offer("perekrestok", "chicken-fillet-600", "Филе грудки куриное Троекурово охлаждённое, 900 г", 900, "g", 45999, perekrestokSearch("грудка")),
  offer("perekrestok", "cheese-semi-hard-200", "Сыр полутвёрдый Брест-Литовск Российский 50%, 200 г", 200, "g", 17999, perekrestokSearch("сыр")),
  offer("perekrestok", "bread-wheat-400", "Батон Новый Пр!ст, 380 г", 380, "g", 2199, perekrestokSearch("хлеб")),
  offer("perekrestok", "apples-1kg", "Яблоки Выгодно микс, 1 кг", 1000, "g", 5390, perekrestokSearch("яблоки")),
  offer("perekrestok", "buckwheat-800", "Гречка ядрица, 900 г", 900, "g", 6199, perekrestokSearch("крупа")),
  offer("perekrestok", "bananas-1kg", "Бананы фасованные, за 1 кг", 1000, "g", 13999, perekrestokSearch("бананы")),
  offer("perekrestok", "kefir-1l", "Кефир Княгинино 2,5%, 930 г", 930, "ml", 8999, perekrestokSearch("кефир")),
  offer("perekrestok", "tomatoes-600", "Томаты красные круглые, за 1 кг", 1000, "g", 17899, perekrestokSearch("томаты")),
  offer("perekrestok", "pasta-450", "Макароны Рожки группы А Маркет, 400 г", 400, "g", 4999, perekrestokSearch("макароны")),
  offer("perekrestok", "water-15", "Вода питьевая Сенежская негазированная, 1,5 л", 1500, "ml", 6199, perekrestokSearch("питьевая")),

  // ВкусВилл
  offer("vkusvill", "milk-25-900", "Молоко 2,5% в бутылке, 900 мл", 900, "ml", 10000, vkusvillSearch("молоко 2,5")),
  offer("vkusvill", "eggs-c1-10", "Яйцо куриное С1, 10 шт", 10, "pcs", 11500, vkusvillSearch("яйца")),
  offer("vkusvill", "chicken-fillet-600", "Филе грудки цыплёнка-бройлера, за 1 кг", 1000, "g", 64500, vkusvillSearch("филе куриное")),
  offer("vkusvill", "cheese-semi-hard-200", "Сыр «Российский», 200 г", 200, "g", 23700, vkusvillSearch("сыр")),
  offer("vkusvill", "bread-wheat-400", "Батон «Молодёжная классика», нарезка, 350 г", 350, "g", 6000, vkusvillSearch("хлеб")),
  offer("vkusvill", "apples-1kg", "Яблоко садовое, за 1 кг", 1000, "g", 11500, vkusvillSearch("яблоки")),
  offer("vkusvill", "buckwheat-800", "Крупа гречневая ядрица, 900 г", 900, "g", 8500, vkusvillSearch("гречка")),
  offer("vkusvill", "bananas-1kg", "Бананы, за 1 кг", 1000, "g", 16800, vkusvillSearch("бананы")),
  offer("vkusvill", "kefir-1l", "Кефир 2,5% в бутылке, 900 г", 900, "ml", 11200, vkusvillSearch("кефир")),
  offer("vkusvill", "tomatoes-600", "Томаты красные, за 1 кг", 1000, "g", 23000, vkusvillSearch("томаты")),
  offer("vkusvill", "pasta-450", "Макароны перо рифлёное, 450 г", 450, "g", 9000, vkusvillSearch("макароны")),
  offer("vkusvill", "water-15", "Вода питьевая Сенежская негазированная, 1,5 л", 1500, "ml", 5300, vkusvillSearch("вода питьевая"))
]);

export const WEB_SNAPSHOT_OFFERS = Object.freeze([
  ...MANUAL_WEB_SNAPSHOT_OFFERS,
  ...COLLECTED_WEB_SNAPSHOT_OFFERS
]);
