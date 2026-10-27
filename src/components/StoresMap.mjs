import { createMagnitStoreDirectory } from "./MagnitStoreDirectory.mjs";
import {
  APPROXIMATE_MAP_LOCATIONS, KNOWN_STORE_MAP_LOCATIONS, resolveStoreMapLocation
} from "../data/storeMapLocations.mjs";
import {
  createStoreGeolocation, distanceMeters, normalizeMapCenter, normalizeMapZoom, shiftMapCenter
} from "../runtime/storeGeolocation.mjs";

const TILE_SIZE = 256;
const TILE_HOST = "https://tile.openstreetmap.org";
const DEFAULT_CENTER = Object.freeze({ lat: 55.70, lon: 37.8 });
const DEFAULT_ZOOM = 9;
const COLORS = Object.freeze({ globus: "#a14700", metro: "#003d7d", magnit: "#c40013" });

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
  observedStores = KNOWN_STORE_MAP_LOCATIONS,
  networkRetailers = NETWORK_RETAILERS,
  selectedScope = null,
  onStoreSelect,
  onEditStore,
  loadBoundMagnitLocations,
  locationController,
  geolocationOptions = {}
} = {}) {
  const section = document.createElement("section");
  section.className = "future-step stores-section"; section.id = "stores-section";
  section.setAttribute("aria-label", "Магазины, с которыми работает CHECKNI");
  section.append(textEl("p", "eyebrow", "Магазины"),
    textEl("h2", null, "Магазины и ваше место"),
    textEl("p", "stores-copy", "Выберите адрес для корзины. Точки «Глобуса» взяты из официального справочника; "
      + "точка на карте приблизительная у магазинов со знаком ≈. Координаты не подтверждают свежую цену или наличие."));

  let center = { ...DEFAULT_CENTER }, zoom = DEFAULT_ZOOM, manualPicking = false;
  let geoState = { status: "idle", position: null };
  let currentScope = selectedScope;
  let mapStores = [...observedStores];
  const controls = textEl("div", "stores-controls", "");
  const geoButton = button("Определить моё место", () => geo.request());
  geoButton.id = "stores-locate";
  const manualButton = button("Указать место на карте", () => {
    manualPicking = !manualPicking;
    manualButton.setAttribute("aria-pressed", String(manualPicking));
    map.classList.toggle("stores-map-picking", manualPicking);
    renderGeoStatus();
    renderMap();
    if (manualPicking) map.focus({ preventScroll: true });
  });
  manualButton.id = "stores-manual-location"; manualButton.setAttribute("aria-pressed", "false");
  const clearButton = button("Убрать моё место", () => {
    center = { ...DEFAULT_CENTER }; zoom = DEFAULT_ZOOM;
    manualPicking = false; manualButton.setAttribute("aria-pressed", "false");
    map.classList.remove("stores-map-picking"); geo.clear();
  });
  clearButton.id = "stores-clear-location";
  controls.append(geoButton, manualButton, clearButton);
  const geoStatus = textEl("p", "stores-status", "");
  geoStatus.id = "stores-location-status"; geoStatus.setAttribute("role", "status");
  const privacy = textEl("p", "stores-copy",
    "Место используется в этой вкладке для ориентирования и расстояний. После перезагрузки укажите его снова. "
    + "Карта OpenStreetMap загружает изображения выбранного участка. Выбор адресов и расчёт корзины остаются за вами.");

  const mapControls = textEl("div", "stores-map-controls", "");
  function redrawCenter(next) { if (next) { center = next; renderMap(); } }
  const zoomIn = button("Приблизить", () => { zoom = Math.min(16, zoom + 1); renderMap(); });
  const zoomOut = button("Отдалить", () => { zoom = Math.max(3, zoom - 1); renderMap(); });
  const ownCenter = button("К моему месту", () => {
    if (geoState.position) { center = normalizeMapCenter(geoState.position); zoom = 12; renderMap(); }
  });
  mapControls.append(zoomIn, zoomOut,
    button("←", () => redrawCenter(shiftMapCenter(center, -180, 0, zoom))),
    button("↑", () => redrawCenter(shiftMapCenter(center, 0, -180, zoom))),
    button("↓", () => redrawCenter(shiftMapCenter(center, 0, 180, zoom))),
    button("→", () => redrawCenter(shiftMapCenter(center, 180, 0, zoom))),
    ownCenter, button("Показать магазины", () => { center = { ...DEFAULT_CENTER }; zoom = DEFAULT_ZOOM; renderMap(); }));
  ["Запад", "Север", "Юг", "Восток"].forEach((label, i) =>
    mapControls.children[i + 2].setAttribute("aria-label", "Карта: " + label));
  const map = textEl("div", "stores-map", "");
  map.style.aspectRatio = "1 / 1"; map.tabIndex = 0;
  map.setAttribute("aria-label", "Карта магазинов. Место можно указать после кнопки «Указать место на карте»");
  const canvas = textEl("div", "stores-map-canvas", ""); map.append(canvas);
  const tileStatus = textEl("p", "stores-status", "");
  tileStatus.id = "stores-tile-status"; tileStatus.setAttribute("role", "status");
  map.addEventListener("click", event => {
    if (!manualPicking || event.target.closest(".stores-pin")) return;
    const rect = map.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = shiftMapCenter(center, (event.clientX - rect.left - rect.width / 2) * 512 / rect.width,
      (event.clientY - rect.top - rect.height / 2) * 512 / rect.height, zoom);
    if (point) geo.setManual(point);
  });
  map.addEventListener("keydown", event => {
    if (event.target !== map) return;
    const shifts = { ArrowLeft: [-180, 0], ArrowRight: [180, 0], ArrowUp: [0, -180], ArrowDown: [0, 180] };
    if (shifts[event.key]) { event.preventDefault(); redrawCenter(shiftMapCenter(center, ...shifts[event.key], zoom)); }
    else if (manualPicking && event.key === "Enter") { event.preventDefault(); geo.setManual(center); }
    else if (event.key === "Escape" && manualPicking) {
      manualPicking = false; manualButton.setAttribute("aria-pressed", "false");
      map.classList.remove("stores-map-picking"); renderGeoStatus(); renderMap(); manualButton.focus();
    }
  });
  const attribution = textEl("p", "stores-map-attribution", "Карта: ");
  attribution.append(externalLink("© участники OpenStreetMap", "https://www.openstreetmap.org/copyright"));
  const selected = textEl("div", "stores-selected", "");
  selected.id = "stores-selected-addresses"; selected.setAttribute("aria-label", "Адреса на карте для сравнения");
  const list = textEl("ul", "stores-list", "");
  list.id = "stores-known-locations";
  const listNote = textEl("p", "stores-copy",
    "Расстояние — по прямой, без маршрута и времени в пути. Список точек неполный; "
    + "адреса без координат доступны через выбор магазина. Меньшее расстояние не означает меньшую стоимость корзины.");
  const directory = document.createElement("details");
  directory.className = "stores-location-directory";
  const summary = textEl("summary", null, `Все точки с координатами: ${observedStores.length}`);
  directory.append(summary, listNote, list);

  function matchesScopeRow(row, store) {
    return store.selectionKind === "registered-store" && row.retailerId === "magnit"
      ? row.shopCode === store.shopCode && row.address === store.catalogBinding?.address
        && row.storeIds.every(id => store.storeIds.includes(id))
      : resolveStoreMapLocation(row, { mode: currentScope.mode })?.id === store.id;
  }
  function isSelected(store) {
    return currentScope?.valid && currentScope.stores.some(row => matchesScopeRow(row, store));
  }
  function canSelect(store) {
    return typeof onStoreSelect === "function" && store.selectionKind !== "live-example-only";
  }
  function chooseStore(store) { if (canSelect(store)) onStoreSelect(store); }
  function renderMap() {
    const pins = [...mapStores];
    if (geoState.position) pins.push({ ...geoState.position, id: "user-location", name: "Ваше место" });
    const layout = staticMapLayout({ centerLat: center.lat, centerLon: center.lon, zoom,
      widthTiles: 2, heightTiles: 2, pins });
    canvas.replaceChildren(); tileStatus.textContent = "";
    for (const tile of layout.tiles) {
      const img = document.createElement("img");
      img.src = tile.url; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
      // OSM requires the page's origin as Referer; default browser cache is preserved.
      img.referrerPolicy = "strict-origin-when-cross-origin";
      img.style.left = tile.left / layout.widthPx * 100 + "%";
      img.style.top = tile.top / layout.heightPx * 100 + "%";
      img.style.width = TILE_SIZE / layout.widthPx * 100 + "%";
      img.addEventListener("error", () => {
        if (img.isConnected) tileStatus.textContent = "Фон карты не загрузился. Точки и выбор адресов в списке работают.";
      }, { once: true });
      canvas.append(img);
    }
    for (const pin of layout.pins) {
      if (!pin.inside) continue;
      const own = pin.id === "user-location";
      const marker = own ? textEl("span", "stores-user-pin", "")
        : manualPicking || canSelect(pin) ? button("", event => {
          event.stopPropagation();
          if (manualPicking) geo.setManual({ lat: pin.lat, lon: pin.lon });
          else chooseStore(pin);
        }, "stores-pin")
          : externalLink("", pointMapUrl(pin));
      if (!own) {
        marker.className = "stores-pin"; marker.dataset.storeLocationId = pin.id;
        marker.style.background = COLORS[pin.retailerId] ?? pin.color ?? "#394e57";
        marker.classList.toggle("stores-pin-selected", Boolean(isSelected(pin)));
        marker.setAttribute("aria-label", manualPicking
          ? `Указать ориентир: ${pin.name}, ${pin.address}`
          : canSelect(pin) ? `Выбрать для корзины: ${pin.name}, ${pin.address}`
            : `${pin.name}, ${pin.address}, открыть точку на OpenStreetMap`);
        marker.title = `${pin.name} · ${pin.address} · ${coordinateNote(pin)}`;
        marker.append(textEl("span", "stores-pin-label", pin.name));
      } else {
        marker.setAttribute("role", "img"); marker.setAttribute("aria-label", "Ваше место");
        marker.append(textEl("span", "stores-user-pin-label", geoState.position.source === "manual" ? "Ваш ориентир" : "Вы здесь"));
      }
      marker.style.left = pin.left / layout.widthPx * 100 + "%";
      marker.style.top = pin.top / layout.heightPx * 100 + "%";
      canvas.append(marker);
    }
    zoomIn.disabled = zoom >= 16; zoomOut.disabled = zoom <= 3;
    ownCenter.disabled = !geoState.position;
  }
  function renderSelected() {
    selected.replaceChildren();
    if (!currentScope?.valid) return;
    selected.append(textEl("h3", null, "Адреса для сравнения корзины"));
    const rows = textEl("ul", "stores-list", "");
    for (const store of currentScope.stores) {
      const point = mapStores.find(pin => matchesScopeRow(store, pin))
        ?? resolveStoreMapLocation(store, { mode: currentScope.mode });
      const row = textEl("li", null, "");
      row.append(textEl("strong", null, store.name), textEl("span", "stores-list-note", store.address),
        externalLink("Найти этот адрес на карте", storeAddressMapUrl(store)),
        textEl("span", "stores-list-note", point ? coordinateNote(point) + distanceNote(geoState.position, point)
          : "Координаты не подтверждены; расстояние неизвестно."));
      if (typeof onEditStore === "function") row.append(button("Изменить адрес " + store.name, () => onEditStore(store.retailerId)));
      rows.append(row);
    }
    selected.append(rows, textEl("p", "stores-copy",
      "Корзина сравнивается только по выбранным адресам и подходящим свежим ценам. Геопозиция сама не меняет адреса."));
  }
  function renderList() {
    list.replaceChildren();
    const stores = [...mapStores];
    if (geoState.position) stores.sort((a, b) =>
      (distanceMeters(geoState.position, a) ?? Infinity) - (distanceMeters(geoState.position, b) ?? Infinity));
    for (const store of stores) {
      const row = textEl("li", null, ""); row.dataset.storeLocationId = store.id;
      row.append(textEl("strong", null, store.name), textEl("span", "stores-list-note", store.address),
        textEl("span", "stores-list-note", coordinateNote(store) + distanceNote(geoState.position, store)),
        externalLink("Открыть адрес на карте", storeAddressMapUrl(store)));
      if (canSelect(store)) {
        const choose = button(isSelected(store) ? "Выбран для корзины" : "Выбрать для корзины", () => chooseStore(store));
        choose.disabled = Boolean(isSelected(store)); row.append(choose);
      }
      list.append(row);
    }
    for (const retailer of networkRetailers) {
      const row = textEl("li", null, "");
      row.append(externalLink(retailer.name, retailer.url),
        textEl("span", "stores-list-note", " — цены с сайта сети, конкретный магазин не привязан"));
      list.append(row);
    }
  }
  function renderGeoStatus() {
    geoButton.disabled = geoState.status === "loading";
    clearButton.disabled = geoState.status === "idle" && !manualPicking;
    const messages = {
      idle: "Место ещё не указано. Определите его или укажите точку вручную.",
      loading: "Определяем место… Можно указать точку вручную или отменить.",
      denied: "Доступ к геопозиции запрещён. Разрешите его в браузере или укажите точку вручную.",
      unavailable: "Геопозиция недоступна. Укажите точку на карте вручную.",
      timeout: "Не удалось определить место за отведённое время. Повторите или укажите точку вручную."
    };
    geoStatus.textContent = manualPicking ? "Нажмите нужное место на карте. Enter выбирает центр; Escape отменяет."
      : geoState.position ? geoState.position.source === "manual" ? "Ориентир указан вручную."
        : `Место определено. Точность устройства: ≈ ${Math.round(geoState.position.accuracyMeters)} м.`
        : messages[geoState.status];
  }
  const locationChanged = state => {
    geoState = state;
    if (state.position) {
      manualPicking = false; manualButton.setAttribute("aria-pressed", "false");
      map.classList.remove("stores-map-picking"); center = normalizeMapCenter(state.position); zoom = 12;
    }
    if(state.status==='idle'){center={...DEFAULT_CENTER};zoom=DEFAULT_ZOOM;}
    renderGeoStatus(); renderMap(); renderSelected(); renderList();
  };
  const geo=locationController??createStoreGeolocation({...geolocationOptions,onChange:locationChanged});
  if(locationController)geo.subscribe(locationChanged);
  section.updateSelection = scope => {
    currentScope = scope; renderSelected(); renderList(); renderMap();
  };
  section.append(controls, geoStatus, privacy, mapControls, map, attribution, tileStatus, selected,
    directory, createMagnitStoreDirectory());
  renderGeoStatus(); renderMap(); renderSelected(); renderList();
  if (typeof loadBoundMagnitLocations === "function") {
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      Promise.resolve().then(loadBoundMagnitLocations).then(locations => {
        if (!Array.isArray(locations) || !locations.length) return;
        mapStores = [...observedStores, ...locations];
        summary.textContent = `Все точки с координатами: ${mapStores.length}`;
        renderMap(); renderSelected(); renderList();
      }).catch(() => { /* Keep the existing points and address picker usable. */ });
    };
    if (typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
      });
      observer.observe(section);
    } else load();
    directory.addEventListener("toggle", () => { if (directory.open) load(); });
    map.addEventListener("pointerenter", load, { once: true });
    map.addEventListener("focusin", load, { once: true });
  }
  return section;
}

function textEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text; return node;
}
