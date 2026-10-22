import { test, expect } from '@playwright/test';
import { selectStore, openStoreDetails } from './helpers/pixel-surface.mjs';
import { MAGNIT_LEGACY_ADDRESS_ALIASES as aliases } from '../../src/data/magnitLegacyAddressAliases.mjs';

for (const alias of aliases) test(`legacy address ${alias.shopCode} requires explicit canonical selection and preserves the basket`, async ({page}) => {
  let aiCalls = 0;
  await page.route('**/functions/v1/ai-basket-proposal', route => { aiCalls++; return route.abort(); });
  await page.route('**/functions/v1/catalog-search', route => route.fulfill({json:{kind:'catalog',products:[],partial:false}}));
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({json:[]}));
  await page.route('https://images-foodtech.magnit.ru/**', route => route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')}));
  const seen = [];
  await page.route('**/rest/v1/retail_catalog_items**', route => {
    const code = new URL(route.request().url()).searchParams.get('store_id'); seen.push(code);
    const url = `https://magnit.ru/product/1899800733-moloko_prostokvashino_pasterizovannoe_2_5_930ml?shopCode=${alias.shopCode}&shopType=1`;
    return route.fulfill({json:code === 'eq.magnit-'+alias.shopCode ? [{
      retailer_id:'magnit',store_id:'magnit-'+alias.shopCode,store_name:'Магнит · '+alias.canonicalAddress,
      locality_id:'region-moscow-oblast',locality_name:'Московская область',
      source_product_id:'1899800733',name:'Молоко Простоквашино пастеризованное 2.5% 930мл',price_minor:9499,
      currency:'RUB',price_condition:'public-online',availability:'unknown',main_category_id:63963,
      product_url:url,source_url:url,image_url:'https://images-foodtech.magnit.ru/test-product.png',
      weight_text:'930мл',observed_at:new Date().toISOString(),location_label:alias.canonicalAddress,
      scope_binding:'public-store-product-page',binding_id:'magnit-shopcode-'+alias.shopCode,scope_evidence_url:url
    }] : []});
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await selectStore(page,'magnit'); await openStoreDetails(page);
  const picker = page.locator('#magnit-store-address'); const before = await picker.inputValue();
  const search = page.locator('#magnit-store-picker').getByRole('searchbox',{name:'Найти адрес Магнита',exact:true});
  await search.fill(alias.legacyAddress);
  await expect(picker).toHaveValue('');
  await expect(picker.locator('option:not(:disabled)')).toHaveCount(1);
  await expect(picker.locator(`option[value="${alias.shopCode}"]`)).toHaveText(alias.canonicalAddress);
  expect(seen).not.toContain('eq.magnit-'+alias.shopCode);
  await picker.selectOption(alias.shopCode);
  const card = page.locator(`#product-grid [data-product-id="retail:magnit:magnit-${alias.shopCode}:1899800733"]`);
  await expect(card).toContainText('94,99');
  expect(seen).toContain('eq.magnit-'+alias.shopCode);
  await search.fill('Несуществующий адрес 987654321');
  await expect(picker).toHaveValue('');
  await expect(picker.locator('option:not(:disabled)')).toHaveCount(0);
  await expect(card).toBeVisible();
  await search.fill(''); await expect(picker).toHaveValue(alias.shopCode);
  await page.locator('#pixel-store-details > summary').click();
  await card.getByRole('button',{name:/^Добавить /u}).click();
  await page.locator('[data-pixel-action="basket"]').click();
  const basket = page.locator('#basket-view');
  await expect(basket).toBeVisible(); await expect(basket).toContainText(alias.canonicalAddress);
  await expect(basket.getByRole('button',{name:/^Удалить /u})).toHaveCount(1);
  await page.reload(); await expect(basket).toBeVisible();
  await expect(basket.getByRole('button',{name:/^Удалить /u})).toHaveCount(1);
  expect(aiCalls).toBe(0); expect(before).not.toBe(alias.shopCode);
});
