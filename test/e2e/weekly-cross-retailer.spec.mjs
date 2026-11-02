import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {openHory,openBasket} from './helpers/pixel-surface.mjs';
const {rows}=JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-retail/cross-retailer-20261101.json',import.meta.url),'utf8'));
test('weekly alternatives keep delivery separate, require confirmation, persist, and expire',async({page,context})=>{
  // Controlled freshness only. Real network acceptance is recorded separately.
  const at='2026-11-02T08:00:00Z';await page.clock.setFixedTime(new Date(at));let ai=0,deliveryReads=0;
  await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
  await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
  await page.route('**/rest/v1/retail_catalog_items**',r=>{
    const q=new URL(r.request().url()).searchParams,store=q.get('store_id')?.replace('eq.','');
    const ids=q.get('source_product_id')?.slice(4,-1).split(',');
    const name=q.get('name')?.replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ');
    if(store==='perekrestok-yandex-3186917'&&ids)deliveryReads++;
    return r.fulfill({json:rows.filter(p=>p.store_id===store&&(!ids||ids.includes(p.source_product_id))&&(!name||p.name.toLowerCase().includes(name.toLowerCase())))
      .slice(0,Number(q.get('limit')??40)).map(p=>({...p,observed_at:at}))});
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  await page.locator('#pixel-store-search').fill('Балашиха Свердлова 26');
  await page.locator('#pixel-store-address-results [data-store-id="503695"]').click();
  await expect(page.locator('#pixel-storefront')).toBeVisible();
  await expect(page.locator('#magnit-store-address')).toHaveValue('503695');
  const say=async text=>{await openHory(page);await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
  await say('Собери недорогую корзину на неделю для троих в Магните и Перекрёстке');
  await expect(page.locator('#basket-proposal-status')).toContainText('Какие продукты исключить');await say('Ограничений нет');
  const variants=page.locator('.guided-shopping-stores');await expect(variants).toContainText('15/15 позиций');
  await expect(variants).toContainText('Доставка и сборы не включены');
  await expect(variants).toContainText('разница');
  expect(deliveryReads).toBe(2);
  await variants.getByRole('button',{name:'Показать Магнит',exact:true}).click();
  const buckwheat=page.locator('.guided-shopping-table tbody tr').filter({hasText:/греч/iu});
  await buckwheat.locator('summary').click();
  await buckwheat.locator('input[type="number"]').fill('9');
  await buckwheat.getByRole('button',{name:/Изменить количество/u}).click();
  await expect(buckwheat).toContainText('9 × 800');
  await say('а в Перекрёстке?');
  // Same requested 7.2 kg, not the original two packs or nine smaller packs.
  await expect(buckwheat).toContainText('18 × 400');
  await say('сравни с другим магазином');
  await expect(variants).toContainText('разница');
  await say('а в Магните?');
  await expect(buckwheat).toContainText('9 × 800');
  await say('а в Перекрёстке?');
  await expect(buckwheat).toContainText('18 × 400');
  await expect(page.locator('.guided-shopping-table')).toContainText('10 шт.');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  await say('Добавить показанное');await expect(page.locator('#basket-dock-copy')).toContainText('15 поз.');
  await page.clock.setFixedTime(new Date(Date.parse(at)+3600001));await say('Сравнить варианты');
  await expect(variants).toContainText('Сравнение свежих сумм пока недоступно');
  await expect(variants).not.toContainText('разница');
  await openBasket(page);const content=await page.locator('#basket-content').innerText();await page.reload();
  await expect(page.locator('#basket-content')).toHaveText(content,{useInnerText:true});
  expect(ai).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
