import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLISHED_URL,PUBLISHED_SCOPE,parseCataloguePeriod,parsePublishedCatalogue,validPublishedSnapshot,currentPublishedProducts,verifyPublishedRefresh } from '../src/observations/okeyPublishedPromotions.mjs';
import { MAX_DIAGNOSTIC_BYTES,MAX_DIAGNOSTIC_PRODUCTS,extractPublishedDocument,diagnosticCapture,parsePublishedWithDiagnostics,serializeDiagnostic,collectPublishedWithDiagnostics } from '../tools/okey-public-catalog/published-diagnostics.mjs';
const at='2026-10-17T20:00:00.000Z';
const raw=()=>({sourceUrl:PUBLISHED_URL,title:'КАТАЛОГ АКЦИЙ «ОКЕЙ ГИПЕРМАРКЕТ» — МОСКВА',period:'с 15 по 21 октября 2026',observedAt:at,
  products:[{id:'51922605',name:'Свинина шея без кости п/ф охлажденный кг',rubles:'459',cents:'00',oldRubles:'728',oldCents:'99',endText:'до 21 октября'}]});
test('published prices preserve third-party city scope and integer kopeks',()=>{
  const s=parsePublishedCatalogue(raw());assert.ok(validPublishedSnapshot(s));assert.equal(s.scope,PUBLISHED_SCOPE);
  assert.equal(s.products[0].priceMinor,45900);assert.equal(s.products[0].availability,'unknown');
  assert.equal(s.products[0].priceWithCardMinor,null);assert.equal(s.physicalStoreId,null);assert.equal(s.complete,false);
});
test('catalogue period requires explicit valid year, bounded duration and chronological dates',()=>{
  assert.deepEqual(parseCataloguePeriod('с 29 октября по 4 ноября 2026'),{from:'2026-10-29',until:'2026-11-04'});
  for(const p of ['с 15 по 21 октября','с 31 по 32 октября 2026','с 1 января по 21 октября 2026','с 25 декабря по 7 января 2026'])assert.equal(parseCataloguePeriod(p),null);
});
test('wrong retailer, city, source, expired or future catalogue cannot become fresh prices',()=>{
  for(const change of [{title:'КАТАЛОГ АКЦИЙ «ЛЕНТА» — МОСКВА'},{title:'КАТАЛОГ АКЦИЙ «ОКЕЙ ГИПЕРМАРКЕТ» — ТУЛА'},
    {sourceUrl:'https://example.org/'},{period:'с 8 по 14 октября 2026'},{period:'с 22 по 28 октября 2026'}])assert.equal(parsePublishedCatalogue({...raw(),...change}),null);
});
test('invalid/duplicate prices and missing expiry are rejected; product expiry cannot extend catalogue',()=>{
  const r=raw();r.products.push({...r.products[0]},{...r.products[0],id:'51922606',cents:'000'},
    {...r.products[0],id:'51922607',endText:''},{...r.products[0],id:'51922608',rubles:'0',cents:'00'},
    {...r.products[0],id:'51922609',endText:'до 28 октября'});
  const s=parsePublishedCatalogue(r);assert.equal(s.products.length,2);assert.equal(s.products[1].validUntil,'2026-10-21');
});
test('expiry is enforced at Moscow midnight and freshness rejects future/older-than-24h observations',()=>{
  const s=parsePublishedCatalogue({...raw(),observedAt:'2026-10-21T19:00:00.000Z'});
  assert.equal(currentPublishedProducts(s,Date.parse('2026-10-21T20:59:59Z')).length,1);
  assert.equal(currentPublishedProducts(s,Date.parse('2026-10-21T21:00:00Z')).length,0);
  const fresh=parsePublishedCatalogue(raw());assert.equal(currentPublishedProducts(fresh,Date.parse(at)-1).length,0);
  assert.equal(currentPublishedProducts(fresh,Date.parse(at)+86_400_001).length,0);
});
test('snapshot mutations cannot invent store/card/stock, source links, prices or dates',()=>{
  const s=parsePublishedCatalogue(raw());
  for(const change of [{physicalStoreId:'123'},{scope:'exact-store'},{complete:true},{publisher:'okey'}])assert.equal(validPublishedSnapshot({...s,...change}),false);
  for(const change of [{productUrl:'https://example.org/'},{priceMinor:0},{availability:'in-stock'},{priceWithCardMinor:100},
    {validUntil:'2026-11-01'},{validUntil:'2026-10-32'},{observedAt:'2026-10-16T20:00:00Z'}])assert.equal(validPublishedSnapshot({...s,products:[{...s.products[0],...change}]}),false);
});
test('freshness requires evidence newly collected in this run, independent of retained historical data',()=>{
  const snapshot=parsePublishedCatalogue(raw()),startedAt='2026-10-17T19:59:00Z',nowMs=Date.parse(at)+1000;
  const status={status:'collected',lastAttemptAt:startedAt,sourceUrl:PUBLISHED_URL,scope:PUBLISHED_SCOPE,uniqueProducts:1};
  assert.equal(verifyPublishedRefresh({startedAt,status,snapshot,nowMs}).fresh,true);
  for(const change of [{status:'blocked'},{uniqueProducts:2},{lastAttemptAt:'2026-10-17T19:58:00Z'},{scope:'exact-store'}])
    assert.equal(verifyPublishedRefresh({startedAt,status:{...status,...change},snapshot,nowMs}).fresh,false);
  assert.equal(verifyPublishedRefresh({startedAt:'2026-10-17T20:00:01Z',status,snapshot,nowMs}).fresh,false);
});

test('published diagnostics return exactly the unchanged parser snapshot without diagnostic DTO fields',()=>{
  const input=raw(),result=parsePublishedWithDiagnostics(input);
  assert.deepEqual(result.snapshot,parsePublishedCatalogue(input));
  assert.deepEqual(result.parser,{acceptedProducts:1,reasons:[],productRejections:{}});
  assert.equal('parser' in result.snapshot,false);assert.equal('raw' in result.snapshot,false);
});

test('published diagnostics distinguish changed title, absent/changed period and noncurrent issue',()=>{
  for(const [change,reason] of [
    [{title:'Новый каталог ОКЕЙ'},'title_not_recognised'],[{title:''},'title_missing'],
    [{period:''},'period_missing'],[{period:'15–21 октября'},'period_not_recognised'],
    [{period:'с 8 по 14 октября 2026'},'catalogue_expired'],[{period:'с 22 по 28 октября 2026'},'catalogue_not_started'],
    [{sourceUrl:'https://example.test/'},'source_url_mismatch'],[{observedAt:'unknown'},'observation_time_invalid'],
    [{products:[]},'products_empty'],[{products:{}},'products_not_array']
  ]){
    const result=parsePublishedWithDiagnostics({...raw(),...change});assert.equal(result.snapshot,null);
    assert.ok(result.parser.reasons.includes(reason),reason);
  }
});

test('published diagnostic rejection counts preserve valid rows, duplicates, missing prices and expiry boundaries',()=>{
  const input=raw(),product=input.products[0];
  input.products.push({...product},{...product,id:'bad'},
    {...product,id:'51922606',name:''},{...product,id:'51922607',rubles:'',cents:''},
    {...product,id:'51922608',rubles:'0',cents:'00'},{...product,id:'51922609',endText:''},
    {...product,id:'51922610',endText:'до 16 октября'},
    {...product,id:'51922611',endText:'до 28 октября'});
  const result=parsePublishedWithDiagnostics(input);
  assert.deepEqual(result.snapshot,parsePublishedCatalogue(input));assert.equal(result.snapshot.products.length,2);
  assert.deepEqual(result.parser.productRejections,{duplicate_product_id:1,invalid_product_id:1,invalid_product_name:1,
    invalid_current_price:2,invalid_product_expiry:1,expired_product:1});
  assert.equal(result.snapshot.products.some(row=>row.priceMinor===0),false);
});

test('all invalid public prices remain unknown and parser exceptions expose no error text',()=>{
  const input=raw();input.products[0].cents='';
  const result=parsePublishedWithDiagnostics(input);assert.equal(result.snapshot,null);
  assert.deepEqual(result.parser,{acceptedProducts:0,reasons:['no_current_valid_products'],productRejections:{invalid_current_price:1}});
  const malformed=parsePublishedWithDiagnostics({...raw(),products:[null]});assert.equal(malformed.snapshot,null);
  assert.deepEqual(malformed.parser.reasons,['parser_exception']);assert.equal('error' in malformed.parser,false);
});

function publicDocument({input=raw(),hidden=0,renamed=false}={}) {
  const price=(rubles,cents)=>({childNodes:[{nodeType:3,textContent:rubles??''}],querySelector:selector=>selector==='span'?{textContent:cents??''}:null});
  const cards=input.products.map((product,index)=>({id:'id_product_'+product.id,hidden:index<hidden,
    getClientRects:()=>index<hidden?[]:[{}],querySelector:selector=>({
      '.product__name':{textContent:product.name},'.product__descr > .italic':{textContent:product.endText},
      '.product__price-new':price(product.rubles,product.cents),'.product__price-old':price(product.oldRubles,product.oldCents)
    }[selector]??null)}));
  const headings=input.title?[{textContent:input.title}]:[],periods=input.period?[{textContent:input.period}]:[];
  const selectors={'h1':headings,'h2.catalog_dates':periods,'#id_products article.product':renamed?[]:cards};
  return {title:'Публичный каталог',querySelector:selector=>selectors[selector]?.[0]??null,
    querySelectorAll:selector=>selectors[selector]??[],cookie:'NOT_CAPTURED',documentElement:{outerHTML:'NOT_CAPTURED_HTML'}};
}
const style=el=>({visibility:el.hidden?'hidden':'visible'});

test('bounded DOM extraction captures public fields, visibility and selector counts without page HTML/state',()=>{
  const input=raw();input.products.push({...input.products[0],id:'51922606'});
  const extracted=extractPublishedDocument(publicDocument({input,hidden:1}),style);
  assert.equal(extracted.raw.products.length,1);assert.equal(extracted.raw.products[0].id,'51922606');
  assert.equal(extracted.raw.products[0].rubles,'459');assert.equal(extracted.raw.products[0].cents,'00');
  assert.deepEqual(extracted.counts,{matchedProducts:2,visibleProducts:1,capturedProducts:1,productsTruncated:false,fieldTruncations:0,rawFieldTruncations:0,titleElements:1,periodElements:1});
  assert.equal(JSON.stringify(extracted).includes('NOT_CAPTURED'),false);
  const changed=extractPublishedDocument(publicDocument({input,renamed:true}),style);
  assert.equal(changed.raw.products.length,0);assert.equal(changed.raw.title,input.title);assert.equal(changed.raw.period,input.period);
});

test('DOM extraction preserves the 200 card bound and identifies oversized public fields',()=>{
  const input=raw();input.products=Array.from({length:230},(_,index)=>({...input.products[0],id:String(51922000+index),name:'Я'.repeat(10_000)}));
  const extracted=extractPublishedDocument(publicDocument({input}),style);
  assert.equal(extracted.raw.products.length,200);assert.equal(extracted.raw.products[0].name.length,401);
  assert.equal(extracted.counts.matchedProducts,230);assert.equal(extracted.counts.productsTruncated,true);
  assert.equal(extracted.counts.fieldTruncations,200);
});

test('diagnostics allowlist and redact public samples with a strict serialization budget',()=>{
  const input=raw();input.products=Array.from({length:200},(_,index)=>({...input.products[0],id:String(51922000+index),
    name:'Я'.repeat(401),endText:'Я'.repeat(128),rubles:'Я'.repeat(64),cents:'Я'.repeat(16),oldRubles:'Я'.repeat(64),oldCents:'Я'.repeat(16),privateCookie:'NEVER'}));
  const extracted=extractPublishedDocument(publicDocument({input}),style);
  extracted.raw.title='Bearer fixturecredential https://example.test/?secret=fixture';
  extracted.raw.period='session=fixturesecret';extracted.cookies='NEVER';
  const report=diagnosticCapture(extracted,{httpStatus:200,exactLanding:false,observedAt:at});
  const json=serializeDiagnostic(report);assert.ok(Buffer.byteLength(json)<MAX_DIAGNOSTIC_BYTES);
  assert.equal(report.raw.products.length,MAX_DIAGNOSTIC_PRODUCTS);assert.equal(report.rawProductsOmitted,176);
  for(const forbidden of ['fixturecredential','fixturesecret','example.test','NEVER','cookies'])assert.equal(json.includes(forbidden),false);
  assert.equal(report.exactLanding,false);assert.equal(report.httpStatus,200);
  assert.throws(()=>serializeDiagnostic({unknown:'x'.repeat(MAX_DIAGNOSTIC_BYTES)}),/diagnostic_size_limit/u);
});

async function collectorFixture(options={}) {
  const events=[],reports=[],statuses=[],data=[],lines=[],navigation=[];
  const input=options.input??raw(),doc=publicDocument({input,renamed:options.renamed});
  if(options.documentTitle)doc.title=options.documentTitle;
  const page={setDefaultTimeout:value=>events.push(['timeout',value]),url:()=>options.landing??PUBLISHED_URL,
    goto:async(url,settings)=>{navigation.push({url,settings});return {status:()=>options.httpStatus??200,ok:()=> (options.httpStatus??200)>=200&&(options.httpStatus??200)<300};},
    locator:selector=>selector==='body'?{innerText:async()=>options.body??''}:{first:()=>({waitFor:async()=>{events.push(['wait-selector']);if(options.renamed)throw Error('fixture missing selector');}})},
    evaluate:async fn=>{events.push(['extract']);return options.extracted??fn(doc,style);}};
  const previous=options.previous??{status:'unavailable',lastAttemptAt:'2026-10-16T20:00:00Z',sourceUrl:PUBLISHED_URL,scope:PUBLISHED_SCOPE};
  const result=await collectPublishedWithDiagnostics({
    now:()=>Date.parse(at),readStatus:async()=>previous,
    launch:async()=>{events.push(['launch']);return {newPage:async()=>page,close:async()=>{events.push(['close']);if(options.closeFails)throw Error('fixture cleanup failure');}};},
    writeData:async snapshot=>{events.push(['data']);if(options.dataFails)throw Error('fixture data failure');data.push(structuredClone(snapshot));},
    writeStatus:async status=>{events.push(['status']);statuses.push(structuredClone(status));},
    writeDiagnostics:async report=>{events.push(['diagnostic',report.stage]);if(options.diagnosticFails)throw Error('fixture artifact failure');reports.push(structuredClone(report));},
    emit:line=>lines.push(line)
  });
  return {result,events,reports,statuses,data,lines,navigation,previous};
}

test('blocked published source stays paused without launching, navigating, writing status or changing the retained feed',async()=>{
  const previous={status:'blocked',lastAttemptAt:'2026-10-16T20:00:00Z',reason:'source_challenge'};
  const fixture=await collectorFixture({previous});assert.equal(fixture.result.skipped,true);
  assert.equal(fixture.navigation.length,0);assert.equal(fixture.events.some(([event])=>event==='launch'),false);
  assert.equal(fixture.data.length,0);assert.equal(fixture.statuses.length,0);assert.deepEqual(fixture.result.status,previous);
  assert.equal(fixture.reports.at(-1).stage,'skipped-existing-block');assert.equal(fixture.reports.at(-1).sourceNavigations,0);
  const unavailableArtifact=await collectorFixture({previous,diagnosticFails:true});
  assert.deepEqual(unavailableArtifact.result.status,previous);assert.equal(unavailableArtifact.navigation.length,0);
  assert.equal(unavailableArtifact.statuses.length,0);assert.equal(JSON.parse(unavailableArtifact.lines[0]).diagnosticWriteFailed,true);
});

test('challenge statuses and public challenge text halt before product wait/admission and persist the block',async()=>{
  for(const options of [{httpStatus:403},{httpStatus:429},{body:'SmartCaptcha'},{body:'Подтвердите, что вы не робот'}]){
    const fixture=await collectorFixture(options);assert.equal(fixture.navigation.length,1);assert.equal(fixture.data.length,0);
    assert.equal(fixture.statuses.at(-1).status,'blocked');assert.equal(fixture.statuses.at(-1).reason,'source_challenge');
    assert.equal(fixture.events.some(([event])=>event==='wait-selector'),false);
    assert.equal(fixture.reports.at(-1).parser,undefined);assert.equal(fixture.reports.at(-1).httpStatus,options.httpStatus??200);
    assert.ok(fixture.events.findIndex(([event])=>event==='diagnostic')<fixture.events.findIndex(([event])=>event==='close'));
  }
});

test('unavailable response or wrong exact landing is captured but cannot admit public prices',async()=>{
  for(const options of [{httpStatus:503},{landing:'https://example.test/?access_token=NEVER'}]){
    const fixture=await collectorFixture(options);assert.equal(fixture.navigation.length,1);assert.equal(fixture.data.length,0);
    assert.equal(fixture.statuses.at(-1).status,'unavailable');assert.equal(fixture.reports.at(-1).parser,undefined);
    assert.equal(fixture.reports.at(-1).exactLanding,!options.landing);assert.equal(fixture.lines.join('').includes('NEVER'),false);
  }
});

test('changed layout records title/period/zero visible products after selector failure before closing',async()=>{
  const fixture=await collectorFixture({renamed:true});const report=fixture.reports.at(-1);
  assert.equal(report.httpStatus,200);assert.equal(report.exactLanding,true);assert.equal(report.raw.title,raw().title);
  assert.equal(report.raw.period,raw().period);assert.equal(report.counts.matchedProducts,0);
  assert.deepEqual(report.parser.reasons,['products_empty']);assert.equal(report.failure,'visible_product_selector_unavailable');
  assert.equal(fixture.data.length,0);assert.equal(fixture.statuses.at(-1).status,'unavailable');
  assert.ok(fixture.events.findIndex(([event,stage])=>event==='diagnostic'&&stage==='captured')<fixture.events.findIndex(([event])=>event==='close'));
});

test('missing period and invalid prices retain old data and explain zero admission without substituting zero prices',async()=>{
  for(const [input,reason] of [{...raw(),period:''}, {...raw(),products:[{...raw().products[0],cents:''}]}].map((input,index)=>[input,index?'no_current_valid_products':'period_missing'])){
    const fixture=await collectorFixture({input});assert.equal(fixture.data.length,0);
    assert.equal(fixture.statuses.at(-1).reason,'no_verified_published_prices');
    assert.ok(fixture.reports.at(-1).parser.reasons.includes(reason));assert.equal(fixture.reports.at(-1).parser.acceptedProducts,0);
  }
});

test('successful capture uses exactly one ordinary navigation, preserves deadlines and writes only the production snapshot',async()=>{
  const fixture=await collectorFixture();assert.deepEqual(fixture.data,[parsePublishedCatalogue(raw())]);
  assert.equal(fixture.statuses.at(-1).status,'collected');assert.equal(fixture.statuses.at(-1).uniqueProducts,1);
  assert.deepEqual(fixture.navigation,[{url:PUBLISHED_URL,settings:{waitUntil:'domcontentloaded',timeout:30_000}}]);
  assert.ok(fixture.events.some(([event,value])=>event==='timeout'&&value===15_000));
  const captured=fixture.events.findIndex(([event,stage])=>event==='diagnostic'&&stage==='captured');
  const parsed=fixture.events.findIndex(([event,stage])=>event==='diagnostic'&&stage==='parsed');
  assert.ok(captured>=0&&captured<parsed&&parsed<fixture.events.findIndex(([event])=>event==='data'));
  assert.ok(parsed<fixture.events.findIndex(([event])=>event==='close'));
});

test('cleanup failure cannot erase captured raw evidence or the actual collected/unavailable status',async()=>{
  for(const input of [raw(),{...raw(),period:''}]){
    const fixture=await collectorFixture({input,closeFails:true});assert.equal(fixture.reports.at(-1).cleanupFailed,true);
    assert.equal(fixture.reports.at(-1).raw.title,input.title);assert.equal(fixture.statuses.length,1);
    assert.equal(fixture.statuses[0].status,input.period?'collected':'unavailable');assert.equal(fixture.data.length,input.period?1:0);
    assert.ok(fixture.events.findIndex(([event,stage])=>event==='diagnostic'&&stage==='captured')<fixture.events.findIndex(([event])=>event==='close'));
  }
});

test('diagnostic persistence and data-write failures fail closed without replacing a retained snapshot',async()=>{
  for(const options of [{diagnosticFails:true},{dataFails:true}]){
    const fixture=await collectorFixture(options);assert.equal(fixture.data.length,0);assert.equal(fixture.statuses.at(-1).status,'unavailable');
    assert.equal(fixture.events.some(([event])=>event==='close'),true);
    if(options.diagnosticFails)assert.equal(JSON.parse(fixture.lines.at(-1)).diagnosticWriteFailed,true);
    else assert.equal(fixture.reports.at(-1).raw.products.length,1);
  }
});

test('oversized document fields are bounded and fail closed rather than being truncated into an admitted price',async()=>{
  const input=raw();input.products[0].name='Я'.repeat(10_000);
  const fixture=await collectorFixture({input});assert.equal(fixture.data.length,0);
  assert.equal(fixture.reports.at(-1).failure,'document_field_limit');assert.equal(fixture.reports.at(-1).raw.products[0].name.length,401);
  assert.ok(Buffer.byteLength(fixture.lines.at(-1))<MAX_DIAGNOSTIC_BYTES);
});

test('truncating a diagnostic-only document title never changes production parser admission',async()=>{
  const fixture=await collectorFixture({documentTitle:'Я'.repeat(10_000)});
  assert.deepEqual(fixture.data,[parsePublishedCatalogue(raw())]);assert.equal(fixture.reports.at(-1).documentTitle.length,256);
  assert.equal(fixture.reports.at(-1).counts.fieldTruncations,1);assert.equal(fixture.reports.at(-1).counts.rawFieldTruncations,0);
});

test('parser exception keeps the prior captured evidence through cleanup failure without changing the feed',async()=>{
  const extracted={...extractPublishedDocument(publicDocument(),style),raw:{...raw(),products:[null]}};
  const fixture=await collectorFixture({extracted,closeFails:true});const report=fixture.reports.at(-1);
  assert.deepEqual(report.parser.reasons,['parser_exception']);assert.equal(report.cleanupFailed,true);
  assert.equal(report.raw.products.length,1);assert.equal(fixture.data.length,0);
  assert.equal(fixture.statuses.at(-1).reason,'no_verified_published_prices');
  assert.ok(fixture.events.findIndex(([event,stage])=>event==='diagnostic'&&stage==='captured')<fixture.events.findIndex(([event,stage])=>event==='diagnostic'&&stage==='parsed'));
});
