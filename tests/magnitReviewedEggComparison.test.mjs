import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeRetailRow} from '../src/ports/retailCatalogPort.mjs';
import {resolveRegisteredMagnitStore} from '../src/data/registeredMagnitStores.mjs';
import {sourceScopedRetailListSelection} from '../src/catalog/sourceScopedRetailList.mjs';
import {prepareManualCatalogComparison} from '../src/runtime/manualCatalogComparison.mjs';
import {catalogPurchaseUnit} from '../src/core/catalogDraft.mjs';
const {sourceProduct:source}=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/magnit-eggs-508831-20261103.json',import.meta.url),'utf8'));
const store=resolveRegisteredMagnitStore({shopCode:'508831'});
const raw={retailer_id:source.retailerId,store_id:source.storeId,store_name:source.storeName,
 locality_id:source.localityId,locality_name:source.localityName,source_product_id:source.sourceProductId,
 name:source.name,weight_text:source.weightText,price_minor:source.priceMinor,currency:source.currency,
 price_condition:source.priceCondition,sales_channel:source.salesChannel,availability:source.availability,
 product_url:source.productUrl,source_url:source.sourceUrl,observed_at:source.observedAt,
 scope_binding:source.scopeBinding,binding_id:source.bindingId,scope_evidence_url:source.scopeEvidenceUrl,
 location_label:source.locationLabel,minimum_quantity:1,quantity_semantics:{}};
const card=()=>normalizeRetailRow(raw,{retailerId:'magnit',store});

test('retained ten-egg source count survives list confirmation and can prepare a comparison',()=>{
 assert.equal(source.metadataSource,'original-public-navigation-response');
 assert.equal(source.weightText,'10шт');
 const input=card(),selected=sourceScopedRetailListSelection(input);
 assert.ok(selected);
 assert.equal(catalogPurchaseUnit(selected.card).amount,10);
 assert.equal(catalogPurchaseUnit(selected.card).dimension,'piece');
 assert.equal(selected.card.priceMinor,source.priceMinor);
 assert.equal(selected.card.observedAt,source.observedAt);
 assert.equal(selected.card.availability,'unknown');
 const result=prepareManualCatalogComparison([{...selected.product,quantity:2}]);
 assert.equal(result.kind,'ready');
 assert.deepEqual(result.request.bindings.map(b=>[b.sourceProductId,b.groupKey]),[['3454700001','eggs']]);
 assert.equal(result.request.scopes[0].storeId,'magnit-508831');
 assert.doesNotMatch(JSON.stringify(selected.product),/priceMinor|observedAt|availability/);
});

test('egg count review cannot admit a changed count, title, address or unknown SKU',()=>{
 const original=card();
 for(const patch of [{unit:'20 шт'},{name:source.name.replace('10шт','20шт')},
  {storeId:'magnit-777885'},{sourceProductId:'3454700002'},
  {productUrl:source.productUrl.replace('508831','777885')},
  {currency:'USD'},{priceMinor:0}]) assert.equal(sourceScopedRetailListSelection({...original,...patch}),null);
 const selected=sourceScopedRetailListSelection(original).product;
 const unknown={...selected,id:selected.id.replace('3454700001','3454700002')};
 assert.equal(prepareManualCatalogComparison([{...selected,quantity:2},{...unknown,quantity:1}]).kind,'needs_review');
});
