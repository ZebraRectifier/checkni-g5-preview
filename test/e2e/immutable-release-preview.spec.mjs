import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {releaseCandidates,verifyLocal,activationState,mime,digest} from '../../tools/browser-release/verify.mjs';

const root=path.resolve(process.env.RELEASE_ROOT||'.');
const ids=await releaseCandidates(root);
test('release candidate is explicitly required for browser acceptance',()=>{
  test.skip(!ids.length,'NO_RELEASE_CANDIDATE: no immutable release was browser-verified');
  expect(ids.length).toBeGreaterThan(0);
});
for(const id of ids)test(`immutable preview ${id} boots and preserves manual retail basket`,async({page,context})=>{
  const manifest=await verifyLocal(root,id);
  console.log('Verified local immutable content',id);
  const server=http.createServer(async(req,res)=>{
    try{
      const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);
      if(!name||name.split('/').some(s=>!s||s==='.'||s==='..')||name.includes('\\'))throw Error('bad_path');
      const bytes=await fs.readFile(path.join(root,name));
      res.setHeader('content-type',mime(name));res.end(bytes);
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/`;
  const errors=[],rootModules=[],dataPaths=[];let ai=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',req=>{const p=new URL(req.url()).pathname;if(/^\/src\/.*\.m?js$/u.test(p))rootModules.push(p);if(p.includes('/src/data/')&&p.endsWith('.json'))dataPaths.push(p);});
  try{
    // HTTP type/content check exercises the exact subtree served to the browser.
    for(const e of manifest.entries){const response=await fetch(base+`releases/${id}/${e.file}`,{signal:AbortSignal.timeout(10000)});const body=Buffer.from(await response.arrayBuffer());
      expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe(e.mime);expect(body.length).toBe(e.bytes);expect(digest(body)).toBe(e.sha256);}
    console.log('Verified HTTP closure',manifest.entries.length);
    await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
    await page.route('**/functions/v1/ai-basket-proposal',r=>{ai++;return r.abort();});
    // Existing retail-product-selection regression identity, synthetic source row.
    // This proves wiring only, not real price, availability or freshness.
    const fixture={rows:[{retailer_id:'magnit',store_id:'magnit-777312',store_name:'Магнит · Берёзовая аллея, 17к2',
      locality_id:'city-moscow',locality_name:'Москва',source_product_id:'1899800689',name:'Кефир Простоквашино 2.5% 930г',
      weight_text:'930 г',price_minor:7999,currency:'RUB',price_condition:'public-online',availability:'unknown',main_category_id:63963,
      product_url:'https://magnit.ru/product/1899800689-kefir_prostokvashino_2_5_930g?shopCode=777312&shopType=1',
      source_url:'https://magnit.ru/catalog/63963-molochnyy_prilavok?shopCode=777312&shopType=1',
      scope_evidence_url:'https://magnit.ru/catalog/63963-molochnyy_prilavok?shopCode=777312&shopType=1',
      scope_binding:'public-store-product-page',binding_id:'magnit-shopcode-777312',
      location_label:'г Москва, аллея Берёзовая, д 17 к 2',image_url:null,observed_at:'2026-10-10T06:30:00Z'}]};
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'apikey,content-type','access-control-allow-methods':'GET,OPTIONS'};
    await page.route('**/rest/v1/retail_catalog_categories**',r=>r.fulfill({headers,json:[]}));
    await page.route('**/rest/v1/retail_catalog_items**',r=>{
      const q=new URL(r.request().url()).searchParams,store=q.get('store_id')?.replace('eq.','');
      const offset=Number(q.get('offset')??0),limit=Number(q.get('limit')??40);
      return r.fulfill({headers,json:fixture.rows.filter(p=>p.store_id===store).slice(offset,offset+limit)});
    });
    await page.goto(base+`releases/${id}/index.html?comparison=observed&catalog=retail#shop`);
    console.log('Opened immutable preview');
    expect(errors).toEqual([]);
    if (await page.locator(".pixel-directory-search:not([open])").count()) await page.getByText("Поиск по сетям и адресам", {exact:true}).click();
    await page.locator('#pixel-store-search').fill('Берёзовая 17',{timeout:10000});
    await page.locator('#pixel-store-address-results [data-store-id="777312"]').click({timeout:10000});
    console.log('Selected fixture address');
    const card=page.locator('.product-card').filter({has:page.getByRole('button',{name:/Добавить/u})}).first();
    await card.getByRole('button',{name:/Добавить/u}).click({timeout:10000});
    await expect(page.locator('#basket-dock-copy')).not.toContainText('Пока пусто');
    const before=await page.locator('#basket-dock-copy').innerText();await page.reload();
    await expect(page.locator('#basket-dock-copy')).toHaveText(before);
    if(manifest.entries.some(entry=>entry.file==='src/ports/publishedPromotionCatalog.mjs')){
      await page.locator('[data-pixel-action="stores"]').click();
      await expect(page.locator('.okey-directory,#pyaterochka-published')).toHaveCount(0);
      await expect(page.locator('#beta-live-section')).toBeHidden();
      await page.route('**/src/data/okey*.json',r=>r.fulfill({status:503,json:{}}));
      await page.locator('#retail-store-card-okey').click();
      await expect(page.locator('#pixel-storefront-title')).toHaveText('О’КЕЙ');
      await expect(page.locator('#empty-search')).toContainText(/(?:Не удалось загрузить товары|Каталог сейчас недоступен)/);
      await expect(page.locator('.pixel-store-address')).toBeHidden();
      await page.locator('#catalog-other-stores').click();
      await expect(page.locator('#pixel-store-home')).toBeVisible();
      await page.locator('[data-pixel-action="hory"]').click();
      await expect(page.locator('#pixel-hory-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#pixel-hory-dialog')).toBeHidden();
      await expect(page.locator('#basket-dock-copy')).toHaveText(before);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.evaluate(async release=>{
      const {createNearbyShoppingPort}=await import(`/releases/${release}/src/ports/nearbyShoppingPort.mjs`);
      await createNearbyShoppingPort().directory();
    },id);
    expect(errors).toEqual([]);expect(rootModules).toEqual([]);expect(ai).toBe(0);
    const coordinateFile='src/data/magnitRegisteredCoordinates.json';
    const pinnedCoordinates=manifest.entries.some(entry=>entry.file===coordinateFile)
      ? `/releases/${id}/${coordinateFile}` : null;
    expect(dataPaths.length).toBeGreaterThan(0);
    // Prices and city directories stay mutable; validated coordinate joins are
    // versioned with their admission code and checked in the HTTP closure above.
    expect(dataPaths.every(p=>p===pinnedCoordinates||p.startsWith('/src/data/'))).toBe(true);
    if(pinnedCoordinates){
      expect(dataPaths).toContain(pinnedCoordinates);
      expect(dataPaths).not.toContain('/'+coordinateFile);
    }
    if(await activationState(root)===id){
      for(const entry of ['index.html','prices.html']){
        await page.goto(base+entry);await expect(page.locator('main').first()).toBeVisible();
        expect(errors).toEqual([]);expect(rootModules).toEqual([]);
      }
    }
  }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
});
