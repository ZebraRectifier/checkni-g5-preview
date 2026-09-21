const manualBasket = [
  { product: { id: 'apples-1kg', name: 'Яблоки', unit: '1 кг' }, quantity: 0.75 },
  { product: { id: 'eggs-c1-10', name: 'Яйца C1', unit: '10 шт' }, quantity: 1 },
  { product: { id: 'milk-25-900', name: 'Молоко 2,5%', unit: '900 мл' }, quantity: 2 },
];

const mockStores = [
  {
    id: 'mock-alpha',
    name: 'Mock Alpha',
    isMock: true,
    offers: [
      { productId: 'apples-1kg', status: 'available', unitPriceMinor: 14990 },
      { productId: 'eggs-c1-10', status: 'available', unitPriceMinor: 12990 },
      { productId: 'milk-25-900', status: 'available', unitPriceMinor: 9990 },
    ],
  },
  {
    id: 'mock-beta',
    name: 'Mock Beta',
    isMock: true,
    offers: [
      { productId: 'apples-1kg', status: 'available', unitPriceMinor: 13990 },
      { productId: 'eggs-c1-10', status: 'available', unitPriceMinor: 11990 },
      { productId: 'milk-25-900', status: 'available', unitPriceMinor: 10990 },
    ],
  },
  {
    id: 'mock-gamma',
    name: 'Mock Gamma',
    isMock: true,
    offers: [
      { productId: 'apples-1kg', status: 'unknown' },
      { productId: 'eggs-c1-10', status: 'unavailable' },
      { productId: 'milk-25-900', status: 'available', unitPriceMinor: 8990 },
    ],
  },
];

export { manualBasket, mockStores };
