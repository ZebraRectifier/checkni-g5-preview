import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

// Component fixtures use the shipping stylesheet cascade and renderers. The
// amounts below are synthetic, not current retailer prices or availability.
const index=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const betaMarkup=index.match(/<section id="beta-live-section"[\s\S]*?<\/section>/u)?.[0];
if(!betaMarkup)throw new Error('The shipping beta panel was not found');

async function fixture(page,theme,mobile,reducedMotion){
 await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:720});
 await page.emulateMedia({colorScheme:theme,reducedMotion});
 const externalRequests=[];
 await page.route('**/*',route=>{
  if(['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname))return route.continue();
  externalRequests.push(route.request().url());return route.abort();
 });
 await page.route('**/__hori-panel-contrast__',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/theme-violet.css"><link rel="stylesheet" href="/src/components/hori-reference-v13.css"></head><body class="hori-workspace" data-hori-theme="${theme}"><header class="hori-header"></header><div class="hori-stage"></div><main class="app-shell" data-hori-view="basket"><div class="hori-shop-pane" id="panels"><div id="basket-fixture"></div>${betaMarkup}</div></main></body></html>`}));
 await page.goto('/__hori-panel-contrast__');
 await page.evaluate(async()=>{
  const [{renderBasketView},{createComparisonResult,createObservedComparisonResult},{createSelectedComparisonStores}]=await Promise.all([
   import('/src/components/BasketView.mjs'),import('/src/components/ComparisonResult.mjs'),import('/src/components/SelectedComparisonStores.mjs')
  ]);
  renderBasketView(document.querySelector('#basket-fixture'),[{id:'fixture-milk',name:'Тестовое молоко',unit:'1 л',quantity:1}],{comparisonMode:'observed',onCompare(){},onIncrement(){},onDecrement(){},onRemove(){}});
  const output=document.querySelector('#comparison-output');
  const mock=createComparisonResult({winner:{storeId:'fixture',storeName:'Тестовый магазин · MOCK',totalMinor:10000,coverage:{coveredItems:1,totalItems:1},isMock:true}});
  const insufficient=createObservedComparisonResult({conclusion:{kind:'insufficient-coverage'},candidates:[]});
  const observed=createObservedComparisonResult({conclusion:{kind:'observed-total-only',candidateId:'fixture',totalMinor:10000},candidates:[{candidateId:'fixture',retailerId:'lenta',storeName:'Тестовый вариант · fixture',priceCoverage:{coveredItems:1,totalItems:1},sources:[{sourceName:'Синтетическая фикстура'}],locationTruthLevel:'city',localityName:'Тестовый город',priceConditions:['regular'],salesChannel:'online',availability:'unknown',lines:[{observedAt:'2026-10-19T08:30:00Z'}]}]});
  if(!mock||!insufficient||!observed)throw new Error('Comparison fixture did not render');
  mock.id='mock-result-fixture';observed.id='observed-result-fixture';
  output.append(mock,insufficient,observed);
  const progress=document.createElement('p');progress.className='comparison-progress';progress.textContent='Проверяем доверенные наблюдения цен…';output.append(progress);
  // The app's message controller uses this same focusable result structure.
  const state=document.createElement('section');state.className='future-step comparison-result comparison-state';state.tabIndex=-1;
  const title=document.createElement('h2');title.textContent='Проверка не завершена';
  const note=document.createElement('p');note.textContent='Повторите попытку позже.';state.append(title,note);output.append(state);
  document.querySelector('#panels').append(createSelectedComparisonStores({valid:true,mode:'selected',stores:[{name:'Тестовый магазин',address:'Тестовый адрес',retailerId:'globus'}]},{onEdit(){}}));
  document.querySelector('#beta-live-section').hidden=false;
  await document.fonts.ready;
 });
 await expect(page.locator('.future-step')).toHaveCount(7);
 await expect(page.locator('#beta-live-section')).toBeVisible();
 return externalRequests;
}

// Measure the painted pair, not two CSS token strings. Translucent foregrounds
// and every ancestor background are composited before WCAG relative luminance.
// Refuse unsupported image/opacity layers instead of silently assuming white.
async function contrasts(locator,focus=false,disabled=null){
 return locator.evaluate((root,{focus,disabled})=>{
  // Read in the same task as the state change, before the next paint. A short
  // transition must not briefly pair new text with the previous background.
  if(disabled!==null)root.disabled=disabled;
  if(focus)root.focus();
  const rgba=value=>{
   if(!/^rgba?\(/u.test(value))throw new Error(`Unsupported computed colour: ${value}`);
   const values=value.match(/[\d.]+/gu).map(Number);
   return [values[0],values[1],values[2],values[3]??1];
  };
  const over=(front,back)=>{
   const alpha=front[3]+back[3]*(1-front[3]);
   return [...front.slice(0,3).map((channel,i)=>(channel*front[3]+back[i]*back[3]*(1-front[3]))/alpha),alpha];
  };
  const background=element=>{
   const layers=[];
   for(let current=element;current;current=current.parentElement){
    const style=getComputedStyle(current);
    if(style.backgroundImage!=='none'||Number(style.opacity)!==1)throw new Error(`Unsupported paint layer on ${current.className}`);
    layers.push(rgba(style.backgroundColor));
   }
   return layers.reverse().reduce((back,front)=>over(front,back),[255,255,255,1]);
  };
  const luminance=colour=>colour.slice(0,3).map(channel=>{
   const value=channel/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
  }).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0);
  const ratio=(front,back)=>{
   const light=luminance(over(front,back)),dark=luminance(back);
   return (Math.max(light,dark)+.05)/(Math.min(light,dark)+.05);
  };
  if(focus){
   const style=getComputedStyle(root),surface=background(root.parentElement);
   return {ratio:ratio(rgba(style.outlineColor),surface),width:parseFloat(style.outlineWidth),style:style.outlineStyle,offset:parseFloat(style.outlineOffset),visible:root.matches(':focus-visible')};
  }
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),results=[];
  let node;
  while((node=walker.nextNode())){
   const element=node.parentElement,text=node.textContent.trim();
   if(!text||!element.getClientRects().length)continue;
   const style=getComputedStyle(element);
   if(style.visibility!=='visible')continue;
   results.push({text:text.slice(0,100),element:element.tagName+'.'+element.className,ratio:ratio(rgba(style.color),background(element))});
  }
  return results;
 },{focus,disabled});
}

function expectReadable(readings){
 expect(readings.length).toBeGreaterThan(0);
 for(const reading of readings)expect(reading.ratio,`${reading.element}: ${reading.text}`).toBeGreaterThanOrEqual(4.5);
}

for(const theme of ['light','dark']){
 test(`${theme} comparison and beta panels retain readable text, links, actions and keyboard focus`,async({page},info)=>{
 for(const reducedMotion of ['no-preference','reduce'])await test.step(`motion preference: ${reducedMotion}`,async()=>{
  const externalRequests=await fixture(page,theme,info.project.name.includes('mobile'),reducedMotion);
  const panels=page.locator('#panels');
  const normal=[];
  for(const panel of await panels.locator('.beta-live-card,.future-step,.comparison-progress').all())normal.push(...await contrasts(panel));
  expect(normal.length).toBeGreaterThan(25);
  expectReadable(normal);
  // Check actual hover paint as well: the legacy aggregator hover and primary
  // gradient previously introduced a different, unreadable foreground pair.
  for(const selector of ['.aggregator-link','#compare-basket','#beta-live-button','#observed-result-fixture .primary-button']){
   const action=page.locator(selector).first();
   await action.hover();expectReadable(await contrasts(action));
  }
  const compare=page.locator('#compare-basket');
  for(const disabled of [true,false]){
   expectReadable(await contrasts(compare,false,disabled));
   for(let frame=0;frame<3;frame++){
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    expectReadable(await contrasts(compare));
   }
  }
  await page.keyboard.press('Tab');
  for(const selector of ['#compare-basket','.comparison-step .text-button','.aggregator-link','.comparison-state','[aria-label="Адреса для сравнения"] button','#beta-live-button']){
   const target=page.locator(selector).first();
   const outline=await contrasts(target,true);
   expect(outline.visible,selector+' has keyboard focus').toBe(true);
   expect(outline.style,selector+' outline is painted').toBe('solid');
   expect(outline.width,selector+' outline width').toBeGreaterThanOrEqual(2);
   expect(outline.offset,selector+' outline lies on its parent surface').toBeGreaterThanOrEqual(2);
   expect(outline.ratio,selector+' outline versus adjacent surface').toBeGreaterThanOrEqual(3);
  }
  expect(externalRequests).toEqual([]);
 });
 });
}
