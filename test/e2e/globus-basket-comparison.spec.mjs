import { test, expect } from '@playwright/test';
import { resolveGlobusMoscowRegionStore } from '../../src/data/globusMoscowRegionStores.mjs';

// Synthetic transport observations prove the browser/Core boundary only.
// Live retailer evidence is collected and verified separately.
const products = [
  ['000000000000027692_ST', 'Кефир Простоквашино 3,2%, 930г', 'kefir-prostokvashino-32-930g-27692_ST', 'molochnye-produkty-syr-yajcza-10118965'],
  ['000000000000712952_ST', 'Напиток Добрый Cola, 1л', 'napitok-dobryj-cola-1l-712952_ST', 'bezalkogolnye-napitki-10112699?page=2'],
  ['000000000000754268_ST', 'Рис круглозерный Увелка, 800г', 'ris-kruglozernyj-uvelka-800g-754268_ST', 'bakaleya-10112696?page=2']
];
async function routes(page, state) {
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/retail_catalog_items**', route => {
    const query = new URL(route.request().url()).searchParams;
    const id = query.get('store_id')?.replace('eq.globus-store-', '');
    const store = resolveGlobusMoscowRegionStore(id);
    let rows = query.get('retailer_id') === 'eq.globus' && store ? products.map(([sku, name, slug, category]) => {
      const source = 'https://www.globus.ru/catalog/' + category;
      return { retailer_id: 'globus', store_id: 'globus-store-' + id, store_name: store.name,
        locality_id: 'city-moscow', locality_name: 'Москва', source_product_id: sku, name,
        price_minor: id === '5020' ? 9000 : 10000, currency: 'RUB', price_condition: 'regular',
        sales_channel: 'store', minimum_quantity: 1, availability: 'unknown',
        product_url: 'https://www.globus.ru/products/' + slug + '/', image_url: null, weight_text: null,
        main_category_id: Number(category.match(/-(\d+)/u)[1]), source_url: source,
        scope_evidence_url: source, scope_binding: 'same-source', binding_id: store.bindingId,
        location_label: store.address,
        quantity_semantics: { packageType: 'piece', basketStep: 1, basketMinVolume: 1, unitPriceText: '1 шт' },
        observed_at: new Date(Date.now() - (state.stale ? 7200000 : 1000)).toISOString() };
    }) : [];
    const sourceIdsFilter = query.get('source_product_id');
    if (sourceIdsFilter?.startsWith('in.')) {
      rows = rows.filter(row => sourceIdsFilter.includes(row.source_product_id));
    }
    const nameFilter = query.get('name');
    if (nameFilter?.startsWith('ilike.')) {
      const pattern = nameFilter.slice(6).split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*');
      rows = rows.filter(row => new RegExp('^' + pattern + '$', 'iu').test(row.name));
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.route('**/src/ports/observedOffersPort.mjs', route => route.fulfill({ status: 200,
    contentType: 'text/javascript', body: 'export const observedOffersPort = { async load() { return []; } };' }));
}

test('manual exact GLOBUS basket compares two explicit physical addresses and keeps choices on reload', async ({ page }) => {
  const state = { stale: false }; await routes(page, state);
  await page.goto('/?comparison=observed&catalog=retail#shop');
  const peer = page.getByRole('combobox', { name: 'Второй адрес Глобус для сравнения корзины', exact: true });
  await expect(peer).toHaveValue('');
  await peer.selectOption('5020');
  const searches = ['Кефир Простоквашино', 'Добрый Cola', 'рис Увелка'];
  for (const [index, [sku]] of products.entries()) {
    await page.locator('#product-search').fill(searches[index]);
    await page.locator('#product-search').press('Enter');
    const card = page.locator(`[data-product-id="retail:globus:globus-store-5011:${sku}"]`);
    await expect(card.getByRole('button')).toBeEnabled(); await card.getByRole('button').click();
  }
  await page.reload(); await expect(peer).toHaveValue('5020');
  await page.locator('#open-basket').click();
  await expect(page.locator('.basket-summary')).toContainText('3 шт. · 3 позиции');
  const addresses = page.getByRole('region', { name: 'Адреса для сравнения', exact: true });
  await expect(addresses.locator('li')).toHaveCount(2);
  await expect(addresses).not.toContainText('Магнит');
  await expect(addresses).not.toContainText('METRO');
  await expect(addresses).toContainText('Широкая, 2а');
  await expect(addresses).toContainText('Новорижское шоссе');
  await page.locator('#compare-basket').click();
  const result = page.getByLabel('Результат по наблюдаемым ценам');
  await expect(result).toContainText('Глобус Медведково');
  await expect(result).toContainText('270,00 ₽'); await expect(result).toContainText('30,00 ₽');
  await expect(result).toContainText('Покупка в магазине');
  await expect(result).toContainText('Наличие не подтверждено');
  await expect(result.getByRole('link')).toHaveAttribute('target', '_blank');
  await addresses.getByRole('button', { name: 'Изменить адрес Глобус Медведково', exact: true }).click();
  await expect(peer).toHaveValue('5020'); await peer.selectOption('');
  await page.locator('#open-basket').click();
  await expect(page.locator('#comparison-output')).not.toContainText('270,00 ₽');
  await expect(addresses.locator('li')).toHaveCount(3);
  await page.goBack(); await expect(peer).toHaveValue('');
  await peer.selectOption('5020');
  state.stale = true;
  await page.locator('#open-basket').click(); await page.locator('#compare-basket').click();
  await expect(result).toContainText('Недостаточно данных для «дешевле»');
  await expect(result).not.toContainText('Экономия');
});

test('changing the primary GLOBUS address clears a duplicate peer and forbids a regional peer', async ({ page }) => {
  await routes(page, { stale: false }); await page.goto('/?comparison=observed&catalog=retail#shop');
  const peer = page.locator('#globus-compare-address'); await peer.selectOption('5020');
  await page.locator('#globus-store-address').selectOption('5020');
  await expect(peer).toHaveValue(''); await expect(peer.locator('option[value="5020"]')).toHaveCount(0);
  await page.locator('#globus-store-address').selectOption('5018');
  await expect(peer).toBeDisabled(); await expect(peer).toHaveValue('');
  await page.locator('#globus-store-address').selectOption('5001');
  await expect(peer).toBeDisabled(); await expect(peer).toHaveValue('');
  await page.reload(); await expect(page.locator('#globus-store-address')).toHaveValue('5001');
  await expect(peer).toBeDisabled();
});

test('map address choice invalidates a winner and restores exact scope on Back and reload', async ({ page }) => {
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());
  await routes(page, { stale: false });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await page.locator('#globus-compare-address').selectOption('5020');
  await page.locator('#product-search').fill('рис Увелка');
  await page.locator('#product-search').press('Enter');
  await page.locator('[data-product-id="retail:globus:globus-store-5011:000000000000754268_ST"]')
    .getByRole('button').click();
  await page.locator('#open-basket').click();
  await page.locator('#compare-basket').click();
  await expect(page.getByLabel('Результат по наблюдаемым ценам')).toContainText('90,00 ₽');
  await page.locator('#back-to-shop').click();
  const known = page.locator('.stores-location-directory');
  await known.locator('summary').click();
  await page.locator('#stores-known-locations [data-store-location-id="globus-store-5018"]')
    .getByRole('button', { name: 'Выбрать для корзины', exact: true }).click();
  await expect(page.locator('#globus-store-address')).toHaveValue('5018');
  await expect(page.locator('#globus-compare-address')).toHaveValue('');
  const mapScope = page.locator('#stores-selected-addresses');
  await expect(mapScope.locator('li')).toHaveCount(3);
  await expect(mapScope).toContainText('Саларьево');
  await expect(mapScope).not.toContainText('Медведково');
  await page.locator('#open-basket').click();
  await expect(page.locator('#comparison-output')).not.toContainText('90,00 ₽');
  await expect(page.locator('.basket-summary')).toContainText('1 шт.');
  await page.goBack();
  await expect(page.locator('#globus-store-address')).toHaveValue('5018');
  await page.goBack();
  await expect(page.locator('#globus-store-address')).toHaveValue('5011');
  await expect(page.locator('#globus-compare-address')).toHaveValue('5020');
  await expect(mapScope.locator('li')).toHaveCount(2);
  await page.reload();
  await expect(mapScope).toContainText('Медведково');
  await expect(mapScope).not.toContainText('Саларьево');
  await expect(page.locator('#globus-compare-address')).toHaveValue('5020');
});
