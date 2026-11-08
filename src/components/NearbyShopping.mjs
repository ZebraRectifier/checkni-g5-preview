import{createStoreGeolocation}from'../runtime/storeGeolocation.mjs';
import{NEARBY_RADIUS_KM,nearbyGroceryMatches}from'../intelligence/nearbyShopping.mjs';
import{createNearbyShoppingPort}from'../ports/nearbyShoppingPort.mjs';
import { nearbyCityQuery, nearbyRegionForPosition, nearbyAddressQueryInRegion } from '../intelligence/nearbyRegions.mjs';
import { yandexStoreRouteUrl } from '../navigation/storeRoute.mjs';

export function createNearbyShopping({document=globalThis.document,port=createNearbyShoppingPort(),onChoose,onBuild,onManualMap,
  onInvalidate=()=>{},geolocationOptions={},locationController}={}){
  const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const RESULT_PAGE_SIZE=5;
  const button=(text,fn)=>{const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b;};
  const root=el('section');root.id='nearby-shopping';root.className='nearby-shopping';root.setAttribute('aria-label','Магазины рядом и выбор места покупок');
  const stylesheet=new URL('./nearby-shopping.css',import.meta.url).href;
  if(![...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>link.href===stylesheet)){
    const css=el('link');css.rel='stylesheet';css.href=stylesheet;document.head.append(css);
  }
  const openButton=button('📍 Найти магазины рядом',()=>open());openButton.setAttribute('aria-expanded','false');
  const panel=el('div');panel.hidden=true;panel.id='nearby-shopping-panel';openButton.setAttribute('aria-controls',panel.id);
  const title=el('h3','Где ищем продукты?');
  const input=el('input');input.id='nearby-address';input.type='search';input.maxLength=160;
  input.placeholder='Город, улица или станция';
  const label=el('label','Город, улица или станция');label.htmlFor=input.id;
  const consent=el('small','По кнопке «Найти адрес» запрос уйдёт в Photon / OpenStreetMap через сервер CHECKNI. В AI и историю адрес не передаётся.');
  const addressButton=button('Найти адрес',()=>searchAddress());addressButton.id='nearby-address-search';
  const locate=button('Определить моё место',()=>{version++;geo.request();});locate.id='nearby-locate';
  const manual=button('На карте',()=>{document.dispatchEvent(new document.defaultView.CustomEvent('checkni:shop-action',{detail:{action:'address',target:'map'}}));onManualMap?.();});
  manual.setAttribute('aria-label','Выбрать точку на карте');
  const clear=button('Убрать моё место',()=>{version++;geo.clear();position=null;pointName='';candidates.replaceChildren();results.replaceChildren();clearSelection();
    input.value='';port.clearAddressMemory?.();
    status.textContent='Место удалено. Можно указать другое.';});
  const radius=el('select');radius.id='nearby-radius';radius.setAttribute('aria-label','Радиус поиска магазинов');
  for(const n of NEARBY_RADIUS_KM){const o=el('option',n+' км');o.value=String(n);radius.append(o);}radius.value='5';
  const radiusLabel=el('label','Радиус по прямой');radiusLabel.htmlFor=radius.id;
  const connected=el('input');connected.type='checkbox';connected.id='nearby-connected-only';connected.checked=true;
  const connectedLabel=el('label');connectedLabel.append(connected,document.createTextNode(' Только с подключённым каталогом'));
  const status=el('p');status.id='nearby-status';status.setAttribute('role','status');
  const candidates=el('div');candidates.id='nearby-address-candidates';
  const selection=el('div');selection.id='nearby-selected-store';selection.hidden=true;
  const results=el('div');results.id='nearby-results';
  const actions=el('div');actions.className='nearby-actions';actions.append(clear);
  const networks=el('div');networks.hidden=true;networks.className='nearby-network-filters';networks.setAttribute('aria-label','Фильтр сети');
  let network='all';
  for(const [id,name] of [['all','Все'],['magnit','Магнит'],['globus','Глобус'],['metro','METRO'],['perekrestok','Перекрёсток'],['pyaterochka','Пятёрочка'],['okey','О’КЕЙ']]){
    const chip=button(name,()=>{network=id;for(const b of networks.children)b.setAttribute('aria-pressed',String(b===chip));limit=RESULT_PAGE_SIZE;void renderResults();});
    chip.setAttribute('aria-pressed',String(id==='all'));networks.append(chip);
  }
  const filters=el('div');filters.className='nearby-actions nearby-result-filters';filters.append(radiusLabel,radius,connectedLabel);
  const directoryDate=el('p');directoryDate.hidden=true;
  const note=el('details');const noteTitle=el('summary','Откуда магазины и что известно о ценах');
  const noteCopy=el('p','Это датированный справочник карты, а не полный список работающих магазинов. Расстояния — по прямой. Совпадение адреса с каталогом не подтверждает свежесть цен, наличие или доставку. Геопозиция хранится только в памяти вкладки и исчезает после перезагрузки.');
  const attribution=el('a','© OpenStreetMap contributors · ODbL');attribution.href='https://www.openstreetmap.org/copyright';attribution.target='_blank';attribution.rel='noopener noreferrer';note.append(noteTitle,noteCopy,directoryDate,attribution);
  const mapPrivacy=el('small','При открытии карты OpenFreeMap загружает соответствующий участок.');
  const addressRow=el('div');addressRow.className='nearby-address-row';addressRow.append(input,addressButton);
  const privacy=el('details');privacy.className='nearby-privacy';privacy.append(el('summary','Как используется адрес'),consent,mapPrivacy);
  const locationActions=el('div');locationActions.className='nearby-actions nearby-location-actions';locationActions.append(locate,manual);
  panel.append(title,label,addressRow,locationActions,filters,networks,status,candidates,selection,results);
  const extra=el('details');extra.className='nearby-extra';extra.append(el('summary','Другие способы и источники'),actions,privacy,note);panel.append(extra);root.append(openButton,panel);
  let position=null,pointName='',directory=null,version=0,limit=RESULT_PAGE_SIZE,chosen=null,pendingPlaceLabel=null,region=null;
  let mapRevision=0,mapRows=[],lastRows=[];
  function publishMapContext(state,rows=[]){
    mapRows=rows;
    document.dispatchEvent(new document.defaultView.CustomEvent('checkni:nearby-map-context',{detail:{
      revision:++mapRevision,state,position:position?{lat:position.lat,lon:position.lon}:null,
      radiusKm:Number(radius.value),stores:rows
    }}));
  }
  document.addEventListener('checkni:nearby-map-select',event=>{
    if(event.detail?.revision!==mapRevision)return;
    const row=mapRows.find(row=>row.id===event.detail.id);
    if(row?.catalog)void choose(row);
  });
  function clearSelection(){chosen=null;selection.hidden=true;selection.replaceChildren();onInvalidate();}
  function open(query='',radiusKm=null){panel.hidden=false;openButton.setAttribute('aria-expanded','true');
    if(query)input.value=query.slice(0,160);
    if(Number.isInteger(radiusKm)&&radiusKm>=1&&radiusKm<=20){
      if(![...radius.options].some(o=>o.value===String(radiusKm))){const o=el('option',radiusKm+' км');o.value=String(radiusKm);radius.append(o);}
      radius.value=String(radiusKm);
    }
    if(query)status.textContent='Проверь адрес и нажми «Найти адрес». Затем выбери подходящий результат.';
    input.focus({preventScroll:true});root.scrollIntoView({block:'start'});
  }
  async function directoryData(){
    if(region!=='moscow-and-oblast')return port.regionalDirectory(region);
    if(!directory)directory=await port.directory();
    return directory;
  }
  async function renderResults(){
    const token=++version;results.replaceChildren();networks.hidden=!position;publishMapContext('loading');if(!position)return;const current=position;
    if(!region){publishMapContext('unsupported');networks.hidden=true;status.textContent='Для этого места справочника пока нет. Выбери другой город или точку на карте.';return;}
    status.textContent='Ищу магазины в выбранном радиусе…';
    try{
      const d=await directoryData();if(token!==version||current!==position)return;
      const rows=nearbyGroceryMatches(d.stores,position,Number(radius.value),{connectedOnly:connected.checked,regional:region!=='moscow-and-oblast'}).filter(row=>network==='all'||row.retailerId===network);
      lastRows=rows;publishMapContext('ready',rows);
      directoryDate.textContent='Дата справочника: '+new Date(d.observedAt).toLocaleDateString('ru-RU')+'.';
      directoryDate.hidden=false;
      status.textContent=`${pointName||'Выбранная точка'} · до ${radius.value} км · найдено: ${rows.length}`
        +(rows.length?'':connected.checked?' · Расширь радиус или покажи все магазины.':' · Расширь радиус или уточни адрес.');
      const shownRows=rows.slice(0,limit);
      for(const row of shownRows){
        const card=el('article');card.className='nearby-store';card.dataset.storeId=row.id;
        if(chosen?.id===row.id){card.classList.add('is-selected');card.setAttribute('aria-current','true');}
        card.append(el('strong',row.name+' · '+(row.distanceMeters<1000?Math.round(row.distanceMeters)+' м':(row.distanceMeters/1000).toFixed(1)+' км')),
          el('p',row.address??'Адрес в карте не указан'),el('small',row.catalog?'Каталог этого адреса подключён. Актуальность цен и возможность добавить товар указаны в каталоге.':'Каталог этого адреса пока не подключён. Цены неизвестны.'));
        if(row.catalog){
          const open=button('Открыть товары',()=>choose(row));open.className='nearby-open-catalog';card.append(open);
          card.addEventListener('click',event=>{if(!event.target.closest('button,a'))open.click();});
        }
        const routeUrl=yandexStoreRouteUrl(row);
        if(routeUrl){const route=el('a','Маршрут');route.className='nearby-store-route';route.href=routeUrl;
          route.target='_blank';route.rel='noopener noreferrer';card.append(route);}
        results.append(card);
      }
      const sourceUrls=[...new Set(shownRows.map(row=>row.sourceUrl).filter(Boolean))];
      if(sourceUrls.length){const sources=el('details');sources.className='nearby-result-sources';sources.append(el('summary','Источники адресов'));
        sourceUrls.forEach((url,index)=>{const link=el('a',`Источник ${index+1}`);link.href=url;link.target='_blank';link.rel='noopener noreferrer';sources.append(link);});results.append(sources);}
      if(rows.length>shownRows.length){
        const nextLimit=Math.min(limit+RESULT_PAGE_SIZE,rows.length);
        results.append(button(`Показать ещё ${nextLimit-shownRows.length}`,async event=>{
          const renderVersion=version+1;
          limit=nextLimit;
          await renderResults();
          if(event.detail===0&&renderVersion===version&&document.activeElement===document.body){
            results.querySelectorAll('.nearby-store')[shownRows.length]?.querySelector('button,a')?.focus();
          }
        }));
      }
    }catch{if(token===version){publishMapContext('unavailable');status.textContent='Справочник сейчас не загрузился. Место сохранилось; попробуй ещё раз или выбери магазин в каталоге.';}}
  }
  async function choose(row){
    const token=++version;clearSelection();status.textContent='Выбираю адрес каталога…';
    const accepted=await onChoose?.(row.catalog,row,()=>token===version);
    if(token!==version)return;
    if(accepted!==true){status.textContent='Этот адрес не удалось подключить. Корзина сохранилась; выбери другой магазин.';return;}
    chosen=row;for(const card of results.querySelectorAll('.nearby-store')){const selected=card.dataset.storeId===row.id;card.classList.toggle('is-selected',selected);if(selected)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');}
    selection.hidden=false;selection.append(el('strong','Выбран: '+row.name),el('p',row.address),
      button('Собрать корзину здесь',()=>{if(chosen===row)onBuild?.(row.catalog,row);}));
    status.textContent='Магазин согласован. Теперь уточним продукты и покажем цены, которые удастся подтвердить.';
    if(selection.getClientRects().length)selection.scrollIntoView({block:'center'});
  }
  async function searchAddress(){
    if(addressButton.disabled)return;
    const query=input.value.trim();if(query.length<3){status.textContent='Напиши город и улицу, адрес дома или название станции.';return;}
    const searchRegion=region,requestQuery=nearbyAddressQueryInRegion(query,searchRegion);
    if(requestQuery.length>160){status.textContent='Сократи адрес: вместе с городом он должен быть не длиннее 160 символов.';return;}
    geo.clear();region=searchRegion;const token=++version;clearSelection();position=null;candidates.replaceChildren();results.replaceChildren();addressButton.disabled=true;
    status.textContent='Ищу адрес…';
    const cityQuery=nearbyCityQuery(query),city=cityQuery?.region;
    let response;
    try{
      if(city&&!cityQuery.address){
        response={kind:'results',candidates:[{...city,label:city.label+' · центр',precision:'city'}]};
      }else response=await port.address(requestQuery);
    }catch{response={kind:'unavailable',candidates:[]};}
    if(token!==version){addressButton.disabled=false;return;}addressButton.disabled=false;
    if(input.value.trim()!==query){status.textContent='Адрес изменён. Нажми «Найти адрес», чтобы проверить новый.';return;}
    if(response.kind==='unavailable'){status.textContent='Сервис поиска адресов временно недоступен. Попробуй ещё раз или выбери точку на карте.';return;}
    if(!['results','directory'].includes(response.kind)||!response.candidates.length){status.textContent=response.kind==='limited'?'Слишком частые запросы. Подожди немного или выбери место на карте.':'Адрес не удалось найти. Добавь город и номер дома или укажи место на карте.';return;}
    status.textContent=response.kind==='directory'?'Точный адрес не найден. Можно выбрать магазин из справочника как ориентир.':'Это нужное место? Выбери один из адресов.';
    for(const p of response.candidates){if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||typeof p.label!=='string'||p.label.length>500)continue;
      candidates.append(button(p.label+(p.precision==='store'?' · магазин-ориентир':p.precision==='house'?'':' · приблизительный ориентир'),()=>{pendingPlaceLabel=p.label;geo.setManual({lat:p.lat,lon:p.lon});candidates.replaceChildren();}));}
    candidates.scrollIntoView({block:'center'});
  }
  const locationChanged=s=>{
    const showMapRecovery=['denied','error','unavailable','timeout'].includes(s.status);
    if(showMapRecovery)status.after(manual);
    else if(manual.parentElement!==locationActions)locationActions.append(manual);
    version++;
    if(s.status==='loading'){publishMapContext('loading');status.textContent='Жду разрешение браузера на геолокацию…';return;}
    if(s.position && s.status!=='loading' && s.status!=='denied' && s.status!=='error'){
      if(s.position.source==='device')pendingPlaceLabel=null;
      const nextRegion=nearbyRegionForPosition(s.position)?.id??null;
      if(nextRegion!==region){
        if(nextRegion&&nextRegion!=='moscow-and-oblast')connected.checked=false;
        network='all';for(const chip of networks.children)chip.setAttribute('aria-pressed',String(chip===networks.firstElementChild));
      }
      region=nextRegion;lastRows=[];
      clearSelection();position=s.position;pointName=pendingPlaceLabel??(s.position.source==='manual'?'Точка на карте':`Моё место · точность ≈${Math.round(s.position.accuracyMeters)} м`);pendingPlaceLabel=null;limit=RESULT_PAGE_SIZE;
      panel.hidden=false;openButton.setAttribute('aria-expanded','true');void renderResults();}
    else if(s.status==='idle'){position=null;region=null;pointName='';lastRows=[];publishMapContext('idle');results.replaceChildren();}
    else if(s.status!=='idle'){publishMapContext('ready',lastRows);status.textContent=s.status==='denied'?'Доступ к геолокации закрыт. Можно написать адрес или указать место на карте.':'Место не определилось. Напиши адрес или выбери точку на карте.';}
  };
  const geo=locationController??createStoreGeolocation({...geolocationOptions,onChange:locationChanged});
  if(locationController)geo.subscribe(locationChanged);
  radius.addEventListener('change',()=>{clearSelection();limit=RESULT_PAGE_SIZE;void renderResults();});
  connected.addEventListener('change',()=>{limit=RESULT_PAGE_SIZE;void renderResults();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void searchAddress();}});
  return{element:root,open,setPosition:p=>p?geo.setManual(p):geo.clear(),
    getChosen:()=>chosen,clear:()=>clear.click()};
}
