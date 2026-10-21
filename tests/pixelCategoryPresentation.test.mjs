import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { sortPixelCategories, pixelCategoryImage, pixelCollectionCategories } from '../src/components/pixelCategoryPresentation.mjs';

const category = (name, categoryId, extra = {}) => Object.freeze({
  categoryId, name, parentId: null, rootId: categoryId, depth: 0,
  productCount: 12, sourceUrl: `https://example.test/category/${categoryId}`, ...extra
});

test('priority sorting preserves exact source identities, source metadata and stable peers', () => {
  const rows = Object.freeze([
    category('Для дома', 1), category('Напитки, вода и соки', 2),
    category('Мясо, птица и рыба', 3), category('Молоко, сыр и яйца', 4),
    category('СТМ', 5), category('Готовая еда и кулинария', 6),
    category('Овощи и фрукты', 7), category('Хлеб и выпечка', 8),
    category('Сыры', 9), category('Бакалея', 10), category('Зоотовары', 11)
  ]);
  const snapshot = structuredClone(rows);
  const sorted = sortPixelCategories(rows);
  assert.notEqual(sorted, rows);
  assert.deepEqual(sorted.map(row => row.categoryId), [5, 6, 4, 9, 7, 3, 8, 2, 1, 10, 11]);
  for (const row of sorted) assert.equal(row, rows.find(source => source.categoryId === row.categoryId));
  assert.deepEqual(rows, snapshot);
});

test('sorting filters malformed entries without inventing or deduplicating valid categories', () => {
  const source = category('Молочные продукты', 1);
  const rows = Object.freeze([null, undefined, 'Мясо', [], {}, { name: 3 }, { name: '  ' }, source, source]);
  assert.deepEqual(sortPixelCategories(rows), [source, source]);
  assert.equal(rows.length, 9);
  for (const input of [null, undefined, {}, 'Молоко']) assert.deepEqual(sortPixelCategories(input), []);
});

test('known category illustrations are bundled assets, while ready meals and brands stay unillustrated', async () => {
  for (const [name, file] of [
    ['Молоко, сыр и яйца', 'cat-dairy.png'], ['Фрукты, ягоды и овощи', 'cat-veg.png'],
    ['Рыба и морепродукты', 'cat-meat.png'], ['Хлеб, выпечка', 'cat-bread.png'],
    ['Чай, кофе', 'cat-drinks.png'], ['Крупы и макароны', 'cat-grocery.png']
  ]) {
    const row = category(name, 1, { imageUrl: 'https://untrusted.test/image.png' });
    const image = pixelCategoryImage(row);
    assert.equal(image, new URL(`../src/img/${file}`, import.meta.url).href, name);
    await access(new URL(image));
  }
  for (const name of ['Наши бренды', 'Готовая еда', 'Вся готовая еда', 'Кулинария', 'Для дома', 'Хлебопечки', 'Мясорубки']) {
    assert.equal(pixelCategoryImage(category(name, 1)), null, name);
  }
  for (const row of [null, undefined, {}, [], { name: 12 }]) assert.equal(pixelCategoryImage(row), null);
});

test('collections use only actual matching root objects, with a fixed presentation title and no product facts', () => {
  const ready = category('Вся готовая еда: супы и салаты', 1);
  const brands = category(' Собственные торговые марки (СТМ) ', 2);
  const duplicateBrand = category('Наши бренды', 3);
  const source = Object.freeze([category('Бакалея', 4), ready, brands, duplicateBrand]);
  const collections = pixelCollectionCategories(source);
  assert.equal(collections.length, 2);
  assert.deepEqual(collections.map(row => ({ title: row.title, kind: row.kind })), [
    { title: 'Наши бренды', kind: 'brands' }, { title: 'Вся готовая еда', kind: 'ready-food' }
  ]);
  assert.equal(collections[0].category, brands);
  assert.equal(collections[1].category, ready);
  for (const row of collections) assert.deepEqual(Object.keys(row).sort(), ['category', 'kind', 'title']);
  assert.deepEqual(source, [source[0], ready, brands, duplicateBrand]);
});

test('collection aliases are case/space tolerant without rewriting catalogue names', () => {
  for (const name of ['СТМ', 'Наши бренды', 'Собственные марки', 'Собственные торговые марки']) {
    const source = category(name.toLocaleUpperCase('ru-RU'), 1);
    assert.equal(pixelCollectionCategories([source])[0]?.category, source, name);
  }
  for (const name of ['Готовая еда', 'Вся готовая еда', 'Готовые блюда', 'Кулинария и выпечка']) {
    const source = category(`  ${name.replaceAll(' ', '  ')}  `, 2);
    assert.equal(pixelCollectionCategories([source])[0]?.category, source, name);
  }
});

test('ambiguous brands, recipe ingredients and non-root matches never become collections', () => {
  const names = ['Бренды', 'Винтажные бренды', 'Наша марка', 'Популярные марки',
    'Мука для готовых блюд', 'Ингредиенты для кулинарии', 'Рецепты: готовая еда',
    'Кулинария: рецепты и ингредиенты', 'Готовая еда для животных', 'КулинарияXYZ'];
  const source = Object.freeze([
    ...names.map((name, index) => category(name, index + 1)),
    category('Наши бренды', 30, { depth: 1, parentId: 4 }),
    category('Готовая еда', 31, { depth: 1, parentId: 4 }),
    category('Готовые блюда', 32, { parentId: 4 }),
    Object.freeze({ name: 'Кулинария', categoryId: 33 })
  ]);
  assert.deepEqual(pixelCollectionCategories(source), []);
  for (const input of [null, undefined, {}, 'СТМ', []]) assert.deepEqual(pixelCollectionCategories(input), []);
  const onlyReady = category('Готовые блюда', 34);
  assert.deepEqual(pixelCollectionCategories([onlyReady]), [{ title: 'Вся готовая еда', category: onlyReady, kind: 'ready-food' }]);
});
