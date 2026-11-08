import { createMagnitStoreDirectory } from "./MagnitStoreDirectory.mjs";
import { createInteractiveStoreMap } from "../runtime/mapLibreMap.mjs";
import { nearbyCatalogBinding, nearestStoreMapPins } from "../intelligence/nearbyShopping.mjs";
import {
  APPROXIMATE_MAP_LOCATIONS, KNOWN_STORE_MAP_LOCATIONS, resolveStoreMapLocation
} from "../data/storeMapLocations.mjs";
import {
  createStoreGeolocation, distanceMeters, normalizeMapCenter, normalizeMapZoom, shiftMapCenter
} from "../runtime/storeGeolocation.mjs";
import { yandexStoreRouteUrl } from "../navigation/storeRoute.mjs";

const TILE_SIZE = 256;
const TILE_HOST = "https://tile.openstreetmap.org";
const DEFAULT_CENTER = Object.freeze({ lat: 55.70, lon: 37.8 });
const DEFAULT_ZOOM = 9;
const COLORS = Object.freeze({ globus: "#a14700", metro: "#003d7d", magnit: "#c40013" });
const STORE_LIST_PAGE_SIZE = 5;

// Kept for callers of the original two-point orientation map.
export const OBSERVED_STORES = Object.freeze(APPROXIMATE_MAP_LOCATIONS.map(store =>
  Object.freeze({ ...store, color: COLORS[store.retailerId], note: "сохранённые наблюдения цен" })));
export const NETWORK_RETAILERS = Object.freeze([
  Object.freeze({ name: "Перекрёсток", url: "https://www.perekrestok.ru", color: "#2e8b3e" }),
  Object.freeze({ name: "ВкусВилл", url: "https://vkusvill.ru", color: "#1f9a4a" }),
  Object.freeze({ name: "Чижик", url: "https://chizhik.club", color: "#f2b632" })
]);

export function mercatorPoint(lat, lon, zoom) {
  const center = normalizeMapCenter({ lat, lon });
  const z = normalizeMapZoom(zoom);
  // Reference projection also supports zoom 0–2 for existing callers.
  const projectionZoom = Number.isInteger(zoom) && zoom >= 0 && zoom <= 16 ? zoom : z;
  if (!center || projectionZoom === null) throw new TypeError("Invalid map coordinate");
  const scale = TILE_SIZE * 2 ** projectionZoom;
  const sinLat = Math.sin(center.lat * Math.PI / 180);
  return {
    x: ((center.lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  };
}

export function staticMapLayout({ centerLat, centerLon, zoom, widthTiles, heightTiles, pins }) {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 16
      || !Number.isInteger(widthTiles) || widthTiles < 1 || widthTiles > 4
      || !Number.isInteger(heightTiles) || heightTiles < 1 || heightTiles > 4
      || !Array.isArray(pins)) throw new TypeError("Invalid map layout");
  const center = mercatorPoint(centerLat, centerLon, zoom);
  const widthPx = widthTiles * TILE_SIZE, heightPx = heightTiles * TILE_SIZE;
  const originX = center.x - widthPx / 2, originY = center.y - heightPx / 2;
  const tileX0 = Math.floor(originX / TILE_SIZE), tileY0 = Math.floor(originY / TILE_SIZE);
  const tileCount = 2 ** zoom, world = tileCount * TILE_SIZE;
  const tiles = [];
  for (let row = 0; row <= heightTiles; row += 1) {
    const y = tileY0 + row;
    if (y < 0 || y >= tileCount) continue;
    for (let col = 0; col <= widthTiles; col += 1) {
      const x = ((tileX0 + col) % tileCount + tileCount) % tileCount;
      tiles.push({ url: `${TILE_HOST}/${zoom}/${x}/${y}.png`,
        left: (tileX0 + col) * TILE_SIZE - originX, top: y * TILE_SIZE - originY });
    }
  }
  const placedPins = pins.filter(pin => Number.isFinite(pin?.lat) && Math.abs(pin.lat) <= 90
    && Number.isFinite(pin.lon) && Math.abs(pin.lon) <= 180).map(pin => {
    const point = mercatorPoint(pin.lat, pin.lon, zoom);
    const x = point.x + Math.round((center.x - point.x) / world) * world;
    const left = x - originX, top = point.y - originY;
    return { ...pin, left, top, inside: left >= 0 && left <= widthPx && top >= 0 && top <= heightPx };
  });
  return { widthPx, heightPx, tiles, pins: placedPins };
}

export function storeAddressMapUrl(store) {
  return "https://www.openstreetmap.org/search?query=" + encodeURIComponent(store.address);
}

function pointMapUrl(store) {
  return `https://www.openstreetmap.org/?mlat=${store.lat}&mlon=${store.lon}#map=15/${store.lat}/${store.lon}`;
}
function externalLink(label, url) {
  const link = textEl("a", null, label);
  link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
  return link;
}
function button(label, action, className) {
  const node = textEl("button", className, label);
  node.type = "button"; node.addEventListener("click", action); return node;
}
function coordinateNote(store) {
  return store.coordinateKind === "official-directory"
    ? "точка официального справочника от 10.10.2026"
    : store.coordinateKind === "osm-exact-address-join"
      ? `точка OpenStreetMap на ${new Date(store.observedAt).toLocaleDateString("ru-RU")} · адрес сопоставлен со справочником Магнита; цена и наличие не подтверждены`
    : "≈ приблизительная точка для ориентира";
}
function distanceNote(position, store) {
  const meters = distanceMeters(position, store);
  return meters === null ? "" : ` · ≈ ${(meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км по прямой`;
}

export function createStoresSection({
  observedStores = KNOWN_STORE_MAP_LOCATIONS, networkRetailers = NETWORK_RETAILERS,
  selectedScope = null, onStoreSelect, onEditStore, onBackToNearby, loadBoundMagnitLocations,
  locationController, geolocationOptions = {}, createMap = createInteractiveStoreMap
} = {}) {
  const section = textEl('section', 'future-step stores-section stores-interactive', '');
  section.id = 'stores-section'; section.setAttribute('aria-label', 'Магазины, с которыми работает CHECKNI');
  const css = document.createElement('link'); css.rel = 'stylesheet';
  css.href = new URL('./stores-interactive.css', import.meta.url).href; document.head.append(css);
  const heading = textEl('h2', null, 'Магазины на карте');
  let center = { ...DEFAULT_CENTER }, zoom = DEFAULT_ZOOM, manualPicking = false, nearbyMode = false;
  let geoState = { status: 'idle', position: null }, currentScope = selectedScope;
  let mapStores = [...observedStores], nearbyContext = null, contextPins = null, contextRevision = 0;
  let mapApi = null, mapStarting = null, mapFailure = false, listLimit = STORE_LIST_PAGE_SIZE, focusedPin = null;
  let accessibleListOpen = false;
  const controls = textEl('div', 'stores-controls', '');
  const geoButton = button('Моё место', () => geo.request()); geoButton.id = 'stores-locate'; geoButton.setAttribute('aria-label','Определить моё место');
  const manualButton = button('Указать точку', () => {
    manualPicking = !manualPicking; renderGeoStatus(); void openMap(); map.focus({ preventScroll: true });
  });
  manualButton.id = 'stores-manual-location'; manualButton.setAttribute('aria-pressed', 'false'); manualButton.setAttribute('aria-label','Указать место на карте');
  const clearButton = button('Убрать моё место', () => { manualPicking = false; geo.clear(); });
  clearButton.id = 'stores-clear-location';
  const back = onBackToNearby ? button('← Список', () => { setNearbyMode(false); onBackToNearby(); }) : null;
  if (back) {back.setAttribute('aria-label','К списку магазинов');controls.append(back);}
  controls.append(geoButton, manualButton);
  const geoStatus = textEl('p', 'stores-status', ''); geoStatus.id = 'stores-location-status'; geoStatus.setAttribute('role', 'status');
  const mapControls = textEl('div', 'stores-map-controls', '');
  const networkLabel = textEl('label', 'stores-map-network-label', 'Сеть на карте'); networkLabel.htmlFor = 'stores-map-network';
  const networkFilter = document.createElement('select'); networkFilter.id = 'stores-map-network'; networkFilter.className = 'stores-map-network-filter';
  for (const [value, label] of [['all','Все сети'],['globus','Глобус'],['metro','METRO'],['magnit','Магнит'],
    ['perekrestok','Перекрёсток'],['pyaterochka','Пятёрочка'],['vkusvill','ВкусВилл'],['lenta','Лента'],['okey','О’КЕЙ'],['auchan','Ашан'],['chizhik','Чижик']]) {
    const option = textEl('option', null, label); option.value = value; networkFilter.append(option);
  }
  networkFilter.addEventListener('change', () => { listLimit = STORE_LIST_PAGE_SIZE; focusedPin = null; pinCard.hidden = true; renderMap(); renderList(); });
  function moveCamera(point, level = zoom) {
    if (!point) return; center = point; zoom = level; mapApi?.setCamera(center, zoom); renderControls();
  }
  const zoomIn = button('+', () => { void openMap(); moveCamera(center, Math.min(16, zoom + 1)); });
  zoomIn.setAttribute('aria-label','Приблизить');
  const zoomOut = button('−', () => { void openMap(); moveCamera(center, Math.max(3, zoom - 1)); });
  zoomOut.setAttribute('aria-label','Отдалить');
  const searchHere = button('Искать здесь', () => geo.setManual(center)); searchHere.className = 'stores-search-here';
  const listToggle = button('Магазины списком', () => {
    accessibleListOpen = !accessibleListOpen;
    listToggle.setAttribute('aria-expanded', String(accessibleListOpen));
    directory.hidden = !accessibleListOpen;
    directory.open = accessibleListOpen;
    if (accessibleListOpen) requestAnimationFrame(() => {
      const firstStore = list.querySelector('button');
      firstStore?.focus(); firstStore?.scrollIntoView({ block:'nearest' });
    });
    else map.focus({ preventScroll: true });
  });
  listToggle.className = 'stores-list-toggle';
  listToggle.setAttribute('aria-expanded','false');
  const ownCenter = button('К моему месту', () => { if (geoState.position) moveCamera(normalizeMapCenter(geoState.position), 13); });
  const navigation = document.createElement('details'); navigation.className = 'stores-map-navigation';
  navigation.append(textEl('summary', null, 'Другие действия'), ownCenter, clearButton);
  mapControls.append(networkLabel, networkFilter, zoomOut, zoomIn, searchHere, listToggle);
  const map = textEl('div', 'stores-map', ''); map.tabIndex = 0;
  map.setAttribute('aria-label', 'Карта магазинов. Перемещай карту, затем нажми «Искать здесь». Enter выбирает центр.');
  const canvas = textEl('div','stores-map-canvas stores-vector-canvas','');
  const launch = button('Открыть карту', () => void openMap(), 'stores-map-launch');
  map.append(canvas, launch);
  const tileStatus = textEl('p', 'stores-status', ''); tileStatus.id = 'stores-tile-status'; tileStatus.setAttribute('role','status');
  const retry = button('Повторить загрузку карты', () => {
    mapApi?.destroy(); mapApi = null; mapStarting = null; canvas.replaceChildren(); void openMap();
  }); retry.hidden = true;
  const pinCard = textEl('div','stores-selected stores-pin-card',''); pinCard.hidden = true;
  pinCard.tabIndex = -1; pinCard.setAttribute('aria-label','Выбранный магазин');
  const mapFrame = textEl('div','stores-map-frame',''); mapFrame.append(map,pinCard);
  const selected = textEl('div','stores-selected',''); selected.id = 'stores-selected-addresses';
  selected.setAttribute('aria-label','Адреса на карте для сравнения');
  const list = textEl('ul','stores-list',''); list.id = 'stores-known-locations';
  const directory = document.createElement('details'); directory.className = 'stores-location-directory';
  directory.id = 'stores-location-directory'; listToggle.setAttribute('aria-controls', directory.id);
  const summary = textEl('summary',null,'Магазины списком');
  const listCount = textEl('p','stores-list-count',''); listCount.setAttribute('role','status');
  const more = button('Показать ещё магазины', () => {
    listLimit += STORE_LIST_PAGE_SIZE; renderList();
  });
  directory.append(summary,listCount,list,more);
  const mapInfo = document.createElement('details'); mapInfo.className = 'stores-map-info';
  mapInfo.append(textEl('summary',null,'О карте и данных'), textEl('p','stores-copy',
    'Расстояния — по прямой. Точка на карте не подтверждает цены, наличие или работу магазина. Место хранится только в этой вкладке. При открытии карты OpenFreeMap получает запросы участков карты; адрес и список покупок туда не отправляются.'));
  const attribution = textEl('p','stores-map-attribution','');
  attribution.append(externalLink('OpenFreeMap','https://openfreemap.org'), document.createTextNode(' · '),
    externalLink('© OpenMapTiles','https://openmaptiles.org'), document.createTextNode(' · '),
    externalLink('© OpenStreetMap','https://www.openstreetmap.org/copyright'));
  const magnitDirectory = createMagnitStoreDirectory();
  function availablePins() { return (contextPins ?? mapStores).filter(store => networkFilter.value === 'all' || store.retailerId === networkFilter.value); }
  function visiblePins() {
    const pins = availablePins();
    return nearestStoreMapPins(pins,center,{selectedIds:[focusedPin?.id,...pins.filter(isSelected).map(pin=>pin.id)]});
  }
  function matchesScopeRow(row, store) {
    return store.selectionKind === 'registered-store' && row.retailerId === 'magnit'
      ? row.shopCode === store.shopCode && row.address === store.catalogBinding?.address && row.storeIds.every(id => store.storeIds?.includes(id))
      : resolveStoreMapLocation(row,{ mode: currentScope.mode })?.id === store.id;
  }
  function isSelected(store) { return currentScope?.valid && currentScope.stores.some(row => matchesScopeRow(row,store)); }
  function canSelect(store) {
    if (contextPins !== null) return Boolean(nearbyCatalogBinding(store));
    return typeof onStoreSelect === 'function' && store.selectionKind === 'registered-store';
  }
  function chooseStore(store) {
    if (!canSelect(store)) return;
    if (contextPins !== null) document.dispatchEvent(new CustomEvent('checkni:nearby-map-select', { detail: { id: store.id, revision: contextRevision } }));
    else onStoreSelect(store);
  }
  function showPin(pin, focus = false) {
    focusedPin = pin; pinCard.replaceChildren(textEl('strong',null,pin.name),textEl('p',null,pin.address || 'Адрес не указан'),
      textEl('p','stores-list-note', (canSelect(pin) ? 'Каталог этого адреса подключён' : 'Каталог адреса пока не подключён') + distanceNote(geoState.position,pin)));
    const actions = textEl('div','stores-pin-actions','');
    if (canSelect(pin)) actions.append(button('Открыть товары', () => chooseStore(pin)));
    actions.append(externalLink('Маршрут',yandexStoreRouteUrl(pin)));
    const close = button('×', () => {
      focusedPin = null; pinCard.hidden = true; renderMap(); renderList(); map.focus({ preventScroll: true });
    }, 'stores-pin-close');
    close.setAttribute('aria-label','Закрыть карточку');
    pinCard.append(actions,close);
    pinCard.hidden = false;
    renderMap(); renderList();
    if (focus) {
      pinCard.focus({ preventScroll: true });
      if (window.matchMedia?.('(max-width:899px)').matches) requestAnimationFrame(() => {
        if (!pinCard.hidden && focusedPin === pin) pinCard.scrollIntoView({block:'nearest'});
      });
    }
  }
  function createMarker(pin) {
    const marker = textEl('button','stores-pin',''); marker.type = 'button';
    marker.dataset.storeLocationId = pin.id;
    marker.style.setProperty('--store-pin-color', COLORS[pin.retailerId] ?? '#7532c5');
    marker.setAttribute('aria-label', `Открыть: ${pin.name}, ${pin.address || 'адрес не указан'}`);
    marker.classList.toggle('stores-pin-selected',Boolean(isSelected(pin)));
    marker.classList.toggle('stores-pin-focused',focusedPin?.id === pin.id);
    if (focusedPin?.id === pin.id) marker.setAttribute('aria-current','true');
    marker.append(textEl('span','stores-pin-label',pin.name)); return marker;
  }
  function mapStatus(status) {
    if (status === 'ready') {
      mapFailure = false; tileStatus.textContent = ''; retry.hidden = true;
      if (nearbyMode) { directory.open = accessibleListOpen; directory.hidden = !accessibleListOpen; summary.hidden = true; }
      listToggle.hidden = !nearbyMode;
    }
    else if (status === 'unavailable') {
      mapFailure = true; tileStatus.textContent = 'Карта не загрузилась. Магазины можно выбрать в списке ниже.';
      retry.hidden = false; directory.open = true; directory.hidden = false; summary.hidden = false; listToggle.hidden = true;
    }
  }
  function openMap() {
    launch.hidden = true; loadExtraLocations();
    if (mapApi) { mapApi.resize(); return Promise.resolve(mapApi); }
    if (mapStarting) return mapStarting;
    tileStatus.textContent = 'Загружаю карту…'; retry.hidden = true;
    mapStarting = createMap({ element: canvas, center, zoom, createMarker, onStatus: mapStatus,
      onMove: (point, level) => { center = point; zoom = level; renderMap(); },
      onPoint: point => { if (manualPicking) geo.setManual(point); },
      onSelect: pin => { if (manualPicking) geo.setManual(pin); else showPin(pin,true); }
    }).then(api => { mapApi = api; mapApi.setCamera(center,zoom); mapApi.setPins(visiblePins(),geoState.position); return api; })
      .catch(() => { mapStatus('unavailable'); return null; }).finally(() => { mapStarting = null; });
    return mapStarting;
  }
  function renderControls() {
    zoomIn.disabled = zoom >= 16; zoomOut.disabled = zoom <= 3; ownCenter.disabled = !geoState.position;
    searchHere.disabled = Boolean(geoState.position && distanceMeters(center,geoState.position) < 5);
    listToggle.hidden = !nearbyMode || mapFailure;
  }
  function renderMap() { mapApi?.setPins(visiblePins(),geoState.position); renderControls(); }
  function renderSelected() {
    selected.replaceChildren(); if (!currentScope?.valid) return;
    selected.append(textEl('h3',null,'Адреса для сравнения корзины'));
    for (const store of currentScope.stores) {
      const row = textEl('p',null,store.name+' · '+store.address);
      if (typeof onEditStore === 'function') row.append(button('Изменить адрес '+store.name,() => onEditStore(store.retailerId)));
      selected.append(row);
    }
  }
  function renderList() {
    const stores = [...availablePins()];
    if (geoState.position) stores.sort((a,b) => (distanceMeters(geoState.position,a) ?? Infinity) - (distanceMeters(geoState.position,b) ?? Infinity));
    summary.textContent = 'Магазины списком';
    const visibleCount = Math.min(stores.length, listLimit);
    listCount.textContent = stores.length
      ? `${nearbyContext?.radiusKm ? 'До '+nearbyContext.radiusKm+' км · ' : ''}Показаны ${visibleCount} ближайших${stores.length > visibleCount ? '. Можно показать ещё.' : '.'}`
      : nearbyContext?.state === 'loading' ? 'Обновляю магазины…' : 'В выбранной области магазины не найдены. Можно изменить точку или радиус в списке магазинов.';
    list.replaceChildren();
    for (const store of stores.slice(0,visibleCount)) {
      const row = textEl('li',null,''); row.dataset.storeLocationId = store.id;
      row.classList.toggle('is-focused',focusedPin?.id === store.id);
      row.classList.toggle('is-selected',Boolean(isSelected(store)));
      if (focusedPin?.id === store.id || isSelected(store)) row.setAttribute('aria-current','true');
      row.append(button(store.name,() => { moveCamera({lat:store.lat,lon:store.lon},15); showPin(store,true); }),
        textEl('span','stores-list-note',store.address || 'Адрес не указан'),
        textEl('span','stores-list-note',(canSelect(store) ? 'Каталог подключён' : 'Каталог не подключён')+distanceNote(geoState.position,store)),
        externalLink('Маршрут',yandexStoreRouteUrl(store)));
      if (canSelect(store)) row.append(button(isSelected(store) ? 'Выбран для корзины' : 'Открыть товары',() => chooseStore(store)));
      list.append(row);
    }
    more.hidden = stores.length <= visibleCount;
  }
  function renderGeoStatus() {
    geoButton.disabled = geoState.status === 'loading'; clearButton.disabled = geoState.status === 'idle' && !manualPicking;
    manualButton.setAttribute('aria-pressed',String(manualPicking)); map.classList.toggle('stores-map-picking',manualPicking);
    const messages = { idle:'Место ещё не указано. Выбери точку или определи своё место.', loading:'Определяем место…',
      denied:'Доступ к геопозиции закрыт. Можно указать точку на карте.', unavailable:'Геопозиция недоступна. Можно указать точку на карте.', timeout:'Место не определилось. Можно указать точку на карте.' };
    geoStatus.textContent = manualPicking ? 'Нажми на карту или выбери центр клавишей Enter.' : geoState.position ? 'Передвинь карту и нажми «Искать здесь».' : messages[geoState.status];
  }
  const locationChanged = state => {
    // A denied retry must preserve the previous position, region and results.
    if (['loading','denied','timeout','unavailable'].includes(state.status)) geoState = { ...state, position: geoState.position };
    else geoState = state;
    if (state.position) { manualPicking = false; moveCamera(normalizeMapCenter(state.position),13); }
    if (state.status === 'idle') { manualPicking = false; moveCamera({...DEFAULT_CENTER},DEFAULT_ZOOM); }
    renderGeoStatus(); renderMap(); renderSelected(); renderList();
  };
  const geo = locationController ?? createStoreGeolocation({...geolocationOptions,onChange:locationChanged});
  if (locationController) geo.subscribe(locationChanged);
  map.addEventListener('keydown',event => {
    if (event.target.closest('button,a,select,input')) return;
    if (event.key === 'Enter' && (manualPicking || nearbyMode)) { event.preventDefault(); geo.setManual(center); }
    else if (event.key === 'Escape') { manualPicking = false; pinCard.hidden = true; renderGeoStatus(); manualButton.focus(); }
    else if (event.target === map) {
      const shifts = {ArrowLeft:[-180,0],ArrowRight:[180,0],ArrowUp:[0,-180],ArrowDown:[0,180]};
      if (shifts[event.key]) { event.preventDefault(); moveCamera(shiftMapCenter(center,...shifts[event.key],zoom)); }
    }
  });
  document.addEventListener('checkni:nearby-map-context',event => {
    const context = event.detail;
    if (!context || !Number.isSafeInteger(context.revision) || context.revision < contextRevision || !Array.isArray(context.stores)) return;
    contextRevision = context.revision; nearbyContext = context; contextPins = context.stores;
    networkFilter.value = 'all'; listLimit = STORE_LIST_PAGE_SIZE; focusedPin = null; pinCard.hidden = true;
    renderMap(); renderList();
  });
  section.updateSelection = scope => { currentScope = scope; renderSelected(); renderList(); renderMap(); if (focusedPin) showPin(focusedPin); };
  function setNearbyMode(enabled) {
    nearbyMode = enabled; section.classList.toggle('stores-nearby-mode',enabled);
    magnitDirectory.hidden = enabled; selected.hidden = enabled;
    accessibleListOpen = false; listToggle.setAttribute('aria-expanded','false');
    directory.hidden = enabled && !mapFailure; directory.open = Boolean(enabled && mapFailure);
    summary.hidden = enabled && !mapFailure;
    focusedPin = null; pinCard.hidden = true; renderMap(); renderList();
  }
  section.openNearbyMap = () => {
    setNearbyMode(true); void openMap(); section.scrollIntoView({ block:'start' }); map.focus({ preventScroll:true });
  };
  let extraStarted = false;
  function loadExtraLocations() {
    if (extraStarted || typeof loadBoundMagnitLocations !== 'function') return;
    extraStarted = true;
    Promise.resolve().then(loadBoundMagnitLocations).then(locations => {
      if (!Array.isArray(locations)) return; mapStores = [...observedStores,...locations]; renderMap(); renderList();
    }).catch(() => { extraStarted = false; });
  }
  directory.addEventListener('toggle', () => {
    if (nearbyMode && !mapFailure) {
      accessibleListOpen = directory.open;
      listToggle.setAttribute('aria-expanded',String(accessibleListOpen));
    }
    if (directory.open) loadExtraLocations();
  });
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void openMap(); }
    }); observer.observe(map);
  }
  section.append(heading,controls,geoStatus,mapControls,mapFrame,tileStatus,retry,directory,navigation,selected,mapInfo,attribution,magnitDirectory);
  renderGeoStatus(); renderMap(); renderSelected(); renderList();
  return section;
}

function textEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text; return node;
}
