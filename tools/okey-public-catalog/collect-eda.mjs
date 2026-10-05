import { chromium } from '@playwright/test';
import { readFile,writeFile } from 'node:fs/promises';
import { parseDeliveryProduct,addressMatches } from './eda-parser.mjs';
import { mergeDeliverySnapshot } from '../../src/observations/addressPriceHistory.mjs';

const ADDRESS='Москва, проспект Мира, 211к2';
const ROOT='https://eda.yandex.ru/retail/okej_retail';
const HISTORY=new URL('../../src/data/okeyDeliveryHistory.json',import.meta.url);
const STATUS=new URL('../../src/data/okeyDeliveryRefresh.json',import.meta.url);
const started=Date.now();
let browser,page,products=new Map(),visited=new Set(),rejected=0;
const challengePattern=/SmartCaptcha|подтвердите.*не робот|вы не робот|Checking your browser|unusual traffic|Access Denied|Bad IP|automated requests/i;
const status={lastAttemptAt:new Date().toISOString(),status:'unavailable',selectedDeliveryAddress:ADDRESS};
try{
  let previous;try{previous=JSON.parse(await readFile(STATUS,'utf8'));}catch{}
  if(previous?.status==='blocked'){
    console.log('Collection paused after source challenge; no source request made.');process.exit(0);
  }
  browser=await chromium.launch({headless:true});
  page=await browser.newPage();
  page.setDefaultTimeout(15000);
  async function guard(){
    const text=await page.locator('body').innerText();
    if(challengePattern.test(text)){
      status.status='blocked';throw new Error('source_challenge');
    }
  }
  async function selected(){
    await guard();
    const buttons=await page.locator('header button').allTextContents();
    if(!buttons.some(addressMatches))throw new Error('selected_address_unproven');
  }
  await page.goto(ROOT,{waitUntil:'domcontentloaded'});await guard();
  // Fresh context only; no imported session, credentials, cookies or private endpoints.
  await page.getByRole('button',{name:'Укажите адрес',exact:true}).click();
  await guard();
  await page.getByRole('textbox').fill(ADDRESS);
  const suggestion=page.getByRole('option',{name:'проспект Мира, 211к2 Москва',exact:true});
  await suggestion.click();
  await page.getByRole('button',{name:'Ок',exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('header button')).some(b=>b.textContent.toLowerCase().replace(/[\s,]/g,'').includes('проспектмира211к2')));
  await selected();
  const roots=await page.locator('aside a[href*="/cat/"]').evaluateAll(as=>as.map(a=>({url:a.href,name:a.textContent.trim()})));
  const queue=roots.map(step=>({url:step.url,name:step.name,steps:[step]}));
  async function navigate(step){
    await guard();
    if(page.url()!==step.url){
      const path=new URL(step.url).pathname;
      await page.locator('a[href='+JSON.stringify(path)+']').first().click();
      await page.waitForURL(step.url);
    }
    if(['Идея для ужина','+1 к заботе'].includes(step.name)){
      // These observed campaign pages render a graphic banner and an empty h1.
      await page.locator('main a[href*="/product/"]').first().waitFor();
      await page.waitForTimeout(500);
    }else await page.locator('main h1').filter({hasText:step.name}).waitFor();
    await selected();
  }
  while(queue.length && visited.size<500 && Date.now()-started<12*60000){
    const entry=queue.shift();
    const url=entry.url;
    if(visited.has(url))continue;
    const parsed=new URL(url);
    if(parsed.origin!=='https://eda.yandex.ru'||!parsed.pathname.startsWith('/retail/okej_retail/cat/'))continue;
    // The address is transient page state: full-page goto would reset it.
    // Walk only observed anchors through the retailer's own SPA navigation.
    const target=page.locator('a[href='+JSON.stringify(parsed.pathname)+']').first();
    if(await target.count())await navigate(entry);
    else for(const step of entry.steps)await navigate(step);
    visited.add(url);
    const category=(await page.locator('main h1').innerText()).trim()||entry.name;
    for(let scroll=0;scroll<12;scroll++){
      await selected();
      const rows=await page.locator('main a[href*="/product/"]').evaluateAll(as=>as.map(a=>({productUrl:a.href,displayedText:a.textContent.trim()})));
      const sourceObservedAt=new Date().toISOString();
      for(const row of rows){const p=parseDeliveryProduct(row,category);if(p)products.set(p.sourceProductId,{...p,sourceObservedAt,categoryUrl:url});else rejected++;}
      const before=await page.locator('main a[href*="/product/"]').count();
      await page.locator('main').evaluate(main=>main.scrollIntoView({block:'end'}));
      await page.waitForTimeout(500);
      if(await page.locator('main a[href*="/product/"]').count()===before)break;
    }
    // Follow only links rendered by the source, including the category's subcategories.
    const links=await page.locator('main a[href*="/cat/"]').evaluateAll(as=>as.map(a=>({url:a.href,name:a.textContent.trim()})));
    queue.unshift(...links.filter(s=>s.name&&!visited.has(s.url)).map(s=>({url:s.url,name:s.name,steps:[...entry.steps,s]})));
  }
  if(!products.size)throw new Error('no_product_observations');
  const at=new Date().toISOString();
  const snapshot={kind:'okey-yandex-eda-rendered-delivery-evidence',observedAt:at,observedDate:at.slice(0,10),
    observationPrecision:'instant',sourceUrl:ROOT,retailerId:'okey',salesChannel:'yandex-eda-delivery',
    selectedDeliveryAddress:ADDRESS,physicalStoreId:null,physicalStoreAddress:null,
    priceScope:'selected-delivery-address-not-proven-physical-store',complete:false,
    coverage:{uniqueRenderedProducts:products.size,visitedCategoryPages:visited.size,rejectedRows:rejected,remainingPages:queue.length,expectedTotal:null,fullCatalog:false},
    refreshStatus:'public-rendered-browser',products:[...products.values()]};
  const bundle=JSON.parse(await readFile(HISTORY,'utf8'));
  await writeFile(HISTORY,JSON.stringify(mergeDeliverySnapshot(bundle,snapshot),null,2)+'\n');
  status.status='collected';status.uniqueProducts=products.size;status.visitedCategoryPages=visited.size;
}catch(error){
  try{if(page&&challengePattern.test(await page.locator('body').innerText()))status.status='blocked';}catch{}
  status.reason=error.message==='source_challenge'?'source_challenge':'collection_unavailable';
  // Failed collection preserves the previous successful snapshot and every historical price.
}finally{
  await browser?.close();
  await writeFile(STATUS,JSON.stringify(status,null,2)+'\n');
  console.log(JSON.stringify(status));
}
