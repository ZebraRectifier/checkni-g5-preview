import { PUBLISHED_URL,PUBLISHED_SCOPE,parseCataloguePeriod,parsePublishedCatalogue,publishedProductUrl } from '../../src/observations/okeyPublishedPromotions.mjs';
import { moscowDate } from '../../src/observations/okeyOfficialPromotions.mjs';

export const MAX_DIAGNOSTIC_BYTES=128_000;
export const MAX_DIAGNOSTIC_PRODUCTS=24;
const challenge=/SmartCaptcha|Checking your browser|Access Denied|unusual traffic|вы не робот|подтвердите.*не робот/iu;

// Executed in the already opened public document. Never return HTML, scripts,
// links, forms, storage or browser state. Only a card's public ID is read.
export function extractPublishedDocument(doc=document,style=getComputedStyle) {
  let fieldTruncations=0;
  const text=(value,limit)=>{const s=typeof value==='string'?value:'';if(s.length>limit)fieldTruncations++;return s.slice(0,limit);};
  const parts=el=>({rubles:text(el?Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim():'',64),
    cents:text(el?.querySelector('span')?.textContent?.trim()??'',16)});
  const nodes=Array.from(doc.querySelectorAll('#id_products article.product'));
  const visible=nodes.filter(el=>el.getClientRects().length&&style(el).visibility!=='hidden');
  const products=visible.slice(0,200).map(el=>{
    const current=parts(el.querySelector('.product__price-new')),old=parts(el.querySelector('.product__price-old'));
    return {id:text(el.id.replace('id_product_',''),32),name:text(el.querySelector('.product__name')?.textContent,401),
      endText:text(el.querySelector('.product__descr > .italic')?.textContent,128),
      ...current,oldRubles:old.rubles,oldCents:old.cents};
  });
  const title=text(doc.querySelector('h1')?.textContent?.replace(/\s+/gu,' ').trim(),512);
  const period=text(doc.querySelector('h2.catalog_dates')?.textContent?.replace(/\s+/gu,' ').trim(),256);
  const rawFieldTruncations=fieldTruncations;
  return {raw:{title,period,products},documentTitle:text(doc.title,256),counts:{matchedProducts:nodes.length,visibleProducts:visible.length,capturedProducts:products.length,
    productsTruncated:visible.length>200,fieldTruncations,rawFieldTruncations,titleElements:doc.querySelectorAll('h1').length,periodElements:doc.querySelectorAll('h2.catalog_dates').length}};
}

function clean(value,limit) {
  return (typeof value==='string'?value:'').slice(0,limit).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu,'')
    .replace(/(?:Bearer\s+|(?:password|secret|session|access_token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/giu,'[redacted]')
    .replace(/\b(?:ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/gu,'[redacted]')
    .replace(/https?:\/\/[^\s<>]+/giu,'[link omitted]');
}
function count(value) {return Number.isSafeInteger(value)&&value>=0?Math.min(value,1_000_000):0;}

export function diagnosticCapture(extracted,{httpStatus,exactLanding,observedAt}) {
  const raw=extracted?.raw,rows=Array.isArray(raw?.products)?raw.products:[];
  return {version:1,kind:'okey-published-source-diagnostic',scope:PUBLISHED_SCOPE,sourceUrl:PUBLISHED_URL,
    observedAt,httpStatus:Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599?httpStatus:null,exactLanding:exactLanding===true,
    documentTitle:clean(extracted?.documentTitle,256),
    counts:Object.fromEntries(['matchedProducts','visibleProducts','capturedProducts','fieldTruncations','rawFieldTruncations','titleElements','periodElements'].map(key=>[key,count(extracted?.counts?.[key])])),
    productsTruncated:extracted?.counts?.productsTruncated===true,rawProductsOmitted:Math.max(0,Math.min(rows.length,200)-MAX_DIAGNOSTIC_PRODUCTS),
    raw:{title:clean(raw?.title,512),period:clean(raw?.period,256),products:rows.slice(0,MAX_DIAGNOSTIC_PRODUCTS).map(p=>({
      id:clean(p?.id,32),name:clean(p?.name,401),endText:clean(p?.endText,128),rubles:clean(p?.rubles,64),cents:clean(p?.cents,16),
      oldRubles:clean(p?.oldRubles,64),oldCents:clean(p?.oldCents,16)}))}};
}

function productRejection(p,period,today) {
  if(!p||!publishedProductUrl(p.id))return 'invalid_product_id';
  if(typeof p.name!=='string'||!p.name.replace(/\s+/gu,' ').trim()||p.name.replace(/\s+/gu,' ').trim().length>400)return 'invalid_product_name';
  if(!/^[\d\s]+$/u.test(p.rubles??'')||!/^\d{2}$/u.test(p.cents??''))return 'invalid_current_price';
  const minor=Number(p.rubles.replace(/\s/gu,''))*100+Number(p.cents);
  if(!Number.isSafeInteger(minor)||minor<=0||minor>100_000_000)return 'invalid_current_price';
  const end=p.endText?.trim().toLowerCase().match(/^до (\d{1,2}) ([а-яё]+)$/u);
  const expiry=end?parseCataloguePeriod(`с ${end[1]} по ${end[1]} ${end[2]} ${period.until.slice(0,4)}`)?.until:null;
  if(!expiry||expiry<period.from)return 'invalid_product_expiry';
  if((expiry<period.until?expiry:period.until)<today)return 'expired_product';
  return 'product_not_admitted';
}

// Diagnostics never admit observations. The unchanged production parser is
// the only source of the returned snapshot; reason codes only explain it.
export function parsePublishedWithDiagnostics(raw) {
  let snapshot;
  try {snapshot=parsePublishedCatalogue(raw);} catch {return {snapshot:null,parser:{acceptedProducts:0,reasons:['parser_exception'],productRejections:{}}};}
  const reasons=[],at=Date.parse(raw?.observedAt),period=parseCataloguePeriod(raw?.period);
  if(raw?.sourceUrl!==PUBLISHED_URL)reasons.push('source_url_mismatch');
  if(!raw?.title)reasons.push('title_missing');
  else if(!/^КАТАЛОГ АКЦИЙ\s+«ОКЕЙ ГИПЕРМАРКЕТ»\s*[—–-]\s*МОСКВА$/iu.test(raw.title.trim()))reasons.push('title_not_recognised');
  if(!Number.isFinite(at))reasons.push('observation_time_invalid');
  if(!raw?.period)reasons.push('period_missing');else if(!period)reasons.push('period_not_recognised');
  if(period&&Number.isFinite(at)){if(period.from>moscowDate(at))reasons.push('catalogue_not_started');if(period.until<moscowDate(at))reasons.push('catalogue_expired');}
  if(!Array.isArray(raw?.products))reasons.push('products_not_array');else if(!raw.products.length)reasons.push('products_empty');
  const productRejections={},seen=new Set();
  if(!reasons.length){
    for(const product of raw.products.slice(0,200)){
      let single;
      try {single=parsePublishedCatalogue({...raw,products:[product]});}catch {single=null;}
      const reason=single?(seen.has(product.id)?'duplicate_product_id':null):productRejection(product,period,moscowDate(at));
      if(reason)productRejections[reason]=(productRejections[reason]??0)+1;else seen.add(product.id);
    }
  }
  if(!snapshot&&!reasons.length)reasons.push('no_current_valid_products');
  return {snapshot,parser:{acceptedProducts:snapshot?.products.length??0,reasons,productRejections}};
}

export function serializeDiagnostic(report) {
  const value=JSON.stringify(report);
  if(Buffer.byteLength(value)>MAX_DIAGNOSTIC_BYTES)throw Error('diagnostic_size_limit');
  return value;
}

export async function collectPublishedWithDiagnostics({launch,readStatus,writeStatus,writeData,writeDiagnostics,emit=()=>{},now=Date.now}) {
  const status={status:'unavailable',lastAttemptAt:new Date(now()).toISOString(),sourceUrl:PUBLISHED_URL,scope:PUBLISHED_SCOPE};
  let browser,page,skipped=false,report={version:1,kind:'okey-published-source-diagnostic',sourceUrl:PUBLISHED_URL,scope:PUBLISHED_SCOPE,stage:'not-captured',sourceNavigations:0};
  let httpStatus=null,exactLanding=false;
  const persist=async()=>{serializeDiagnostic(report);await writeDiagnostics(report);};
  const capture=async()=>{
    const extracted=await page.evaluate(extractPublishedDocument);
    report={...diagnosticCapture(extracted,{httpStatus,exactLanding,observedAt:new Date(now()).toISOString()}),stage:'captured',sourceNavigations:1};
    await persist(); // Raw evidence survives a parser exception or a later close failure.
    return {...extracted.raw,sourceUrl:page.url(),observedAt:report.observedAt};
  };
  try {
    const previous=await readStatus();
    if(previous.status==='blocked'){
      skipped=true;report.stage='skipped-existing-block';return {status:previous,skipped:true};
    }
    browser=await launch();page=await browser.newPage({locale:'ru-RU'});page.setDefaultTimeout(15_000);
    report.sourceNavigations=1;
    const response=await page.goto(PUBLISHED_URL,{waitUntil:'domcontentloaded',timeout:30_000});
    httpStatus=response?.status()??null;exactLanding=page.url()===PUBLISHED_URL;
    report.httpStatus=httpStatus;report.exactLanding=exactLanding;
    const body=await page.locator('body').innerText();
    if([403,429].includes(httpStatus)||challenge.test(body)){
      status.status='blocked';report.failure='source_challenge';
      try {await capture();}catch {report.captureFailed=true;}
      throw Error('source_challenge');
    }
    if(!response?.ok()||!exactLanding){await capture();throw Error('published_source_unavailable');}
    let selectorReady=true;
    try {await page.locator('#id_products article.product').first().waitFor();}catch {selectorReady=false;}
    const raw=await capture();
    const parsed=parsePublishedWithDiagnostics(raw);report.parser=parsed.parser;report.stage='parsed';
    if(!selectorReady)report.failure='visible_product_selector_unavailable';
    if(report.counts.rawFieldTruncations)report.failure='document_field_limit';
    await persist();
    if(report.failure)throw Error('published_collection_unavailable');
    if(!parsed.snapshot)throw Error('no_verified_published_prices');
    await writeData(parsed.snapshot);status.status='collected';status.uniqueProducts=parsed.snapshot.products.length;
  } catch(error) {
    if(page&&report.stage==='not-captured'){
      try {await capture();}catch {report.captureFailed=true;}
    }
    status.reason=['source_challenge','no_verified_published_prices'].includes(error.message)?error.message:'published_collection_unavailable';
    report.failure??=status.reason;
  } finally {
    try {await browser?.close();}catch {report.cleanupFailed=true;}
    // Cleanup failure must not prevent persisting the diagnostic or actual status.
    try {await persist();}catch {report.diagnosticWriteFailed=true;}
    if(!skipped)await writeStatus(status);emit(serializeDiagnostic(report));
  }
  return {status,report};
}
