import{createStoreGeolocation}from'../runtime/storeGeolocation.mjs';
import{NEARBY_RADIUS_KM,nearbyGroceryMatches}from'../intelligence/nearbyShopping.mjs';
import{createNearbyShoppingPort}from'../ports/nearbyShoppingPort.mjs';

export function createNearbyShopping({document=globalThis.document,port=createNearbyShoppingPort(),onChoose,onBuild,onManualMap,
  onInvalidate=()=>{},geolocationOptions={},locationController}={}){
  const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const button=(text,fn)=>{const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b;};
  const root=el('section');root.id='nearby-shopping';root.className='nearby-shopping';root.setAttribute('aria-label','Магазины рядом и выбор места покупок');
  const css=el('link');css.rel='stylesheet';css.href=new URL('./nearby-shopping.css',import.meta.url).href;document.head.append(css);
  const openButton=button('📍 Найти магазины рядом',()=>open());openButton.setAttribute('aria-expanded','false');
  const panel=el('div');panel.hidden=true;panel.id='nearby-shopping-panel';openButton.setAttribute('aria-controls',panel.id);
  const title=el('h3','Где будем покупать?');
  const input=el('input');input.id='nearby-address';input.type='search';input.maxLength=160;
  input.placeholder='Город, улица и дом или ближайшее метро';
  const label=el('label','Адрес в Москве или Московской области');label.htmlFor=input.id;
  const consent=el('small','По кнопке «Найти адрес» запрос уйдёт в Photon / OpenStreetMap через сервер CHECKNI. В AI и историю адрес не передаётся.');
  const addressButton=button('Найти адрес',()=>searchAddress());addressButton.id='nearby-address-search';
  const locate=button('Определить моё место',()=>{version++;clearSelection();position=null;pointName='';candidates.replaceChildren();results.replaceChildren();geo.request();});locate.id='nearby-locate';
  const manual=button('Выбрать точку на карте',()=>onManualMap?.());
  const clear=button('Убрать моё место',()=>{version++;geo.clear();position=null;pointName='';candidates.replaceChildren();results.replaceChildren();clearSelection();
    input.value='';
    status.textContent='Место удалено. Можно указать другое.';});
  const radius=el('select');radius.id='nearby-radius';radius.setAttribute('aria-label','Радиус поиска магазинов');
  for(const n of NEARBY_RADIUS_KM){const o=el('option',n+' км');o.value=String(n);radius.append(o);}radius.value='5';
  const radiusLabel=el('label','Радиус по прямой');radiusLabel.htmlFor=radius.id;
  const connected=el('input');connected.type='checkbox';connected.id='nearby-connected-only';connected.checked=true;
  const connectedLabel=el('label');connectedLabel.append(connected,document.createTextNode(' Только с подключённым каталогом'));
  const status=el('p','Укажи адрес, разреши геолокацию или выбери точку на карте.');status.id='nearby-status';status.setAttribute('role','status');
  const candidates=el('div');candidates.id='nearby-address-candidates';
  const selection=el('div');selection.id='nearby-selected-store';selection.hidden=true;
  const results=el('div');results.id='nearby-results';
  const actions=el('div');actions.className='nearby-actions';actions.append(locate,manual,clear);
  const filters=el('div');filters.className='nearby-actions';filters.append(radiusLabel,radius,connectedLabel);
  const note=el('details');const noteTitle=el('summary','Откуда магазины и что известно о ценах');
  const noteCopy=el('p','Это датированный справочник карты, а не полный список работающих магазинов. Расстояния — по прямой. Совпадение адреса с каталогом не подтверждает свежесть цен, наличие или доставку. Геопозиция хранится только в памяти вкладки и исчезает после перезагрузки.');
  const attribution=el('a','© OpenStreetMap contributors · ODbL');attribution.href='https://www.openstreetmap.org/copyright';attribution.target='_blank';attribution.rel='noopener noreferrer';note.append(noteTitle,noteCopy,attribution);
  const mapPrivacy=el('small','При выборе места карта OpenStreetMap загружает соответствующий участок.');
  panel.append(title,label,input,consent,addressButton,mapPrivacy,actions,filters,status,candidates,selection,results,note);root.append(openButton,panel);
  let position=null,pointName='',directory=null,version=0,limit=12,chosen=null,pendingPlaceLabel=null;
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
  async function directoryData(){if(!directory)directory=await port.directory();return directory;}
  async function renderResults(){
    const token=++version;results.replaceChildren();if(!position)return;const current=position;
    status.textContent='Ищу магазины в выбранном радиусе…';
    try{
      const d=await directoryData();if(token!==version||current!==position)return;
      const rows=nearbyGroceryMatches(d.stores,position,Number(radius.value),{connectedOnly:connected.checked});
      status.textContent=`${pointName||'Выбранная точка'} · до ${radius.value} км по прямой. Найдено в справочнике: ${rows.length}. Карта от ${new Date(d.observedAt).toLocaleDateString('ru-RU')}.`
        +(rows.length?' Выбери магазин, затем соберём корзину.':' Попробуй больший радиус или другую точку. Это не значит, что магазинов поблизости нет.')
        +(connected.checked?' Чтобы увидеть остальные магазины, сними фильтр «Только с подключённым каталогом».':'');
      for(const row of rows.slice(0,limit)){
        const card=el('article');card.className='nearby-store';
        card.append(el('strong',row.name+' · '+(row.distanceMeters<1000?Math.round(row.distanceMeters)+' м':(row.distanceMeters/1000).toFixed(1)+' км')),
          el('p',row.address??'Адрес в карте не указан'),el('small',row.catalog?'Каталог этого адреса подключён; цены проверим при подборе.':'Каталог этого адреса пока не подключён. Цены неизвестны.'));
        if(row.catalog)card.append(button('Выбрать магазин',()=>choose(row)));
        const link=el('a','Источник адреса');link.href=row.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';card.append(link);results.append(card);
      }
      if(rows.length>limit)results.append(button('Показать ещё 12',()=>{limit+=12;void renderResults();}));
    }catch{if(token===version)status.textContent='Справочник сейчас не загрузился. Место сохранилось; попробуй ещё раз или выбери магазин в каталоге.';}
  }
  async function choose(row){
    const token=version;clearSelection();status.textContent='Выбираю адрес каталога…';
    const accepted=await onChoose?.(row.catalog,row,()=>token===version);
    if(token!==version)return;
    if(accepted!==true){status.textContent='Этот адрес не удалось подключить. Корзина сохранилась; выбери другой магазин.';return;}
    chosen=row;selection.hidden=false;selection.append(el('strong','Выбран: '+row.name),el('p',row.address),
      button('Собрать корзину здесь',()=>{if(chosen===row)onBuild?.(row.catalog,row);}));
    status.textContent='Магазин согласован. Теперь уточним продукты и покажем цены, которые удастся подтвердить.';
    selection.scrollIntoView({block:'center'});
  }
  async function searchAddress(){
    const query=input.value.trim();if(query.length<3){status.textContent='Напиши город и улицу, адрес дома или название станции.';return;}
    geo.clear();const token=++version;clearSelection();position=null;candidates.replaceChildren();results.replaceChildren();addressButton.disabled=true;
    status.textContent='Ищу адрес…';
    const response=await port.address(query);if(token!==version){addressButton.disabled=false;return;}addressButton.disabled=false;
    if(response.kind!=='results'||!response.candidates.length){status.textContent=response.kind==='limited'?'Слишком частые запросы. Подожди немного или выбери место на карте.':'Адрес не удалось найти. Добавь город и номер дома или укажи место на карте.';return;}
    status.textContent='Это нужное место? Выбери один из адресов.';
    for(const p of response.candidates){if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||typeof p.label!=='string'||p.label.length>500)continue;
      candidates.append(button(p.label+(p.precision==='house'?'':' · приблизительный ориентир'),()=>{pendingPlaceLabel=p.label;geo.setManual({lat:p.lat,lon:p.lon});candidates.replaceChildren();}));}
    candidates.scrollIntoView({block:'center'});
  }
  const locationChanged=s=>{
    version++;clearSelection();
    if(s.status==='loading'){status.textContent='Жду разрешение браузера на геолокацию…';return;}
    if(s.position){position=s.position;pointName=pendingPlaceLabel??(s.position.source==='manual'?'Точка на карте':`Моё место · точность ≈${Math.round(s.position.accuracyMeters)} м`);pendingPlaceLabel=null;limit=12;
      panel.hidden=false;openButton.setAttribute('aria-expanded','true');void renderResults();}
    else if(s.status==='idle'){position=null;pointName='';results.replaceChildren();}
    else if(s.status!=='idle'){status.textContent=s.status==='denied'?'Доступ к геолокации закрыт. Можно написать адрес или указать место на карте.':'Место не определилось. Напиши адрес или выбери точку на карте.';}
  };
  const geo=locationController??createStoreGeolocation({...geolocationOptions,onChange:locationChanged});
  if(locationController)geo.subscribe(locationChanged);
  radius.addEventListener('change',()=>{clearSelection();limit=12;void renderResults();});
  connected.addEventListener('change',()=>{limit=12;void renderResults();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void searchAddress();}});
  return{element:root,open,setPosition:p=>p?geo.setManual(p):geo.clear(),
    getChosen:()=>chosen,clear:()=>clear.click()};
}
