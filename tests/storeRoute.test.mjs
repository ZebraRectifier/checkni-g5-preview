import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { yandexStoreRouteUrl } from '../src/navigation/storeRoute.mjs';

test('store route uses only finite admitted coordinates', () => {
  assert.equal(yandexStoreRouteUrl({lat:55.7961,lon:49.1064}),
    'https://yandex.ru/maps/?rtext=~55.7961%2C49.1064&rtt=auto');
  for(const point of [null,{}, {lat:91,lon:49}, {lat:55,lon:181}, {lat:'55',lon:49}, {lat:55,lon:Infinity}]){
    assert.equal(yandexStoreRouteUrl(point),null);
  }
});

test('all five regional directories produce a route without implying catalog access', () => {
  for(const [slug,id] of [['kazan','010852'],['saint-petersburg','011601'],['yekaterinburg','021828'],['novosibirsk','020427'],['nizhny-novgorod','067036']]){
    const directory=JSON.parse(fs.readFileSync(new URL(`../src/data/nearby-regions/${slug}.json`,import.meta.url),'utf8'));
    const point=directory.stores.find(row=>row.id===`official:magnit:${id}`);
    assert.ok(point,`${slug} reviewed point`);
    assert.match(yandexStoreRouteUrl(point),/^https:\/\/yandex\.ru\/maps\/\?rtext=~/u);
    assert.equal(Boolean(point.catalog),false,`${slug} remains geography-only`);
  }
});
