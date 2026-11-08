// The map renderer never geocodes, persists a position or sends shop data to a provider.
// Only the public basemap tiles for the visible viewport are requested externally.
const SDK_ROOT = new URL('../vendor/maplibre-gl-6.16.0/dist/', import.meta.url);
export const STORE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const STORE_MAP_LOAD_TIMEOUT = 15000;
let sdkPromise;

function stylesheet(document, href) {
  let link = [...document.querySelectorAll('link[rel="stylesheet"]')].find(node => node.href === href);
  if (!link) {
    link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
  }
  if (link.sheet) return Promise.resolve();
  return new Promise((resolve,reject) => {
    const timer=setTimeout(() => reject(new Error('map_stylesheet_timeout')),STORE_MAP_LOAD_TIMEOUT);
    link.addEventListener('load',() => {clearTimeout(timer);resolve();},{once:true});
    link.addEventListener('error',() => {clearTimeout(timer);link.remove();reject(new Error('map_stylesheet_unavailable'));},{once:true});
    if (!link.isConnected) document.head.append(link);
  });
}

async function loadSdk(document) {
  const css = stylesheet(document, new URL('maplibre-gl.css', SDK_ROOT).href);
  sdkPromise ??= import('../vendor/maplibre-gl-6.16.0/dist/maplibre-gl.mjs').catch(error => {
    sdkPromise = null; throw error;
  });
  const [sdk] = await Promise.all([sdkPromise,css]);
  sdk.setWorkerUrl(new URL('maplibre-gl-worker.mjs', SDK_ROOT).href);
  return sdk;
}

export function storeMapFeatures(stores) {
  const seen = new Set();
  return { type: 'FeatureCollection', features: (Array.isArray(stores) ? stores : []).flatMap(store => {
    if (typeof store?.id !== 'string' || seen.has(store.id) || !Number.isFinite(store.lat)
      || Math.abs(store.lat) > 85.051129 || !Number.isFinite(store.lon) || Math.abs(store.lon) > 180) return [];
    seen.add(store.id);
    return [{ type: 'Feature', geometry: { type: 'Point', coordinates: [store.lon, store.lat] },
      properties: { id: store.id } }];
  }) };
}

export async function createInteractiveStoreMap({ element, center, zoom, onMove = () => {}, onPoint = () => {},
  onSelect = () => {}, onStatus = () => {}, createMarker, loadSdkImpl = loadSdk, style = STORE_MAP_STYLE } = {}) {
  const document = element.ownerDocument;
  const sdk = await loadSdkImpl(document);
  let map;
  try {
    map = new sdk.Map({ container: element, style, center: [center.lon, center.lat], zoom,
      minZoom: 3, maxZoom: 16, maxPitch: 0, pitchWithRotate: false, dragRotate: false,
      touchPitch: false, renderWorldCopies: false, attributionControl: { compact: true },
      locale: { 'Map.Title': 'Карта магазинов', 'AttributionControl.ToggleAttribution': 'Источники карты' } });
  } catch { throw new Error('map_webgl_unavailable'); }
  map.touchZoomRotate?.disableRotation();
  const resizeObserver = document.defaultView.ResizeObserver
    ? new document.defaultView.ResizeObserver(() => map.resize()) : null;
  resizeObserver?.observe(element);
  let stores = [], own = null, sourceReady = false, disposed = false, userMarker = null;
  const markers = new Map();
  const timer = setTimeout(() => {
    if (!disposed && !sourceReady) onStatus('unavailable');
  }, STORE_MAP_LOAD_TIMEOUT);

  function clearMarkers() { for (const marker of markers.values()) marker.remove(); markers.clear(); }
  function syncMarkers() {
    if (disposed || !sourceReady || !map.getLayer('checkni-stores-point')) return;
    const visible = new Set(map.queryRenderedFeatures({ layers: ['checkni-stores-point'] })
      .map(feature => feature.properties?.id));
    for (const [id, marker] of markers) if (!visible.has(id)) { marker.remove(); markers.delete(id); }
    for (const store of stores) {
      if (!visible.has(store.id) || markers.has(store.id)) continue;
      const node = createMarker(store);
      node.addEventListener('click', event => { event.stopPropagation(); onSelect(store); });
      markers.set(store.id, new sdk.Marker({ element: node, anchor: 'bottom' })
        .setLngLat([store.lon, store.lat]).addTo(map));
    }
  }
  function syncOwn() {
    userMarker?.remove(); userMarker = null;
    if (!own || disposed) return;
    const node = document.createElement('span'); node.className = 'stores-user-pin';
    node.setAttribute('role', 'img'); node.setAttribute('aria-label', 'Ваше место');
    userMarker = new sdk.Marker({ element: node }).setLngLat([own.lon, own.lat]).addTo(map);
  }
  map.on('load', () => {
    if (disposed) return;
    clearTimeout(timer);
    map.addSource('checkni-stores', { type: 'geojson', data: storeMapFeatures(stores),
      cluster: true, clusterMaxZoom: 14, clusterRadius: 42 });
    map.addLayer({ id: 'checkni-stores-cluster', type: 'circle', source: 'checkni-stores',
      filter: ['has', 'point_count'], paint: { 'circle-color': '#7532c5', 'circle-radius': 22,
        'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
    map.addLayer({ id: 'checkni-stores-count', type: 'symbol', source: 'checkni-stores',
      filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Regular'], 'text-size': 14 }, paint: { 'text-color': '#fff' } });
    map.addLayer({ id: 'checkni-stores-point', type: 'circle', source: 'checkni-stores',
      filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 10, 'circle-color': '#7532c5' } });
    sourceReady = true; syncOwn(); onStatus('ready');
  });
  map.on('error', event => { if (!disposed) onStatus('unavailable',event.error); });
  map.on('render', syncMarkers);
  map.on('moveend', () => {
    if (disposed) return;
    const point = map.getCenter();
    onMove({ lat: point.lat, lon: point.lng }, map.getZoom());
  });
  map.on('click', async event => {
    if (!sourceReady || disposed) return;
    const cluster = map.queryRenderedFeatures(event.point, { layers: ['checkni-stores-cluster'] })[0];
    if (cluster) {
      try {
        const nextZoom = await map.getSource('checkni-stores').getClusterExpansionZoom(cluster.properties.cluster_id);
        if (!disposed) map.easeTo({ center: cluster.geometry.coordinates, zoom: Math.min(16, nextZoom),
          duration: document.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200 });
      } catch { /* A changed region can invalidate the clicked cluster. */ }
      return;
    }
    const store = map.queryRenderedFeatures(event.point, { layers: ['checkni-stores-point'] })[0];
    if (store) { const pin = stores.find(row => row.id === store.properties.id); if (pin) onSelect(pin); return; }
    onPoint({ lat: event.lngLat.lat, lon: event.lngLat.lng });
  });
  return {
    setCamera(point, level) {
      const current = map.getCenter();
      if (Math.abs(current.lat - point.lat) > 0.0000001 || Math.abs(current.lng - point.lon) > 0.0000001
        || Math.abs(map.getZoom() - level) > 0.001) map.jumpTo({ center: [point.lon, point.lat], zoom: level });
    },
    setPins(next, position) {
      stores = next; own = position; clearMarkers();
      if (sourceReady) map.getSource('checkni-stores').setData(storeMapFeatures(stores));
      syncOwn();
    },
    resize() { if (!disposed) map.resize(); },
    destroy() { disposed = true; clearTimeout(timer); resizeObserver?.disconnect(); clearMarkers(); userMarker?.remove(); map.remove(); }
  };
}
