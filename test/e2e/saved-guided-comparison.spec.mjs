import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {openHory,openBasket} from './helpers/pixel-surface.mjs';
const {rows}=JSON.parse(await readFile(new URL('../../tests/fixtures/weekly-retail/cross-retailer-20261101.json',import.meta.url),'utf8'));
test('saved basket compares its selected catalogues after reload and quantity/removal edits without cached prices',async({page,context})=>{
 test.setTimeout(90000);
 const at='2026-11-02T08:00:00Z';await page.clock.setFixedTime(new Date(at));
 let ai=0,hideDeliveryMilk=false;const reads=[];
 await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
 await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({json:[]}));
 await page.route('**/rest/v1/**retail_catalog_items**',r=>{
  const q=new URL(r.request().url()).searchParams,store=q.get('store_id')?.replace('eq.','');
  const ids=q.get('source_product_id')?.slice(4,-1).split(',');
  const name=(q.get('name') ?? (q.has('p_query') ? 'ilike.*'+q.get('p_query').replaceAll(' ','*')+'*' : null))?.replace(/^ilike\.\*|\*$/gu,'').replaceAll('*',' ');
  reads.push(store);
  return r.fulfill({json:rows.filter(p=>p.store_id===store&&(!ids||ids.includes(p.source_product_id))&&(!name||p.name.toLowerCase().includes(name.toLowerCase()))
    &&!(hideDeliveryMilk&&store==='perekrestok-yandex-3186917'&&p.name.toLowerCase().includes('молоко')))
    .slice(0,Number(q.get('limit')??40)).map(p=>({...p,observed_at:at}))});
 });
 await page.goto('/?comparison=observed&catalog=retail#shop');
 const address=await page.locator('#magnit-store-address option[value="503695"]').textContent();
 if (await page.locator(".pixel-directory-search:not([open])").count()) await page.getByText("Поиск по сетям и адресам", {exact:true}).click();
 await page.locator('#pixel-store-search').fill(address.replace(/^(?:Москва|МО) · /u,''));
 await page.locator('#pixel-store-address-results [data-store-id="503695"]').click();
 await expect(page.locator('#pixel-storefront')).toBeVisible();
 const say=async text=>{await openHory(page);await page.locator('#basket-proposal-input').fill(text);await page.locator('#basket-proposal-submit').click();};
 await say('Собери недорогую корзину на 10 дней для 4 человек в Магните и Перекрёстке');
 await say('Ограничений нет');
 await expect(page.locator('.guided-shopping-stores')).toContainText('15/15 позиций');
 await page.getByRole('button',{name:'Показать Перекрёсток',exact:true}).click();
 await say('Добавить показанное');await openBasket(page);
 await expect(page.locator('#compare-title')).toHaveText('Сравнить выбранные магазины');
 await expect(page.locator('#basket-content')).toContainText('Перекрёсток');
 await expect(page.locator('#basket-content')).not.toContainText('Выбранные адреса для сравнения');
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkni.guided-comparison-request.v1')));
 expect(stored.scopes.map(s=>s.retailerId).sort()).toEqual(['magnit','perekrestok']);
 expect(JSON.stringify(stored)).not.toMatch(/priceMinor|observedAt|availability|sourceUrl/);
 const before=await page.locator('.basket-list').innerText();
 await page.reload();await expect(page.locator('.basket-list')).toHaveText(before,{useInnerText:true});
 await expect(page.locator('.saved-catalog-variant')).toHaveCount(0);
 const readStart=reads.length;
 await page.locator('#compare-basket').click();
 await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 expect(reads.slice(readStart)).toContain('magnit-503695');expect(reads.slice(readStart)).toContain('perekrestok-yandex-3186917');
 await expect(page.locator('.basket-list')).toHaveText(before,{useInnerText:true});
 await expect(page.locator('#comparison-output')).toContainText('Доставка и сборы не включены');
 const first=page.locator('.basket-row').first(),count=Number(await first.locator('output').innerText());
 await first.getByRole('button',{name:/Увеличить количество/}).click();
 await expect(page.locator('.saved-catalog-variant')).toHaveCount(0);
 await page.locator('#compare-basket').click();await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 const delivery=page.locator('.saved-catalog-variant').filter({hasText:'Перекрёсток'});await delivery.locator('summary').first().click();
 await expect(delivery.locator('tbody tr').first()).toContainText((count+1)+' × ');
 await page.locator('.basket-row').last().getByRole('button',{name:/Удалить/}).click();
 await page.locator('#compare-basket').click();await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 await expect(page.locator('.saved-catalog-variant').filter({hasText:'Перекрёсток'}).locator('summary').first()).toContainText('14/14');
 await page.clock.setFixedTime(new Date(Date.parse(at)+3600001));
 await page.locator('#compare-basket').click();await expect(page.locator('.saved-catalog-variant')).toHaveCount(2);
 await expect(page.locator('#comparison-output')).toContainText('старые или неизвестные цены');
 await expect(page.locator('.saved-comparison-gaps').filter({hasText:'Перекрёсток'})).toContainText('Нужны свежие цены — весь список');
 await expect(page.locator('#comparison-output')).not.toContainText('ниже на');
 const remaining=await page.locator('.basket-list').innerText();
 hideDeliveryMilk=true;
 await page.reload();await expect(page.locator('.basket-list')).toHaveText(remaining,{useInnerText:true});
 await page.locator('#compare-basket').click();
 await expect(page.locator('.saved-comparison-gaps').filter({hasText:'Перекрёсток'})).toContainText('Товар не подтверждён — Молоко');
 await expect(page.locator('.basket-list')).toHaveText(remaining,{useInnerText:true});
 expect(ai).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('saved comparison distinguishes a fresh weight estimate from quantities that still require review',async({page,context})=>{
 const now=Date.parse('2026-11-07T08:00:00Z');
 await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.goto('/?comparison=observed&catalog=retail#shop');
 await expect(page.locator('html')).toHaveAttribute('data-checkni-boot','ready');
 await page.evaluate(()=>{const host=document.createElement('section');host.id='saved-comparison-contract';document.body.append(host);});
 const render=async change=>page.evaluate(async({now,change})=>{
  const {renderSavedGuidedComparison}=await import('/src/components/SavedGuidedComparison.mjs');
  const {compareCatalogDraftAlternatives}=await import('/src/core/catalogDraft.mjs');
  const group={key:'bananas',label:'Бананы',dimension:'g',dailyAmount:100};
  const drafts=['magnit','perekrestok'].map((retailerId,index)=>({
   scope:{retailerId,storeId:retailerId+'-test',storeName:index?'Перекрёсток':'Магнит'},
   rows:[{group,quantity:2,quantityReview:false,product:{id:retailerId+'-bananas',name:'Бананы',unit:'1 кг'},
    card:{name:'Бананы',unit:'1 кг',catalogPurchaseBasis:'weighed-portion',priceMinor:index?15000:10000,
     currency:'RUB',observedAt:new Date(now).toISOString(),sourceUrl:'https://example.com/source'}}]
  }));
  const result={kind:'catalog_comparison',drafts,request:{unresolvedGroupKeys:[]}};
  if(change==='pending')result.request.unresolvedGroupKeys=['milk'];
  if(change==='review')drafts[0].rows[0].quantityReview=true;
  if(change==='unknown-pack')drafts[0].rows[0].card.unit='Неизвестная упаковка';
  if(change==='stale')drafts[0].rows[0].card.observedAt=new Date(now-3600001).toISOString();
  if(change==='missing')drafts[0].rows[0].card=null;
  if(change==='tie')drafts[0].rows[0].card.priceMinor=15000;
  if(change==='mismatched-intent')drafts.forEach((draft,index)=>{
   draft.rows[0].card.catalogPurchaseBasis='piece';
   draft.rows[0].quantityIntent={dimension:'g',amount:index?3000:2000};
  });
  const before=JSON.stringify(result),core=compareCatalogDraftAlternatives(drafts,{nowMs:now});
  renderSavedGuidedComparison(document.querySelector('#saved-comparison-contract'),result,{nowMs:now});
  return {core,unchanged:before===JSON.stringify(result)};
 },{now,change});
 const host=page.locator('#saved-comparison-contract'),status=host.locator('[role="status"]');
 const fresh=await render('fresh');
 expect(fresh.core).toMatchObject({kind:'fresh',estimated:true,sameProducts:false,includesFees:false,availability:'unknown'});
 expect(fresh.unchanged).toBe(true);
 await expect(status).toContainText('Ориентировочно:');
 await expect(status).toContainText('ниже на 100,00');
 await expect(status).not.toContainText('нужно уточнить');
 await expect(host).toContainText('Считаем объём сохранённой корзины. В другом магазине может понадобиться больше упаковок.');
 await expect(host).toContainText('Доставка и сборы не включены');
 const explanation=host.getByText('Как рассчитана сумма',{exact:true});await explanation.click();
 await expect(host.getByText(/сумма может отличаться от первоначального подбора/)).toBeVisible();
 await expect(host.getByText(/окончательная сумма зависит от взвешивания/)).toBeVisible();
 const tie=await render('tie');expect(tie.core).toMatchObject({kind:'fresh',estimated:true,differenceMinor:0});
 await expect(status).toContainText('Ориентировочно: суммы товаров в этих вариантах совпали');
 for(const change of ['pending','review','unknown-pack','stale','missing','mismatched-intent']){
  const result=await render(change);expect(result.unchanged).toBe(true);
  await expect(status).not.toContainText('ниже на');
  if(change==='review'||change==='unknown-pack')await expect(status).toContainText('нужно уточнить');
  if(change==='stale')await expect(status).toContainText('старые или неизвестные цены');
  if(change==='pending'||change==='missing')await expect(status).toContainText('неполный');
  if(change==='mismatched-intent')await expect(status).toContainText('Не удалось сопоставить');
 }
});
