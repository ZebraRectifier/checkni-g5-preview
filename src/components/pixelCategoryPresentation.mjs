// Presentation only: retain the catalogue's category objects and navigation
// identities. Names select ordering/illustration, never products or prices.
const BRAND_NAME = /^(?:наши бренды|собственные(?: торговые)? марки|собственная(?: торговая)? марка|стм)(?:\s*\((?:стм|наши бренды|собственные торговые марки)\))?$/u;
const READY_FOOD_NAME = /^(?:вся готовая еда|готовая еда|готовые блюда|кулинария)(?=$|[\s,;:/()—–-])/u;
const READY_FOOD_OTHER = /ингредиент|рецепт|смеси для|посуда|животн|кошек|собак/u;
const FAMILIES = [
  ['dairy', /^(?:молоко|молочное|молочные продукты|молочная продукция|сыр|сыры|яйца)(?=$|[\s,;:/()—–-])/u],
  ['veg', /^(?:овощи|фрукты|ягоды|зелень)(?=$|[\s,;:/()—–-])/u],
  ['meat', /^(?:мясо|птица|рыба|морепродукты|мясные продукты|колбасы)(?=$|[\s,;:/()—–-])/u],
  ['bread', /^(?:хлеб|хлебцы|выпечка|хлебобулочные изделия)(?=$|[\s,;:/()—–-])/u],
  ['drinks', /^(?:напитки|вода|воды|соки|сок|чай|кофе)(?=$|[\s,;:/()—–-])/u],
  ['grocery', /^(?:бакалея|крупы|макароны|макаронные изделия|мука|сахар|соль)(?=$|[\s,;:/()—–-])/u]
];
const IMAGES = Object.freeze(Object.fromEntries(
  ['dairy', 'veg', 'meat', 'bread', 'drinks', 'grocery']
    .map(kind => [kind, new URL(`../img/cat-${kind}.png`, import.meta.url).href])
));

function validCategory(category) {
  return category !== null && typeof category === 'object' && !Array.isArray(category)
    && typeof category.name === 'string' && Boolean(category.name.trim());
}

function nameOf(category) {
  return validCategory(category)
    ? category.name.normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim()
    : '';
}

function kindOf(category) {
  const name = nameOf(category);
  if (BRAND_NAME.test(name)) return 'brands';
  if (READY_FOOD_NAME.test(name) && !READY_FOOD_OTHER.test(name)) return 'ready-food';
  return FAMILIES.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

function priority(category) {
  const kind = kindOf(category);
  if (kind === 'brands') return 0;
  if (kind === 'ready-food') return 1;
  const family = FAMILIES.findIndex(([name]) => name === kind);
  // Grocery and unknown categories retain their relative source ordering.
  return family >= 0 && family < 5 ? family + 2 : 7;
}

export function sortPixelCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories.filter(validCategory).map((category, index) => ({ category, index }))
    .sort((a, b) => priority(a.category) - priority(b.category) || a.index - b.index)
    .map(({ category }) => category);
}

export function pixelCategoryImage(category) {
  // Ready meals and own brands have no suitable existing illustration. A
  // grocery ingredient photo must not pretend to be a prepared-meal image.
  return IMAGES[kindOf(category)] ?? null;
}

export function pixelCollectionCategories(categories) {
  if (!Array.isArray(categories)) return [];
  const roots = categories.filter(category => validCategory(category) && category.depth === 0
    && (category.parentId === undefined || category.parentId === null));
  const collections = [];
  for (const [kind, title] of [['brands', 'Наши бренды'], ['ready-food', 'Вся готовая еда']]) {
    const category = roots.find(candidate => kindOf(candidate) === kind);
    if (category) collections.push({ title, category, kind });
  }
  return collections;
}
