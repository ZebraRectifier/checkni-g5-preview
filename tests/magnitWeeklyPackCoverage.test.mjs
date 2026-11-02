import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeRetailRow} from '../src/ports/retailCatalogPort.mjs';
import {weeklyMagnitCard} from '../src/ports/weeklyRetailCatalogPort.mjs';
import {WEEKLY_MAGNIT_IDENTITIES} from '../src/catalog/weeklyMagnitIdentities.mjs';
import {resolveMagnitMoscowStore} from '../src/data/magnitMoscowStores.mjs';
import {createGuidedShoppingPlan,guidedGroupMatches} from '../src/intelligence/guidedShoppingPlan.mjs';
import {createShoppingConversation} from '../src/intelligence/shoppingConversation.mjs';
import {catalogPurchaseUnit,economicalCatalogCards,quoteCatalogDraft} from '../src/core/catalogDraft.mjs';

// Replays retained observed data, not current availability or a live freshness claim.
const fixture=JSON.parse(await readFile(new URL('./fixtures/weekly-retail/magnit-pack-coverage-777885.json',import.meta.url),'utf8'));
const now=Date.parse(fixture.provenance.collectedAt)+1000;
const store=resolveMagnitMoscowStore({shopCode:'777885'});
const normalize=row=>normalizeRetailRow(row,{retailerId:'magnit',store},{nowMs:now});
const plan=createGuidedShoppingPlan('Собери недорогую корзину на неделю для троих Магнит и Перекрёсток',[],createShoppingConversation());
const selectedGroups=cards=>plan.groups.filter(group=>economicalCatalogCards(group,cards.filter(card=>guidedGroupMatches(group,card)),3,7,{nowMs:now}).length)
  .map(group=>group.key);

test('exact reviewed identities recover three missing grocery groups in the retained 777885 response',()=>{
  const ids=new Set(fixture.reviewedIdentities.map(row=>row.sourceProductId));
  const raw=fixture.rows.map(normalize).filter(Boolean);
  const before=raw.map(card=>ids.has(card.sourceProductId)?card:weeklyMagnitCard(card));
  const after=raw.map(weeklyMagnitCard);
  assert.equal(plan.groups.length,15);
  assert.equal(selectedGroups(before).length,6);
  assert.equal(selectedGroups(after).length,9);
  assert.deepEqual(selectedGroups(after).filter(group=>!selectedGroups(before).includes(group)),['pasta','rice','cheese']);
  assert.deepEqual(plan.groups.filter(group=>!selectedGroups(after).includes(group.key)).map(group=>group.key),
    ['mince','eggs','apples','bananas','potatoes','carrots']);
});

test('pack repair changes no observed price, timestamp, condition, address or source evidence',()=>{
  for(const identity of fixture.reviewedIdentities){
    assert.ok(WEEKLY_MAGNIT_IDENTITIES.some(row=>JSON.stringify(row)===JSON.stringify(identity)));
    const raw=fixture.rows.find(row=>row.source_product_id===identity.sourceProductId);
    assert.equal(raw.weight_text,null);assert.deepEqual(raw.quantity_semantics,{});
    const card=normalize(raw),repaired=weeklyMagnitCard(card);
    assert.equal(card.unit,'упаковка');assert.equal(catalogPurchaseUnit(card),null);
    assert.equal(repaired.unit,identity.unit);assert.ok(catalogPurchaseUnit(repaired));
    for(const key of ['id','sourceProductId','priceMinor','observedAt','availability','currency','priceCondition','sourceUrl','productUrl','storeName'])
      assert.equal(repaired[key],card[key],key);
    const quote=quoteCatalogDraft([{card:repaired,quantity:1,product:{id:repaired.id,name:repaired.name,unit:repaired.unit}}],{nowMs:now+3600001});
    assert.equal(quote.allRecent,false);assert.equal(quote.winner,null);
  }
});

test('different SKU, current title, path or selected address cannot inherit the reviewed unit',()=>{
  for(const identity of fixture.reviewedIdentities){
    const card=normalize(fixture.rows.find(row=>row.source_product_id===identity.sourceProductId));
    for(const change of [
      {sourceProductId:'unreviewed'}, {name:card.name+' другой размер'},
      {productUrl:card.productUrl.replace(identity.productPath,identity.productPath+'-other')},
      {productUrl:card.productUrl.replace('shopCode=777885','shopCode=503715')}
    ])assert.equal(catalogPurchaseUnit(weeklyMagnitCard({...card,...change})),null);
    assert.equal(weeklyMagnitCard({...card,unit:'123 г'}).unit,'123 г','do not overwrite contradictory upstream weight');
  }
});

test('ambiguous potato and carrot purchase bases remain unknown, and milk mass is never treated as volume',()=>{
  for(const id of ['1000453590','1445100176','1000127183','1000049786','1000169025']){
    const raw=fixture.rows.find(row=>row.source_product_id===id);assert.ok(raw,id);
    const card=weeklyMagnitCard(normalize(raw));
    assert.equal(catalogPurchaseUnit(card),null,id);
    assert.equal(WEEKLY_MAGNIT_IDENTITIES.some(identity=>identity.sourceProductId===id),false,id);
  }
  assert.equal(fixture.reviewedIdentities.find(row=>row.sourceProductId==='1000175642').unit,'400 г','5 x 80g is the whole pack');
  const rice=fixture.reviewedIdentities.find(row=>row.sourceProductId==='1000303412');
  assert.match(rice.name,/800г/u);assert.match(rice.productPath,/900g/u);assert.equal(rice.unit,'800 г','historical slug does not override exact current title');
});
