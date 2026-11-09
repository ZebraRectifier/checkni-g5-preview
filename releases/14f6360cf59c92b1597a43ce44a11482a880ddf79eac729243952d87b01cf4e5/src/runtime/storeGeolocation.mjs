const GEOLOCATION_TIMEOUT_MS = 8_000;
const GEOLOCATION_WATCHDOG_MS = 10_000;
const POSITION_CLOCK_TOLERANCE_MS = 60_000;
const MERCATOR_LATITUDE_LIMIT = 85.05112878;
const EARTH_RADIUS_METERS = 6_371_008.8;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isCoordinate(value) {
  return Boolean(
    value
    && isFiniteNumber(value.lat)
    && isFiniteNumber(value.lon)
    && value.lat >= -90
    && value.lat <= 90
    && value.lon >= -180
    && value.lon <= 180
  );
}

function isoTimestamp(timestamp) {
  if (!isFiniteNumber(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function snapshot(status, position = null) {
  return Object.freeze({
    status,
    position: position ? Object.freeze(position) : null
  });
}

function devicePosition(value, currentTime) {
  const coords = value?.coords;
  const point = { lat: coords?.latitude, lon: coords?.longitude };
  const timestamp = value?.timestamp;
  const observedAt = isoTimestamp(timestamp);
  if (
    !isCoordinate(point)
    || !isFiniteNumber(coords?.accuracy)
    || coords.accuracy < 0
    || !observedAt
    || !isoTimestamp(currentTime)
    || Math.abs(timestamp - currentTime) > POSITION_CLOCK_TOLERANCE_MS
  ) {
    return null;
  }
  return {
    ...point,
    accuracyMeters: coords.accuracy,
    observedAt,
    source: "device"
  };
}

/** Coordinates stay in memory. Only an explicit request() asks the device. */
export function createStoreGeolocation({
  geolocation = globalThis.navigator?.geolocation,
  now = Date.now,
  secureContext = globalThis.isSecureContext,
  onChange = () => {},
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  let state = snapshot("idle");
  let requestVersion = 0;
  let watchdog = null;
  const listeners=new Set();

  function stopPending() {
    requestVersion += 1;
    if (watchdog !== null) {
      clearTimeoutImpl(watchdog);
      watchdog = null;
    }
  }

  function publish(nextState) {
    state = nextState;
    onChange(state);
    for(const listener of listeners)listener(state);
    return state;
  }

  function request() {
    if (state.status === "loading") return state;
    stopPending();
    const version = requestVersion;
    if (secureContext !== true || typeof geolocation?.getCurrentPosition !== "function") {
      return publish(snapshot("unavailable"));
    }

    function finish(status, position = null) {
      if (version !== requestVersion || state.status !== "loading") return;
      stopPending();
      publish(snapshot(status, position));
    }

    publish(snapshot("loading"));
    // A listener may clear the request or choose a manual point immediately.
    if (version !== requestVersion || state.status !== "loading") return state;
    try {
      watchdog = setTimeoutImpl(() => finish("timeout"), GEOLOCATION_WATCHDOG_MS);
      geolocation.getCurrentPosition(
        (value) => {
          if (version !== requestVersion || state.status !== "loading") return;
          const position = devicePosition(value, now());
          finish(position ? "ready" : "unavailable", position);
        },
        (error) => {
          const status = error?.code === 1
            ? "denied"
            : error?.code === 3 ? "timeout" : "unavailable";
          finish(status);
        },
        {
          enableHighAccuracy: false,
          maximumAge: 0,
          timeout: GEOLOCATION_TIMEOUT_MS
        }
      );
    } catch {
      finish("unavailable");
    }
    return state;
  }

  function setManual(point) {
    const observedAt = isoTimestamp(now());
    if (!isCoordinate(point) || !observedAt) return state;
    stopPending();
    return publish(snapshot("ready", {
      lat: point.lat,
      lon: point.lon,
      accuracyMeters: null,
      observedAt,
      source: "manual"
    }));
  }

  function clear() {
    stopPending();
    return publish(snapshot("idle"));
  }

  return Object.freeze({ getSnapshot: () => state, request, setManual, clear,
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);} });
}

/** Great-circle distance; invalid coordinates remain unknown. */
export function distanceMeters(a, b) {
  if (!isCoordinate(a) || !isCoordinate(b)) return null;
  const radians = Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * radians;
  const deltaLon = (b.lon - a.lon) * radians;
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians)
      * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

export function normalizeMapCenter(center) {
  if (!isFiniteNumber(center?.lat) || !isFiniteNumber(center?.lon)) return null;
  return Object.freeze({
    lat: Math.max(-MERCATOR_LATITUDE_LIMIT, Math.min(MERCATOR_LATITUDE_LIMIT, center.lat)),
    lon: ((center.lon % 360 + 540) % 360) - 180
  });
}

export function normalizeMapZoom(zoom) {
  return isFiniteNumber(zoom) ? Math.max(3, Math.min(16, Math.round(zoom))) : null;
}

/** Shift a Mercator center in map pixels: right/east and down/south are positive. */
export function shiftMapCenter(center, dx, dy, zoom) {
  const point = normalizeMapCenter(center);
  const level = normalizeMapZoom(zoom);
  if (!point || level === null || !isFiniteNumber(dx) || !isFiniteNumber(dy)) return null;
  const worldSize = 256 * 2 ** level;
  const latitude = point.lat * Math.PI / 180;
  const x = (point.lon + 180) / 360 * worldSize;
  const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / (2 * Math.PI)) * worldSize;
  const shiftedX = x + dx % worldSize;
  const shiftedY = Math.max(0, Math.min(worldSize, y + dy));
  return normalizeMapCenter({
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * shiftedY / worldSize))) * 180 / Math.PI,
    lon: shiftedX / worldSize * 360 - 180
  });
}
