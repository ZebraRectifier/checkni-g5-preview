import {formatRubMinor} from './ComparisonResult.mjs';
import {quoteCatalogDraft,compareCatalogDraftAlternatives} from '../core/catalogDraft.mjs';
import {reviewedCrossSourceCounterpart} from '../catalog/reviewedCrossSourcePairs.mjs';

export const savedComparisonStoreLabel = scope => scope.retailerId==='magnit'?'Магнит':'Перекрёсток · доставка';

export function savedComparisonUsesAlternatives(result) {
  const bindings=result?.request?.bindings;
  if(!Array.isArray(bindings)||!bindings.length||!Array.isArray(result?.drafts))return false;
  return bindings.some((binding,index)=>result.drafts.some(draft=>{
    // Saved drafts are built in request binding order. Refuse to infer an
    // alternative if a caller supplies a differently ordered result.
    const row=draft?.rows?.[index],card=row?.card,targetRetailerId=draft?.scope?.retailerId;
    if(row?.group?.key!==binding.groupKey)return false;
    if(!card||typeof card.sourceProductId!=='string'||typeof targetRetailerId!=='string')return false;
    const expected=targetRetailerId===binding.retailerId?binding.sourceProductId
      :reviewedCrossSourceCounterpart(binding,targetRetailerId);
    return card.sourceProductId!==expected;
  }));
}

function describeGaps(quote) {
  const reasons = [
    ['Товар не подтверждён', line => !line.card],
    ['Уточнить вес, фасовку или количество', line => line.card && (line.quantityReview || !line.unit)],
    ['Весовые количества примерные', line => line.card && line.unit?.approximate && !line.quantityReview],
    ['Нужны свежие цены', line => line.card && line.freshness !== 'recent']
  ];
  return reasons.flatMap(([label, isGap]) => {
    const lines = quote.lines.filter(isGap);
    if (!lines.length) return [];
    if (lines.length === quote.lines.length) return [label + ' — весь список'];
    const names = [...new Set(lines.map(line => line.group.label))];
    const preview = names.slice(0, 4).join(', ');
    return [label + ' — ' + preview + (names.length > 4 ? ' и ещё ' + (names.length - 4) : '')];
  });
}

export function renderSavedGuidedComparison(parent,result,{nowMs=Date.now(),onChooseProducts}={}) {
  const doc=parent.ownerDocument,el=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
  parent.replaceChildren();
  if(result?.kind!=='catalog_comparison'){
    parent.append(el('p',result?.kind==='needs_review'
      ?'Для части позиций нужно выбрать соответствия. Вернись к товарам и проверь список; корзина сохранена.'
      :'Не удалось перепроверить выбранные магазины. Корзина и выбор магазинов сохранены; попробуй позже.'));
    if(result?.kind==='needs_review'&&typeof onChooseProducts==='function'){
      const choose=el('button','К товарам');choose.type='button';choose.className='secondary-button';choose.addEventListener('click',onChooseProducts);parent.append(choose);
    }
    return;
  }
  const quotes=result.drafts.map(draft=>quoteCatalogDraft(draft.rows,{nowMs}));
  const comparison=compareCatalogDraftAlternatives(result.drafts,{nowMs});
  // Core already distinguishes a usable estimate from an unresolved quantity.
  // Estimated weights must not turn a fresh comparison into a review request.
  const status=el('p');status.setAttribute('role','status');
  const messages=[];
  const pendingCount=result.request?.unresolvedGroupKeys?.length??0;
  const usesAlternatives=savedComparisonUsesAlternatives(result);
  const lowerScope=result.drafts.find(draft=>draft.scope.storeId===comparison.lowerStoreId)?.scope;
  if(pendingCount)messages.push('Подбор ещё неполный. Выгоду всего подбора пока не определяем.');
  if(!pendingCount&&comparison.kind==='fresh')messages.push((comparison.estimated?'Ориентировочно: ':usesAlternatives?'По наблюдаемым ценам среди сопоставленных вариантов ':'По наблюдаемым ценам ')+(comparison.differenceMinor===0
    ?'суммы товаров в этих вариантах совпали.'
    :'сумма товаров в '+(lowerScope?savedComparisonStoreLabel(lowerScope):comparison.lowerStoreName)+' ниже на '+formatRubMinor(comparison.differenceMinor)+'.'));
  else {
    if (comparison.kind === 'incompatible') {
      messages.push('Не удалось сопоставить выбранные позиции. Проверь товары и количество.');
    }
    if(quotes.some(quote=>!quote.complete))messages.push('Список неполный. Выгоду пока не определяем.');
    if(quotes.some(quote=>!quote.allRecent))messages.push('Есть старые или неизвестные цены.');
    if(quotes.some(quote=>quote.lines.some(line=>line.quantityReview || (line.card && !line.unit))))
      messages.push('Количество весовых товаров или упаковку нужно уточнить.');
  }
  status.textContent=messages.join(' ');
  if(result.request?.unresolvedGroupKeys?.length)parent.append(el('p','Сравниваем только выбранные позиции. В исходном подборе ещё '+result.request.unresolvedGroupKeys.length+' поз. без подтверждённых товаров.'));
  parent.append(status);
  if(usesAlternatives)parent.append(el('p','В сравнении есть альтернативные марки или фасовки. Разница относится к показанным вариантам.'));
  parent.append(el('p','По количествам из списка. Доставка и сборы не включены; наличие неизвестно.'));
  const calculation=el('details');calculation.className='future-step';
  calculation.append(el('summary','Как рассчитана сумма'),el('p','Сравниваем количества в сохранённом списке. Для фасованных товаров учитываем целые упаковки, поэтому сумма может отличаться от первоначального подбора на людей и дни.'));
  if(quotes.some(quote=>quote.hasEstimates))calculation.append(el('p','Весовые количества примерные: окончательная сумма зависит от взвешивания.'));
  calculation.append(el('p','Условия карт и акций проверяй по источнику.'));
  if(result.drafts.some(draft=>draft.scope.retailerId==='perekrestok')){
    parent.append(el('p','Доставка по твоему адресу не подтверждена.'));
    calculation.append(el('p','Перекрёсток — подключённый каталог доставки в Москве. Цены физического магазина могут отличаться.'));
  }
  parent.append(calculation);
  const groups = new Map();
  for (const complete of [true, false]) {
    if (!quotes.some(quote => quote.complete === complete)) continue;
    const group = el('section'); group.className = 'saved-comparison-group';
    group.append(el('h3', complete ? 'Все позиции сопоставлены' : 'Неполные корзины'));
    const columns = el('div'); columns.className = 'saved-comparison-columns'; columns.setAttribute('aria-hidden', 'true');
    for (const label of ['Магазин', 'Покрытие', 'Сумма товаров', 'Актуальность', '']) columns.append(el('span', label));
    group.append(columns); parent.append(group); groups.set(complete, group);
  }
  result.drafts.forEach((draft,index)=>{
    const quote=quotes[index],details=el('details');details.className='future-step saved-catalog-variant';
    const storeLabel = savedComparisonStoreLabel(draft.scope);
    const gaps = describeGaps(quote);
    if (gaps.length) {
      const notice = el('p', storeLabel + '. ' + gaps.join('. ') + '.');
      notice.className = 'saved-comparison-gaps';
      details.append(notice);
    }
    const total=quote.knownSubtotalMinor==null?'сумма неизвестна':formatRubMinor(quote.knownSubtotalMinor);
    const summary=el('summary');
    const name=el('strong',storeLabel); name.className='saved-quote-store';
    const coverage=el('span',quote.basket.length+'/'+quote.lines.length+' поз.'); coverage.className='saved-quote-coverage';
    const amount=el('span'); amount.className='saved-quote-amount';
    amount.append(el('strong',total));
    if(!quote.complete)amount.append(el('small','Найденная часть'));
    if(quote.hasEstimates)amount.append(el('small','Ориентировочно'));
    const freshness=el('span',quote.allRecent?'Свежие наблюдения':'Старые / неизвестные цены'); freshness.className='saved-quote-freshness';
    const dates=quote.lines.map(line=>line.card?.observedAt).filter(value=>value&&Number.isFinite(Date.parse(value))).map(value=>Date.parse(value));
    if(dates.length){
      const format=value=>new Date(value).toLocaleDateString('ru-RU');
      const first=Math.min(...dates),last=Math.max(...dates);
      freshness.append(el('small',first===last?format(first):format(first)+' — '+format(last)));
    }
    const expand=el('span','Подробнее');expand.className='saved-quote-expand';
    summary.append(name,coverage,amount,freshness,expand);
    details.prepend(summary);
    if(draft.scope.storeAddress)details.append(el('p',draft.scope.storeAddress));
    const scroll=el('div');scroll.className='guided-shopping-scroll';scroll.tabIndex=0;
    const table=el('table');table.className='guided-shopping-table';table.append(el('caption','Товары и цены · '+storeLabel));
    const head=el('thead'),headRow=el('tr');
    for(const text of ['Товар и количество','Цена и источник']){const th=el('th',text);th.scope='col';headRow.append(th);}
    head.append(headRow);table.append(head);const body=el('tbody');
    for(const line of quote.lines){
      const tr=el('tr'),item=el('td'),price=el('td');
      item.append(el('strong',line.card?.name??line.group.label),el('p',line.quantityReview
        ?'Количество или исходную упаковку нужно уточнить':line.card
        ?line.quantity+' × '+(line.unit?.label??line.card.unit):'Не удалось подтвердить товар'));
      price.append(el('strong',line.lineTotalMinor==null?'Сумма не подтверждена':formatRubMinor(line.lineTotalMinor)));
      if(line.card){
        price.append(el('p',(line.freshness==='recent'?'Наблюдение: ':'Старое/неизвестное наблюдение: ')
          +(line.card.observedAt&&Number.isFinite(Date.parse(line.card.observedAt))?new Date(line.card.observedAt).toLocaleString('ru-RU'):'дата неизвестна')));
        if(line.card.priceConditionLabel)price.append(el('p',line.card.priceConditionLabel));
        const link=el('a','Источник цены');link.href=line.card.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';price.append(link);
      }
      tr.append(item,price);body.append(tr);
    }
    table.append(body);scroll.append(table);details.append(scroll);groups.get(quote.complete).append(details);
  });
}
