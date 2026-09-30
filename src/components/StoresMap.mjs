// "Магазины" section: an honest, dependency-free map of the stores whose
// prices CHECKNI actually works with. Built from OpenStreetMap raster
// tiles (© OpenStreetMap contributors, ODbL) laid out as plain <img>
// elements plus positioned pins — no external JS. Addresses of observed
// stores come from live price evidence; pin positions are approximate
// ("≈") and say so. Network-level retailers (site prices, no bound
// store) are listed separately and never get a pin, so a network price
// is never dressed up as a store observation.

const TILE_SIZE = 256;
const TILE_HOST = "https://tile.openstreetmap.org";

// Web-Mercator projection to global pixel coordinates at a zoom level.
export function mercatorPoint(lat, lon, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

// Static tile-grid layout: which tiles to draw and where each pin lands
// inside the grid, for a map of widthTiles × heightTiles centred on
// (centerLat, centerLon). Pure and unit-testable.
export function staticMapLayout({
  centerLat,
  centerLon,
  zoom,
  widthTiles,
  heightTiles,
  pins
}) {
  const center = mercatorPoint(centerLat, centerLon, zoom);
  const widthPx = widthTiles * TILE_SIZE;
  const heightPx = heightTiles * TILE_SIZE;
  const originX = center.x - widthPx / 2;
  const originY = center.y - heightPx / 2;
  const tileX0 = Math.floor(originX / TILE_SIZE);
  const tileY0 = Math.floor(originY / TILE_SIZE);
  const offsetX = tileX0 * TILE_SIZE - originX;
  const offsetY = tileY0 * TILE_SIZE - originY;

  const tiles = [];
  for (let row = 0; row <= heightTiles; row += 1) {
    for (let col = 0; col <= widthTiles; col += 1) {
      tiles.push({
        url: `${TILE_HOST}/${zoom}/${tileX0 + col}/${tileY0 + row}.png`,
        left: offsetX + col * TILE_SIZE,
        top: offsetY + row * TILE_SIZE
      });
    }
  }

  const placedPins = pins.map((pin) => {
    const point = mercatorPoint(pin.lat, pin.lon, zoom);
    return {
      ...pin,
      left: point.x - originX,
      top: point.y - originY,
      inside: point.x >= originX && point.x <= originX + widthPx
        && point.y >= originY && point.y <= originY + heightPx
    };
  });

  return { widthPx, heightPx, tiles, pins: placedPins };
}

// Stores CHECKNI actually observes live prices from (addresses come from
// the live evidence itself). Coordinates are approximate on purpose and
// labelled "≈" — the address is the truth, the pin is orientation.
export const OBSERVED_STORES = Object.freeze([
  Object.freeze({
    id: "metro-leningradskoe",
    name: "METRO",
    address: "125445, Москва, Ленинградское ш., 71Г",
    lat: 55.8551,
    lon: 37.4778,
    color: "#003d7d",
    note: "живые наблюдения цен"
  }),
  Object.freeze({
    id: "magnit-1812",
    name: "Магнит",
    address: "Москва, ул. 1812 года, 12",
    lat: 55.7415,
    lon: 37.5095,
    color: "#e30613",
    note: "живые наблюдения цен"
  })
]);

export const NETWORK_RETAILERS = Object.freeze([
  Object.freeze({ name: "Перекрёсток", url: "https://www.perekrestok.ru", color: "#2e8b3e" }),
  Object.freeze({ name: "ВкусВилл", url: "https://vkusvill.ru", color: "#1f9a4a" }),
  Object.freeze({ name: "Чижик", url: "https://chizhik.club", color: "#f2b632" })
]);

function osmLink(store) {
  return `https://www.openstreetmap.org/?mlat=${store.lat}&mlon=${store.lon}#map=15/${store.lat}/${store.lon}`;
}

export function createStoresSection({
  observedStores = OBSERVED_STORES,
  networkRetailers = NETWORK_RETAILERS
} = {}) {
  const section = document.createElement("section");
  section.className = "future-step stores-section";
  section.id = "stores-section";
  section.setAttribute("aria-label", "Магазины, с которыми работает CHECKNI");

  section.append(
    textEl("p", "eyebrow", "Магазины"),
    textEl("h2", null, "Где мы смотрим цены"),
    textEl(
      "p",
      "stores-copy",
      "Точки на карте — магазины, чьи живые цены CHECKNI наблюдает. "
      + "Адрес точный, точка на карте приблизительная (≈)."
    )
  );

  const layout = staticMapLayout({
    centerLat: 55.7983,
    centerLon: 37.4937,
    zoom: 10,
    widthTiles: 2,
    heightTiles: 2,
    pins: observedStores.map((store) => ({ ...store }))
  });

  const map = document.createElement("div");
  map.className = "stores-map";
  map.style.aspectRatio = `${layout.widthPx} / ${layout.heightPx}`;

  const canvas = document.createElement("div");
  canvas.className = "stores-map-canvas";
  for (const tile of layout.tiles) {
    const img = document.createElement("img");
    img.src = tile.url;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.style.left = `${(tile.left / layout.widthPx) * 100}%`;
    img.style.top = `${(tile.top / layout.heightPx) * 100}%`;
    img.style.width = `${(TILE_SIZE / layout.widthPx) * 100}%`;
    canvas.append(img);
  }
  for (const pin of layout.pins) {
    if (!pin.inside) continue;
    const marker = document.createElement("a");
    marker.className = "stores-pin";
    marker.href = osmLink(pin);
    marker.target = "_blank";
    marker.rel = "noopener noreferrer";
    marker.title = `≈ ${pin.name} — ${pin.address}`;
    marker.setAttribute("aria-label", `${pin.name}, ${pin.address}, открыть на карте OpenStreetMap`);
    marker.style.left = `${(pin.left / layout.widthPx) * 100}%`;
    marker.style.top = `${(pin.top / layout.heightPx) * 100}%`;
    marker.style.background = pin.color;
    marker.append(textEl("span", "stores-pin-label", pin.name));
    canvas.append(marker);
  }
  map.append(canvas);

  const attribution = document.createElement("p");
  attribution.className = "stores-map-attribution";
  const osm = document.createElement("a");
  osm.href = "https://www.openstreetmap.org/copyright";
  osm.target = "_blank";
  osm.rel = "noopener noreferrer";
  osm.textContent = "© участники OpenStreetMap";
  attribution.append("Карта: ", osm);

  const list = document.createElement("ul");
  list.className = "stores-list";
  for (const store of observedStores) {
    const item = document.createElement("li");
    item.append(
      swatch(store.color),
      textEl("strong", null, store.name),
      textEl("span", "stores-list-note", ` — ${store.address} · ${store.note}`)
    );
    list.append(item);
  }
  for (const retailer of networkRetailers) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = retailer.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = retailer.name;
    item.append(
      swatch(retailer.color),
      link,
      textEl(
        "span",
        "stores-list-note",
        " — цены с сайта сети, конкретный магазин не привязан"
      )
    );
    list.append(item);
  }

  section.append(map, attribution, list);
  return section;
}

function textEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function swatch(color) {
  const node = document.createElement("span");
  node.className = "stores-swatch";
  node.setAttribute("aria-hidden", "true");
  node.style.background = color;
  return node;
}
