import { chromium } from '@playwright/test';
import { readFile,writeFile } from 'node:fs/promises';
import { OFFICIAL_CATALOG_URL,OFFICIAL_SCOPE,officialProductUrl,parseOfficialProduct,validOfficialSnapshot } from '../../src/observations/okeyOfficialPromotions.mjs';
const DATA = new URL('../../src/data/okeyOfficialPromotions.json',import.meta.url);
const STATUS = new URL('../../src/data/okeyOfficialRefresh.json',import.meta.url);
const started = Date.now(), deadline = started+5*60_000;
const status = {status:'unavailable',lastAttemptAt:new Date(started).toISOString(),sourceUrl:OFFICIAL_CATALOG_URL,scope:OFFICIAL_SCOPE};
let browser;
try {
  const previous = JSON.parse(await readFile(STATUS,'utf8'));
  if (previous.status==='blocked') { console.log('Official OKEY source paused; no retailer requests made.'); process.exit(0); }
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({locale:'ru-RU'});
  page.setDefaultTimeout(15_000);
  async function visit(url) {
    if (Date.now()>=deadline) throw Error('source_budget_exhausted');
    const response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:30_000});
    const body = await page.locator('body').innerText();
    if ([403,429].includes(response?.status()) || /SmartCaptcha|Checking your browser|Access Denied|unusual traffic|вы не робот|подтвердите.*не робот/iu.test(body)) {
      status.status='blocked'; throw Error('source_challenge');
    }
    if (!response?.ok() || new URL(page.url()).hostname!=='www.okmarket.ru') throw Error('official_source_unavailable');
    const cities = await page.locator('header .location__current-title').allTextContents();
    if (!cities.some(c=>c.trim()==='Москва')) throw Error('selected_city_unproven');
  }
  const candidates = new Set(), listingPages = new Set();
  let next = OFFICIAL_CATALOG_URL;
  for (let n=0;n<3 && next && candidates.size<36;n++) {
    await visit(next); listingPages.add(next);
    await page.locator('a[href*="/product/"]').first().waitFor();
    const links = await page.locator('a[href*="/product/"]').evaluateAll(as=>as.map(a=>a.href));
    for (const link of links) { const url=officialProductUrl(link); if(url&&candidates.size<36)candidates.add(url); }
    // Follow a pagination link actually rendered by the source; never guess page URLs.
    next = await page.locator('a[nav-products]').evaluateAll((as,visited)=>{
      const link=as.find(a=>!visited.includes(a.href)&&/^[2-9]$/.test(a.textContent.trim())
        && new URL(a.href).origin==='https://www.okmarket.ru' && new URL(a.href).pathname==='/catalogs/');
      return link?.href??null;
    },[...listingPages]);
  }
  const products=[], rejected=[];
  for (const url of candidates) {
    if (Date.now()>=deadline || products.length>=24) break;
    await visit(url);
    await page.locator('h1.single-product__title').waitFor();
    const raw = await page.evaluate(()=>{
      const parts = selector => {
        const el=document.querySelector(selector);
        return {rubles:el?Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim():'',cents:el?.querySelector('sup')?.textContent?.trim()??''};
      };
      const current=parts('.single-product__price:not(.single-product__price--old)'), old=parts('.single-product__price--old');
      return {name:document.querySelector('h1.single-product__title')?.textContent,
        selectedCity:document.querySelector('header .location__current-title')?.textContent.trim(),
        endText:Array.from(document.querySelectorAll('.product-meta__item')).map(e=>e.textContent.trim()).find(t=>t.startsWith('Акция действует до')),
        ...current,oldRubles:old.rubles,oldCents:old.cents};
    });
    const product=parseOfficialProduct({...raw,productUrl:page.url(),observedAt:new Date().toISOString()});
    if(product)products.push(product);else rejected.push(url);
    await page.waitForTimeout(1000);
  }
  const snapshot={version:1,kind:'okey-official-city-promotions',retailerId:'okey',sourceUrl:OFFICIAL_CATALOG_URL,
    scope:OFFICIAL_SCOPE,selectedCity:'Москва',physicalStoreId:null,physicalStoreAddress:null,complete:false,
    observedAt:new Date().toISOString(),coverage:{listingPages:listingPages.size,candidateLinks:candidates.size,
      observedProducts:products.length,rejectedProducts:rejected.length,fullAssortment:false},products};
  if(!validOfficialSnapshot(snapshot))throw Error('no_verified_official_prices');
  await writeFile(DATA,JSON.stringify(snapshot,null,2)+'\n');
  status.status='collected';status.uniqueProducts=products.length;
} catch(error) {
  status.reason=['source_challenge','selected_city_unproven','source_budget_exhausted','no_verified_official_prices'].includes(error.message)?error.message:'official_collection_unavailable';
} finally {
  await browser?.close();
  await writeFile(STATUS,JSON.stringify(status,null,2)+'\n');
  console.log(JSON.stringify(status));
}
