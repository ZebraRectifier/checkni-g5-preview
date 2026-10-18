import{test,expect}from'@playwright/test';import{readFile}from'node:fs/promises';
const fixture=JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-retail/magnit-buckwheat-773804.json',import.meta.url),'utf8'));
const say=async(page,text)=>{await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
test('selected Magnit → current catalogue without repeating the chain → actual pack table → confirmation/reload',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-18T03:30:00Z'));let ai=0;
 await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.route('**/rest/v1/**',r=>r.fulfill({json:[]}));
 await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
 await page.route('**/rest/v1/retail_catalog_items**',r=>{
   const p=new URL(r.request().url()).searchParams,q=(p.get('name')??'').replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ').toLowerCase();
   return r.fulfill({json:fixture.rows.filter(x=>'eq.'+x.store_id===p.get('store_id')&&x.name.toLowerCase().includes(q)).slice(0,Number(p.get('limit')??40))});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');await page.locator('#retail-store-card-magnit').click();await page.locator('#magnit-store-address').selectOption('773804');
 const output=page.locator('#basket-proposal-status');await say(page,'Собери недорогую корзину на неделю для троих');await expect(output).toContainText('Где закупаемся');
 await say(page,'Текущий магазин');await say(page,'Ограничений нет');const table=output.getByRole('table');await expect(table.getByRole('row')).toHaveCount(2);
 await expect(table).toContainText('800 г');await expect(table).toContainText('39,99 ₽ / 800 г');await expect(table).toContainText('79,98 ₽');await expect(output).toContainText('Ещё нужно подобрать: 12 поз.');
 await expect(page.locator('#basket-dock-copy')).toContainText('Пока пусто');await output.getByRole('button',{name:'Добавить найденное',exact:true}).click();
 await expect(page.locator('#basket-dock-copy')).toContainText('1 поз.');await output.getByRole('button',{name:'Открыть корзину',exact:true}).click();await page.reload();
 await expect(page.locator('#basket-view')).toContainText('800 г');const basket=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.surface.basket.v1')));
 expect(basket).toHaveLength(1);expect(basket[0].quantity).toBe(2);expect(ai).toBe(0);
});
