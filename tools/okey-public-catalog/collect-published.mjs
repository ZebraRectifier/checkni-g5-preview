import { chromium } from '@playwright/test';
import { readFile,writeFile } from 'node:fs/promises';
import { PUBLISHED_URL,PUBLISHED_SCOPE,parsePublishedCatalogue } from '../../src/observations/okeyPublishedPromotions.mjs';
const DATA=new URL('../../src/data/okeyPublishedPromotions.json',import.meta.url);
const STATUS=new URL('../../src/data/okeyPublishedRefresh.json',import.meta.url);
const status={status:'unavailable',lastAttemptAt:new Date().toISOString(),sourceUrl:PUBLISHED_URL,scope:PUBLISHED_SCOPE};
let browser;
try {
  const previous=JSON.parse(await readFile(STATUS,'utf8'));
  if(previous.status==='blocked'){console.log('Published OKEY catalogue paused; no source requests made.');process.exit(0);}
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({locale:'ru-RU'});
  page.setDefaultTimeout(15_000);
  // One ordinary public navigation. No cookies, credentials, private endpoints or source-block resets.
  const response=await page.goto(PUBLISHED_URL,{waitUntil:'domcontentloaded',timeout:30_000});
  const body=await page.locator('body').innerText();
  if([403,429].includes(response?.status())||/SmartCaptcha|Checking your browser|Access Denied|unusual traffic|вы не робот|подтвердите.*не робот/iu.test(body)) {
    status.status='blocked';throw Error('source_challenge');
  }
  if(!response?.ok()||page.url()!==PUBLISHED_URL)throw Error('published_source_unavailable');
  await page.locator('#id_products article.product').first().waitFor();
  const raw=await page.evaluate(()=>{
    const parts=el=>({rubles:el?Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim():'',
      cents:el?.querySelector('span')?.textContent.trim()??''});
    return {title:document.querySelector('h1')?.textContent.replace(/\s+/gu,' ').trim(),
      period:document.querySelector('h2.catalog_dates')?.textContent.replace(/\s+/gu,' ').trim(),
      products:Array.from(document.querySelectorAll('#id_products article.product'))
        .filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').slice(0,200).map(el=>{
          const current=parts(el.querySelector('.product__price-new')),old=parts(el.querySelector('.product__price-old'));
          return {id:el.id.replace('id_product_',''),name:el.querySelector('.product__name')?.textContent,
            endText:el.querySelector('.product__descr > .italic')?.textContent,...current,oldRubles:old.rubles,oldCents:old.cents};
        })};
  });
  const snapshot=parsePublishedCatalogue({...raw,sourceUrl:page.url(),observedAt:new Date().toISOString()});
  if(!snapshot)throw Error('no_verified_published_prices');
  await writeFile(DATA,JSON.stringify(snapshot,null,2)+'\n');
  status.status='collected';status.uniqueProducts=snapshot.products.length;
} catch(error) {
  status.reason=['source_challenge','no_verified_published_prices'].includes(error.message)?error.message:'published_collection_unavailable';
} finally {
  await browser?.close();
  await writeFile(STATUS,JSON.stringify(status,null,2)+'\n');
  console.log(JSON.stringify(status));
}
