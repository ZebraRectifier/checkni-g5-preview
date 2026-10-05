import { historySnapshots, latestForAddress, observationTime } from '../observations/addressPriceHistory.mjs';
import { readBoundedJsonResponse } from '../ports/retailCatalogPort.mjs';
import { createAddressPriceHistory } from './AddressPriceHistory.mjs';

function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
const rub=value=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100);

export function createOkeyDeliveryCatalog({fetchImpl=globalThis.fetch}={}){
  if(!document.querySelector('link[data-okey-delivery-style]')){
    const css=node('link');css.rel='stylesheet';css.href=new URL('../okey-delivery.css',import.meta.url).href;
    css.dataset.okeyDeliveryStyle='true';document.head.append(css);
  }
  const details=node('details');details.className='okey-delivery';
  details.append(node('summary','О’КЕЙ · цены доставки и история'));
  const status=node('p');status.setAttribute('aria-live','polite');
  status.textContent='Выберите адрес доставки, затем товар.';
  details.append(status);
  let started=false;
  details.addEventListener('toggle',async()=>{
    if(!details.open||started)return;started=true;status.textContent='Загружаем наблюдения…';
    try{
      const response=await fetchImpl(new URL('../data/okeyDeliveryHistory.json',import.meta.url),{cache:'no-store'});
      if(!response.ok)throw new Error('unavailable');
      let bundle=await readBoundedJsonResponse(response,8*1024*1024);
      let refreshStatus='manual';
      try{
        const refreshResponse=await fetchImpl(new URL('../data/okeyDeliveryRefresh.json',import.meta.url),{cache:'no-store'});
        if(refreshResponse.ok)refreshStatus=(await refreshResponse.json()).status;
      }catch{}
      const snapshots=historySnapshots(bundle).filter(s=>observationTime(s)<=Date.now());
      const addresses=[...new Set(snapshots.map(s=>s.selectedDeliveryAddress))];
      if(!addresses.length)throw new Error('empty');
      const label=node('label','Адрес доставки ');
      const address=node('select');address.setAttribute('aria-label','Адрес доставки О’КЕЙ');
      for(const value of addresses){const option=node('option',value);option.value=value;address.append(option);}
      label.append(address);
      const search=node('input');search.type='search';search.placeholder='Найти товар в наблюдениях';search.setAttribute('aria-label','Поиск в ценах доставки О’КЕЙ');
      const category=node('select');category.setAttribute('aria-label','Категория О’КЕЙ');
      const note=node('p');const grid=node('div');grid.className='okey-delivery-grid';
      const more=node('button','Показать ещё');more.type='button';
      details.append(label,category,search,note,grid,more);
      let limit=24;
      function render(){
        const snapshot=latestForAddress(bundle,address.value);
        grid.replaceChildren();
        const age=Date.now()-Date.parse(snapshot.observedDate+'T00:00:00Z');
        status.textContent=age>86400000?'Сохранённые цены · проверьте актуальность у источника.':'Наблюдаемые цены доставки · Яндекс Еда';
        note.textContent='Проверено '+snapshot.observedDate+'. Это доставка на выбранный адрес; магазин выдачи и наличие неизвестны. С О’КАРТОЙ / без карты: неизвестно. Каталог неполный. Обновление: '+(refreshStatus==='collected'?'последний сбор успешен.':refreshStatus==='blocked'?'приостановлено: источник запросил проверку.':'автоматический сбор пока не подтверждён.');
        const q=search.value.trim().toLocaleLowerCase('ru-RU');
        const rows=snapshot.products.filter(p=>(!q||p.name.toLocaleLowerCase('ru-RU').includes(q))&&
          (!category.value||(p.category??snapshot.coverage?.category??'Без категории')===category.value));
        for(const p of rows.slice(0,limit)){
          const card=node('article');card.className='okey-delivery-card';
          card.append(node('h3',p.name),node('p',p.displayedPackage??'Упаковка не указана'),node('strong',rub(p.displayedPriceKopeks)));
          card.append(node('p','Проверено '+(p.sourceObservedAt
            ?new Date(p.sourceObservedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})
            :snapshot.observedDate)));
          const source=node('a','Посмотреть у источника');source.href=p.productUrl;source.target='_blank';source.rel='noopener noreferrer';
          card.append(source,createAddressPriceHistory(bundle,address.value,p));grid.append(card);
        }
        if(!rows.length)grid.append(node('p','В собранных наблюдениях такого товара нет.'));
        more.hidden=rows.length<=limit;
      }
      function categories(){
        category.replaceChildren();const all=node('option','Все категории');all.value='';category.append(all);
        const snapshot=latestForAddress(bundle,address.value);
        for(const value of [...new Set(snapshot.products.map(p=>p.category??snapshot.coverage?.category??'Без категории'))].sort()){
          const option=node('option',value);option.value=value;category.append(option);
        }
      }
      address.addEventListener('change',()=>{limit=24;categories();render();});
      category.addEventListener('change',()=>{limit=24;render();});
      search.addEventListener('input',()=>{limit=24;render();});
      more.addEventListener('click',()=>{limit+=24;render();});
      categories();render();
      // An open catalog picks up published observations without a page reload.
      setInterval(async()=>{
        if(!details.isConnected||!details.open||document.visibilityState==='hidden')return;
        try{
          const nextResponse=await fetchImpl(new URL('../data/okeyDeliveryHistory.json',import.meta.url),{cache:'no-store'});
          if(!nextResponse.ok)return;
          const next=await readBoundedJsonResponse(nextResponse,8*1024*1024);
          if(!latestForAddress(next,address.value))return;
          bundle=next;
          const previousCategory=category.value;categories();category.value=previousCategory;
          render();
        }catch{}
      },15*60*1000);
    }catch{status.textContent='Цены сейчас недоступны. Попробуйте открыть каталог ещё раз.';started=false;}
  });
  return details;
}
