import {formatRubMinor} from './ComparisonResult.mjs';
import {quoteCatalogDraft,compareCatalogDraftAlternatives} from '../core/catalogDraft.mjs';

export const savedComparisonStoreLabel = scope => scope.retailerId==='magnit'?'Магнит':'Перекрёсток · доставка';

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
  const exact=quotes.every(quote=>quote.complete&&quote.allRecent&&!quote.hasEstimates);
  const status=el('p');status.setAttribute('role','status');
  const messages=[];
  if(exact&&comparison.kind==='fresh')messages.push('Подытог товаров в '+comparison.lowerStoreName+' ниже на '+formatRubMinor(comparison.differenceMinor)+'.');
  else {
    if(quotes.some(quote=>!quote.complete))messages.push('Список неполный. Выгоду пока не определяем.');
    if(quotes.some(quote=>!quote.allRecent))messages.push('Есть старые или неизвестные цены.');
    if(quotes.some(quote=>quote.hasEstimates)||result.drafts.some(draft=>draft.rows.some(row=>row.quantityReview)))
      messages.push('Количество весовых товаров или упаковку нужно уточнить.');
  }
  status.textContent=messages.join(' ');
  if(result.request?.unresolvedGroupKeys?.length)parent.append(el('p','Сравниваем только выбранные позиции. В исходном подборе ещё '+result.request.unresolvedGroupKeys.length+' поз. без подтверждённых товаров.'));
  parent.append(status,el('p','Марки и фасовки могут отличаться. Доставка и сборы не включены; наличие неизвестно.'));
  result.drafts.forEach((draft,index)=>{
    const quote=quotes[index],details=el('details');details.className='future-step saved-catalog-variant';
    const total=quote.knownSubtotalMinor==null?'сумма неизвестна':formatRubMinor(quote.knownSubtotalMinor);
    const summary=el('summary',savedComparisonStoreLabel(draft.scope)+' · '+quote.basket.length+'/'+quote.lines.length+' поз. · '
      +(quote.complete?'':'найденная часть: ')+total+(quote.hasEstimates?' · ориентировочно':''));
    details.append(summary,el('p',draft.scope.storeAddress??''));
    const scroll=el('div');scroll.className='guided-shopping-scroll';scroll.tabIndex=0;
    const table=el('table');table.className='guided-shopping-table';table.append(el('caption','Товары и цены · '+savedComparisonStoreLabel(draft.scope)));
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
          +new Date(line.card.observedAt).toLocaleString('ru-RU')));
        if(line.card.priceConditionLabel)price.append(el('p',line.card.priceConditionLabel));
        const link=el('a','Источник цены');link.href=line.card.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';price.append(link);
      }
      tr.append(item,price);body.append(tr);
    }
    table.append(body);scroll.append(table);details.append(scroll);parent.append(details);
  });
}
