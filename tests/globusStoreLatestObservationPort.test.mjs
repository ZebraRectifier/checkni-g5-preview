import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGlobusStorePicker, globusObservationCopy } from '../src/components/GlobusStorePicker.mjs';
import { resolveGlobusMoscowRegionStore } from '../src/data/globusMoscowRegionStores.mjs';
import {
  classifyGlobusLatestObservation, GLOBUS_RECENT_PRICE_MAX_AGE_MS,
  readGlobusStoreLatestObservation
} from '../src/ports/globusStoreLatestObservationPort.mjs';
import { GLOBUS_CATALOG_PRICE_MAX_AGE_MS } from '../src/ports/selectedGlobusCatalogOffersPort.mjs';

const now = Date.parse('2026-10-26T21:30:00.000Z');
const found = observedAt => ({ kind: 'found', observedAt });

function mountPicker(t, options = {}, stage = 'home') {
  const previous = globalThis.document;
  class Element {
    constructor() { this.children = []; this.style = {}; this.value = ''; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = String(value); }
    addEventListener() {}
  }
  globalThis.document = { createElement: () => new Element(), addEventListener() {},
    body: { dataset: { pixelStage: stage } } };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const picker = createGlobusStorePicker(options);
  const note = picker.element.children.find(child => child.id === 'globus-store-note');
  return { picker, note, store: resolveGlobusMoscowRegionStore('5011') };
}

test('picker keeps catalogue availability separate from observation freshness across updates', t => {
  const { picker, note, store } = mountPicker(t);
  const update = (status, hasCategories) => picker.update({ visible: true, store, status, hasCategories });
  update('loading', false);
  assert.equal(note.textContent, 'Загружаем каталог выбранного адреса…');
  update('ready', false);
  assert.match(note.textContent, /каталог временно не загрузился/u);
  update('ready', true);
  assert.doesNotMatch(note.textContent, /каталог временно не загрузился/u);
  assert.match(note.textContent, /Дата последнего наблюдения пока не проверена/u);
  update('ready', false);
  assert.match(note.textContent, /каталог временно не загрузился/u);
});

test('a late old-price observation preserves the loaded catalogue without claiming fresh prices', async t => {
  const calls = [];
  const { picker, note, store } = mountPicker(t, { readLatestObservation: async id => {
    calls.push(id);
    return found('2020-01-01T00:00:00Z');
  } }, 'store');
  picker.update({ visible: true, store, status: 'ready', hasCategories: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['5011']);
  assert.doesNotMatch(note.textContent, /каталог временно не загрузился/u);
  assert.match(note.textContent, /Свежих цен по адресу нет/u);
  assert.match(note.textContent, /01\.01\.2020/u);
  assert.match(note.textContent, /Наличие неизвестно/u);
});

test('picker distinguishes stale Pushkino evidence from recent exact-address observations', () => {
  assert.equal(GLOBUS_RECENT_PRICE_MAX_AGE_MS, GLOBUS_CATALOG_PRICE_MAX_AGE_MS);
  const pushkino = found('2026-10-18T15:22:08.674Z');
  const krasnogorsk = found('2026-10-26T21:27:21.638Z');
  const medvedkovo = found('2026-10-26T21:28:18.236Z');
  assert.equal(classifyGlobusLatestObservation(pushkino, now), 'dated');
  assert.equal(classifyGlobusLatestObservation(krasnogorsk, now), 'recent');
  assert.equal(classifyGlobusLatestObservation(medvedkovo, now), 'recent');
  assert.match(globusObservationCopy(pushkino, now).note, /18\.10\.2026/u);
  assert.match(globusObservationCopy(pushkino, now).note, /Свежих цен по адресу нет/u);
  assert.match(globusObservationCopy(krasnogorsk, now).note, /Другие товары могут быть старее/u);
  assert.equal(globusObservationCopy(pushkino, now).option, 'свежих цен нет');
  assert.equal(globusObservationCopy(medvedkovo, now).option, 'есть недавнее наблюдение');
});

test('future, absent and unavailable metadata never claim current prices', () => {
  assert.equal(classifyGlobusLatestObservation(found('2026-10-26T21:31:00Z'), now), 'unknown');
  assert.equal(globusObservationCopy({ kind: 'missing' }, now).option, 'наблюдений цен нет');
  assert.equal(globusObservationCopy({ kind: 'unknown' }, now).option, 'дата цен не проверена');
  assert.equal(globusObservationCopy({ kind: 'loading' }, now).option, 'проверяем дату цен');
});

test('latest-observation read is bounded to one exact active positive-price store row', async () => {
  const calls=[];
  const result=await readGlobusStoreLatestObservation('5014',{fetchImpl:async(url,options)=>{
    const parsed=new URL(url);calls.push({url:parsed,options});
    return new Response(JSON.stringify([{retailer_id:'globus',store_id:'globus-store-5014',
      observed_at:'2026-10-18T15:22:08.674Z',price_minor:10000}]),{status:200,headers:{'content-type':'application/json'}});
  }});
  assert.deepEqual(result,found('2026-10-18T15:22:08.674Z'));
  assert.equal(calls.length,1);
  const {url,options}=calls[0];
  assert.equal(url.origin,'https://cxpneczhczashanbetgj.supabase.co');
  assert.equal(url.pathname,'/rest/v1/retail_catalog_items');
  assert.equal(url.searchParams.get('retailer_id'),'eq.globus');
  assert.equal(url.searchParams.get('store_id'),'eq.globus-store-5014');
  assert.equal(url.searchParams.get('active'),'eq.true');
  assert.equal(url.searchParams.get('price_minor'),'gt.0');
  assert.equal(url.searchParams.get('order'),'observed_at.desc');
  assert.equal(url.searchParams.get('limit'),'1');
  assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
  assert.ok(options.signal instanceof AbortSignal);
});

test('metadata errors and mismatched rows fail closed', async () => {
  assert.deepEqual(await readGlobusStoreLatestObservation('invalid'),{kind:'unknown'});
  const respond=body=>()=>Promise.resolve(new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}}));
  assert.deepEqual(await readGlobusStoreLatestObservation('5014',{fetchImpl:respond([])}),{kind:'missing'});
  assert.deepEqual(await readGlobusStoreLatestObservation('5014',{fetchImpl:respond([{retailer_id:'globus',store_id:'globus-store-5011',observed_at:'2026-10-18T15:22:08Z',price_minor:1}])}),{kind:'unknown'});
  assert.deepEqual(await readGlobusStoreLatestObservation('5014',{fetchImpl:async()=>{throw Error('offline');}}),{kind:'unknown'});
});
