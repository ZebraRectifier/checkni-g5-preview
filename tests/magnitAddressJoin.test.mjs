import test from'node:test';import assert from'node:assert/strict';
import{exactMagnitAddressKey as key,uniqueMagnitAddressBindings}from'../src/intelligence/magnitAddressJoin.mjs';
import fs from'node:fs/promises';import{nearbyCatalogBinding}from'../src/intelligence/nearbyShopping.mjs';

test('exact city, named road and full building identifiers support prefix/suffix and explicit address abbreviations',()=>{
 assert.equal(key('г Москва, аллея Берёзовая, д 17 к 2'),key('Москва, Берёзовая аллея, 17к2'));
 assert.equal(key('Москва г, ул. Советская, дом № 6, корпус 1'),key('Москва, Советская улица, 6к1'));
 assert.equal(key('Московская обл., г Мытищи, пр-кт Астрахова, д 4'),key('Мытищи, проспект Астрахова, 4'));
 for(const other of ['Москва, Берёзовая аллея, 17','Москва, Берёзовая аллея, 17к3','Мытищи, Берёзовая аллея, 17к2','Москва, Берёзовая улица, 17к2'])
  assert.notEqual(key('г Москва, аллея Берёзовая, д 17 к 2'),key(other));
});

test('incomplete, ambiguous or unparsed address components cannot create a binding',()=>{
 for(const value of ['Советская улица, 6','Москва, неизвестно, 6','Москва, Советская улица','Москва, Советская улица, 6 или 8','Москва, Советская улица, 6, рядом с парком'])assert.equal(key(value),null,value);
 const stores=[{shopCode:'1',address:'г Москва, ул Советская, д 6'},{shopCode:'2',address:'Москва г, улица Советская, дом 6'}];
 assert.equal(uniqueMagnitAddressBindings(stores).get(key(stores[0].address)),null);
});

test('new exact connections resolve and forged sourceAddress cannot redirect a different house to a registered shop',async()=>{
 const directory=JSON.parse(await fs.readFile(new URL('../src/data/nearbyGroceryStores.json',import.meta.url),'utf8'));
 const evidence=JSON.parse(await fs.readFile(new URL('../artifacts/nearby-shopping/catalog-geography-joins-20261024.json',import.meta.url),'utf8'));
 assert.equal(evidence.added.length,6);assert.equal(evidence.priceEvidence,false);assert.equal(evidence.priceRefreshPerformed,false);
 for(const added of evidence.added){
  const point=directory.stores.find(p=>p.id===added.pointId);assert.equal(nearbyCatalogBinding(point)?.store.shopCode,added.shopCode);
  const wrong=point.address+', рядом с парком';
  assert.equal(nearbyCatalogBinding({...point,address:wrong,catalogBinding:{...point.catalogBinding,sourceAddress:wrong}}),null);
  assert.equal(nearbyCatalogBinding({...point,address:point.address.replace(/\d+[а-яa-z]?$/iu,'999'),catalogBinding:{...point.catalogBinding,sourceAddress:point.address.replace(/\d+[а-яa-z]?$/iu,'999')}}),null);
 }
});
