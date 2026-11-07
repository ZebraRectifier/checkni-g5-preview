import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openHory } from './helpers/pixel-surface.mjs';

const { rows } = JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-retail/cross-retailer-20261101.json', import.meta.url), 'utf8'));

test('guided variants show products early and retain scope, warnings and keyboard choices', async ({ page, context }, testInfo) => {
  const at = '2026-11-02T08:00:00Z';
  await page.clock.setFixedTime(new Date(at));
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/rest/v1/retail_catalog_categories**', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/**retail_catalog_items**', route => {
    const q = new URL(route.request().url()).searchParams;
    const store = q.get('store_id')?.replace('eq.', '');
    const ids = q.get('source_product_id')?.slice(4, -1).split(',');
    const name = (q.get('name') ?? (q.has('p_query') ? 'ilike.*' + q.get('p_query').replaceAll(' ', '*') + '*' : null))
      ?.replace(/^ilike\.\*|\*$/gu, '').replaceAll('*', ' ');
    return route.fulfill({ json: rows.filter(row => row.store_id === store && (!ids || ids.includes(row.source_product_id))
      && (!name || row.name.toLowerCase().includes(name.toLowerCase()))).slice(0, Number(q.get('limit') ?? 40))
      .map(row => ({ ...row, observed_at: at })) });
  });
  await page.goto('/?comparison=observed&catalog=retail#shop');
  if (await page.locator('.pixel-directory-search:not([open])').count()) await page.getByText('Поиск по сетям и адресам', { exact: true }).click();
  await page.locator('#pixel-store-search').fill('Балашиха Свердлова 26');
  await page.locator('#pixel-store-address-results [data-store-id="503695"]').click();
  const say = async text => {
    await openHory(page);
    await page.locator('#basket-proposal-input').fill(text);
    await page.locator('#basket-proposal-submit').click();
  };
  await say('Собери недорогую корзину на неделю для троих в Магните и Перекрёстке');
  await say('Ограничений нет');
  const guided = page.locator('.guided-shopping');
  const variants = guided.locator('.guided-shopping-stores');
  const cards = variants.locator('.guided-store-option');
  await expect(cards).toHaveCount(2);
  await expect(variants).toContainText('15/15 позиций');
  await expect(guided.locator('.guided-shopping-difference')).toContainText('разница');
  await expect(guided.locator('.guided-shopping-conditions')).toContainText('Марки и фасовки различаются');
  await expect(guided.locator('.guided-shopping-conditions')).toContainText('Наличие не подтверждено');
  await expect(guided.locator('.guided-shopping-conditions')).toContainText('Доставка и сборы не включены');
  for (const card of await cards.all()) {
    const address = await card.locator('.guided-store-address').innerText();
    expect((await card.innerText()).split(address)).toHaveLength(2);
    expect(await card.locator('.guided-store-name').innerText()).not.toContain(address);
    await expect(card.locator('button')).toHaveCSS('min-height', '44px');
    expect((await card.locator('button').boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  const disclosure = guided.locator('.guided-shopping-information');
  await expect(disclosure).not.toHaveAttribute('open', '');
  await guided.evaluate(node => node.scrollIntoView({ block: 'start' }));
  const firstProduct = guided.locator('tbody tr').first();
  await expect(firstProduct).toBeInViewport();
  const layout = await guided.evaluate(node => ({ top: node.getBoundingClientRect().top,
    productTop: node.querySelector('tbody tr').getBoundingClientRect().top }));
  expect(layout.productTop - layout.top).toBeLessThan(600);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const evidence = process.env.CHECKNI_GUIDED_EVIDENCE;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `${testInfo.project.name}-guided-compact.png`) });
  }
  const summary = disclosure.locator('summary');
  await summary.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(summary).toBeFocused();
  await expect(summary).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('open', '');
  await expect(disclosure).toContainText('не сравнение одинаковых SKU');
  await expect(disclosure).toContainText('Цены в физическом магазине могут отличаться');
  await page.keyboard.press('Enter');
  await expect(disclosure).not.toHaveAttribute('open', '');
  const delivery = variants.getByRole('button', { name: 'Показать Перекрёсток', exact: true });
  await delivery.focus();
  await page.keyboard.press('Enter');
  await expect(delivery).toHaveAttribute('aria-pressed', 'true');
  await expect(guided.locator('caption')).toHaveText('Список на проверку · Перекрёсток');
  await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');
  // Exercise the scoped palette in both real theme states, including the
  // selected button's white text (the decorative accent is too light at night).
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.body.setAttribute('data-hori-theme', value), theme);
    const contrast = await delivery.evaluate(node => {
      const style = getComputedStyle(node);
      const luminance = rgb => rgb.match(/[\d.]+/gu).slice(0, 3).map(Number).map(value => {
        const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  await guided.evaluate(node => node.scrollIntoView({ block: 'start' }));
  if (evidence) await page.screenshot({ path: path.join(evidence, `${testInfo.project.name}-guided-dark.png`) });
  // A fresh-looking compact card must not conceal the expiry result.
  await page.clock.setFixedTime(new Date(Date.parse(at) + 3600001));
  await say('Сравнить варианты');
  await expect(guided.locator('.guided-shopping-warning')).toContainText('Сравнение свежих сумм пока недоступно');
  await expect(guided.locator('.guided-shopping-difference')).toHaveCount(0);
  await expect(cards.first().locator('.guided-store-condition')).toContainText('старые или неизвестные цены');
  await expect(guided.locator('.guided-shopping-information')).not.toHaveAttribute('open', '');
});
