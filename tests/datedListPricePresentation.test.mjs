import test from 'node:test';
import assert from 'node:assert/strict';
import {hasDatedListPrice} from '../src/components/PixelProductCard.mjs';
import {SOURCE_CATALOG_LIST_MAX_AGE_MS as DAY} from '../src/catalog/sourceCatalogListAdmission.mjs';
import {getReviewedRetailBasketProduct} from '../src/catalog/reviewedRetailBasket.mjs';
import {quoteCatalogDraft} from '../src/core/catalogDraft.mjs';
const now=Date.parse('2026-11-07T09:00:00Z');

test('dated list warning uses the existing day window without declaring missing or future dates fresh',()=>{
 assert.equal(hasDatedListPrice({observedAt:new Date(now-DAY).toISOString()},now),true);
 assert.equal(hasDatedListPrice({observedAt:new Date(now-DAY+1).toISOString()},now),false);
 assert.equal(hasDatedListPrice({observedAt:new Date(now-DAY-1).toISOString()},now),true);
 for(const observedAt of [undefined,null,'invalid','2027-01-01T00:00:00Z'])assert.equal(hasDatedListPrice({observedAt},now),false);
});

test('a dated reviewed SKU keeps only list identity and Core still marks its quote as dated',()=>{
 const card={retailerId:'globus',sourceProductId:'000000000000026730_ST',name:'Молоко Parmalat 3,5%, 1л',unit:'1 л',
  productUrl:'https://www.globus.ru/products/moloko-parmalat-35-1l-26730_ST/',priceMinor:14199,currency:'RUB',
  observedAt:'2026-11-01T20:43:40.061Z'};
 const product=getReviewedRetailBasketProduct(card);
 assert.equal(product.id,'globus-milk-parmalat-35-1l');
 assert.doesNotMatch(JSON.stringify(product),/priceMinor|observedAt|availability|sourceUrl/);
 assert.equal(hasDatedListPrice(card,now),true);
 const quote=quoteCatalogDraft([{card,product,quantity:1}],{nowMs:now});
 assert.equal(quote.allRecent,false);assert.equal(quote.lines[0].freshness,'dated');assert.equal(quote.winner,null);
 // The warning never broadens the identity admission for an unknown SKU.
 assert.equal(getReviewedRetailBasketProduct({...card,sourceProductId:'unknown'}),null);
});
