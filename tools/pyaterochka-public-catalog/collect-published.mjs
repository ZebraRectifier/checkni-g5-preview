import{chromium}from'@playwright/test';
import{readFile,writeFile,rename}from'node:fs/promises';
import{PYAT_PUBLISHED_URL,PYAT_PUBLISHED_SCOPE,parsePyatCatalogue}from'../../src/observations/pyaterochkaPublishedPromotions.mjs';
import{extractPyatDom}from'./pyat-dom.mjs';
import{pyatCollectionGate}from'./collection-gate.mjs';
import{pyatStatePaths}from'./state-paths.mjs';
const{data:DATA,status:STATUS,host:HOST}=pyatStatePaths();
let previous,host;try{previous=JSON.parse(await readFile(STATUS,'utf8'));host=JSON.parse(await readFile(HOST,'utf8'));}catch{}
const gate=pyatCollectionGate(previous,host,Date.now(),process.env.PYAT_RESERVATION_OWNER);
if(!gate.due||gate.reason!=='reserved-attempt'){console.log(JSON.stringify({status:'deferred',reason:gate.reason==='due'?'reservation-required':gate.reason,sourceRequests:0}));process.exit(0);}
const status={status:'unavailable',lastAttemptAt:new Date().toISOString(),sourceUrl:PYAT_PUBLISHED_URL,scope:PYAT_PUBLISHED_SCOPE,collectionMode:'automated',sourceRequests:0};
let browser;
try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({locale:'ru-RU'});page.setDefaultTimeout(10000);
  status.sourceRequests=1;const r=await page.goto(PYAT_PUBLISHED_URL,{waitUntil:'domcontentloaded',timeout:30000});
  const body=(await page.locator('body').innerText()).slice(0,160000);
  if([403,429].includes(r?.status())||/SmartCaptcha|Checking your browser|Access Denied|unusual traffic|вы не робот|подтвердите.*не робот/iu.test(body)){
    status.status='blocked';throw Error('source_challenge');
  }
  if(!r?.ok()||page.url()!==PYAT_PUBLISHED_URL)throw Error('source_unavailable');
  await page.locator('#id_products article.product').first().waitFor();
  const raw=await page.evaluate(extractPyatDom),snapshot=parsePyatCatalogue({...raw,sourceUrl:page.url(),observedAt:new Date().toISOString()});
  if(!snapshot)throw Error('no_verified_food_prices');
  await writeFile(new URL(DATA.href+'.tmp'),JSON.stringify(snapshot,null,2)+'\n');await rename(new URL(DATA.href+'.tmp'),DATA);
  status.status='collected';status.uniqueProducts=snapshot.products.length;status.observedAt=snapshot.observedAt;
}catch(e){status.reason=['source_challenge','no_verified_food_prices'].includes(e.message)?e.message:'source_unavailable';}
finally{await writeFile(STATUS,JSON.stringify(status,null,2)+'\n');await browser?.close();console.log(JSON.stringify(status));}
