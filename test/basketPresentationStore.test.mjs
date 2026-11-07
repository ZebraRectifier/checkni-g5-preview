import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberBasketPresentation as save,basketPresentation as read,retainBasketPresentations as prune} from '../src/state/basketPresentationStore.mjs';
const storage=()=>{const m=new Map;return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)}};
const item=(id='milk')=>({id,name:'Молоко',unit:'1 л'});
const card={id:'retail:magnit:magnit-123:sku',retailerId:'magnit',priceMinor:9999,observedAt:'2026-11-07T01:00:00Z',sourceUrl:'https://magnit.ru/product/sku',imageUrl:'https://magnit.ru/photo.jpg',unit:'1 л'};
test('exact identity only, source store derived from scoped catalogue ID',()=>{
 const st=storage();save(item('one'),card,st);assert.equal(read(item('one'),st).storeId,'magnit-123');assert.equal(read({...item('one'),unit:'2 л'},st),null);
});
test('mixed stores never retain a misleading single-store price',()=>{
 const st=storage(),it=item('two');save(it,card,st);save(it,{...card,storeId:'another'},st);assert.equal(read(it,st).priceMinor,null);
 save(it,card,st);assert.equal(read(it,st).priceMinor,null);
});
test('storage errors and corrupt data remain safe',()=>{
 const bad={getItem(){throw Error()},setItem(){throw Error()}};assert.equal(save(item('three'),card,bad),true);assert.equal(read(item('three'),bad).priceMinor,9999);
 assert.equal(read(item('absent'),{getItem:()=>'{bad'}),null);
});
test('zero prices, missing dates and unsafe image urls are not promoted',()=>{
 const st=storage(),it=item('four');save(it,{...card,priceMinor:0,observedAt:'invalid',imageUrl:'javascript:alert(1)'},st);
 assert.equal(read(it,st).priceMinor,null);assert.equal(read(it,st).observedAt,null);assert.equal(read(it,st).imageUrl,null);
});
test('deleted metadata is removed from persisted records',()=>{
 const st=storage(),it=item('five');save(it,card,st);prune([],st);assert.equal(read(it,st),null);assert.equal(st.getItem('checkni.basket.presentation.v1'),'[]');
});
