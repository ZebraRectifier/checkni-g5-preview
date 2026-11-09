export const MOCK_CATALOG = Object.freeze([
  { id: "milk-25-900", name: "Молоко 2,5%", unit: "900 мл", category: "Молочные продукты" },
  { id: "eggs-c1-10", name: "Яйца C1", unit: "10 шт", category: "Яйца" },
  { id: "chicken-fillet-600", name: "Филе куриное", unit: "600 г", category: "Мясо и птица" },
  { id: "cheese-semi-hard-200", name: "Сыр полутвёрдый", unit: "200 г", category: "Сыры" },
  { id: "bread-wheat-400", name: "Хлеб пшеничный", unit: "400 г", category: "Хлеб" },
  { id: "apples-1kg", name: "Яблоки", unit: "1 кг", category: "Фрукты" },
  { id: "buckwheat-800", name: "Гречка", unit: "800 г", category: "Крупы" },
  { id: "bananas-1kg", name: "Бананы", unit: "1 кг", category: "Фрукты" },
  { id: "kefir-1l", name: "Кефир 2,5%", unit: "1 л", category: "Молочные продукты" },
  { id: "tomatoes-600", name: "Томаты", unit: "600 г", category: "Овощи" },
  { id: "pasta-450", name: "Макароны", unit: "450 г", category: "Бакалея" },
  { id: "water-15", name: "Вода питьевая", unit: "1,5 л", category: "Напитки" }
]);

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru-RU");
}

export function searchMockCatalog(query, catalog = MOCK_CATALOG) {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return [...catalog];
  }

  return catalog.filter((product) => {
    const haystack = normalize(`${product.name} ${product.unit} ${product.category}`);
    return haystack.includes(normalizedQuery);
  });
}
