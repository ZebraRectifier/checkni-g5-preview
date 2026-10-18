import test from "node:test";
import assert from "node:assert/strict";
import {
  createStoreGeolocation,
  distanceMeters,
  normalizeMapCenter,
  normalizeMapZoom,
  shiftMapCenter
} from "../src/runtime/storeGeolocation.mjs";

const CLOCK = Date.parse("2026-10-14T21:00:00.000Z");

test('map and nearby subscribers share cancellation: clearing one view prevents late coordinates in both',()=>{
  const callbacks=[];const seenA=[],seenB=[];
  const geo=createStoreGeolocation({secureContext:true,now:()=>CLOCK,geolocation:{getCurrentPosition(ok){callbacks.push(ok);}}});
  geo.subscribe(s=>seenA.push(s));const off=geo.subscribe(s=>seenB.push(s));
  geo.request();geo.clear();
  callbacks[0]({coords:{latitude:55.75,longitude:37.61,accuracy:12},timestamp:CLOCK});
  assert.equal(geo.getSnapshot().position,null);assert.deepEqual(seenA.map(s=>s.status),['loading','idle']);
  assert.deepEqual(seenB.map(s=>s.status),['loading','idle']);off();geo.setManual({lat:55.75,lon:37.61});
  assert.equal(seenA.at(-1).position.lat,55.75);assert.equal(seenB.at(-1).position,null);
});

function fixture(options = {}) {
  const requests = [];
  const timers = new Map();
  const changes = [];
  let nextTimer = 0;
  const controller = createStoreGeolocation({
    now: () => CLOCK,
    secureContext: true,
    geolocation: {
      getCurrentPosition(success, failure, settings) {
        requests.push({ success, failure, settings });
      }
    },
    onChange: (state) => changes.push(state),
    setTimeoutImpl(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeoutImpl: (id) => timers.delete(id),
    ...options
  });
  return { controller, requests, timers, changes };
}

function device(overrides = {}) {
  return {
    coords: { latitude: 55.7558, longitude: 37.6173, accuracy: 23 },
    timestamp: CLOCK,
    ...overrides
  };
}

test("creating a controller does not request permission or start a timer", () => {
  const { controller, requests, timers, changes } = fixture();
  assert.deepEqual(controller.getSnapshot(), { status: "idle", position: null });
  assert.equal(requests.length, 0);
  assert.equal(timers.size, 0);
  assert.equal(changes.length, 0);
  assert.ok(Object.isFrozen(controller));
  assert.ok(Object.isFrozen(controller.getSnapshot()));
});

test("an explicit request uses bounded low-power options and admits a fresh device point", () => {
  const { controller, requests, timers, changes } = fixture();
  assert.equal(controller.request().status, "loading");
  assert.deepEqual(requests[0].settings, { enableHighAccuracy: false, maximumAge: 0, timeout: 8_000 });
  assert.equal([...timers.values()][0].delay, 10_000);
  requests[0].success(device());
  assert.deepEqual(controller.getSnapshot(), {
    status: "ready",
    position: {
      lat: 55.7558,
      lon: 37.6173,
      accuracyMeters: 23,
      observedAt: "2026-10-14T21:00:00.000Z",
      source: "device"
    }
  });
  assert.ok(Object.isFrozen(controller.getSnapshot().position));
  assert.equal(timers.size, 0, "timer ID zero is cleared too");
  assert.deepEqual(changes.map((state) => state.status), ["loading", "ready"]);
});

test("a second click during a pending request reuses the attempt", () => {
  const { controller, requests, timers } = fixture();
  const loading = controller.request();
  assert.equal(controller.request(), loading);
  assert.equal(requests.length, 1);
  assert.equal(timers.size, 1);
});

test("permission denial, device failure and timeout have distinct terminal states", () => {
  for (const [code, expected] of [[1, "denied"], [2, "unavailable"], [3, "timeout"], [4, "unavailable"]]) {
    const { controller, requests, timers } = fixture();
    controller.setManual({ lat: 55, lon: 37 });
    controller.request();
    assert.equal(controller.getSnapshot().position, null, "old point is cleared at request start");
    requests[0].failure({ code });
    assert.deepEqual(controller.getSnapshot(), { status: expected, position: null });
    assert.equal(timers.size, 0);
    requests[0].success(device());
    assert.equal(controller.getSnapshot().status, expected, "late success cannot revive failure");
  }
});

test("a permission prompt that never resolves is stopped by the watchdog", () => {
  const { controller, requests, timers } = fixture();
  controller.request();
  const watchdog = [...timers.values()][0].callback;
  watchdog();
  assert.deepEqual(controller.getSnapshot(), { status: "timeout", position: null });
  assert.equal(timers.size, 0);
  requests[0].success(device());
  requests[0].failure({ code: 1 });
  assert.equal(controller.getSnapshot().status, "timeout");
});

test("a timed-out previous request cannot finish a newer request", () => {
  const { controller, requests, timers } = fixture();
  controller.request();
  [...timers.values()][0].callback();
  controller.request();
  requests[0].success(device());
  assert.equal(controller.getSnapshot().status, "loading");
  requests[1].success(device({ coords: { latitude: 56, longitude: 38, accuracy: 0 } }));
  assert.equal(controller.getSnapshot().position.lat, 56);
  assert.equal(controller.getSnapshot().position.accuracyMeters, 0);
});

test("manual choice and clearing invalidate both callbacks and the saved watchdog", () => {
  for (const action of ["manual", "clear"]) {
    const { controller, requests, timers } = fixture();
    controller.request();
    const watchdog = [...timers.values()][0].callback;
    const chosen = action === "manual"
      ? controller.setManual({ lat: -90, lon: 180 })
      : controller.clear();
    assert.equal(timers.size, 0);
    requests[0].success(device());
    requests[0].failure({ code: 1 });
    watchdog();
    assert.equal(controller.getSnapshot(), chosen);
    if (action === "manual") {
      assert.deepEqual(chosen.position, {
        lat: -90,
        lon: 180,
        accuracyMeters: null,
        observedAt: "2026-10-14T21:00:00.000Z",
        source: "manual"
      });
    } else {
      assert.deepEqual(chosen, { status: "idle", position: null });
    }
  }
});

test("unsupported and insecure contexts remain usable through a manual point", () => {
  for (const options of [{ geolocation: null }, { secureContext: false }, { secureContext: undefined }]) {
    const { controller, requests, timers } = fixture(options);
    assert.equal(controller.request().status, "unavailable");
    assert.equal(requests.length, 0);
    assert.equal(timers.size, 0);
    assert.equal(controller.setManual({ lat: 0, lon: 0 }).status, "ready");
  }
});

test("a synchronous geolocation error clears the timer and reports unavailable", () => {
  const { controller, timers } = fixture({
    geolocation: { getCurrentPosition() { throw new Error("device unavailable"); } }
  });
  assert.deepEqual(controller.request(), { status: "unavailable", position: null });
  assert.equal(timers.size, 0);
});

test("manual selection made by the loading listener prevents an unnecessary device call", () => {
  let controller;
  const setup = fixture({
    onChange(state) {
      if (state.status === "loading") controller.setManual({ lat: 55, lon: 37 });
    }
  });
  controller = setup.controller;
  controller.request();
  assert.equal(controller.getSnapshot().position.source, "manual");
  assert.equal(setup.requests.length, 0);
  assert.equal(setup.timers.size, 0);
});

test("malformed, inaccurate or stale device points are rejected without coercion", () => {
  const invalid = [
    null,
    {},
    device({ coords: { latitude: "55", longitude: 37, accuracy: 5 } }),
    device({ coords: { latitude: 91, longitude: 37, accuracy: 5 } }),
    device({ coords: { latitude: 55, longitude: -181, accuracy: 5 } }),
    device({ coords: { latitude: NaN, longitude: 37, accuracy: 5 } }),
    device({ coords: { latitude: 55, longitude: Infinity, accuracy: 5 } }),
    device({ coords: { latitude: 55, longitude: 37, accuracy: -1 } }),
    device({ coords: { latitude: 55, longitude: 37, accuracy: Infinity } }),
    device({ coords: { latitude: 55, longitude: 37, accuracy: "5" } }),
    device({ timestamp: String(CLOCK) }),
    device({ timestamp: NaN }),
    device({ timestamp: CLOCK - 60_001 }),
    device({ timestamp: CLOCK + 60_001 })
  ];
  for (const point of invalid) {
    const { controller, requests } = fixture();
    controller.request();
    requests[0].success(point);
    assert.deepEqual(controller.getSnapshot(), { status: "unavailable", position: null });
  }
});

test("device timestamps admit the explicit one-minute limits and preserve original time", () => {
  for (const timestamp of [CLOCK - 60_000, CLOCK + 60_000]) {
    const { controller, requests } = fixture();
    controller.request();
    requests[0].success(device({ timestamp }));
    assert.equal(controller.getSnapshot().status, "ready");
    assert.equal(controller.getSnapshot().position.observedAt, new Date(timestamp).toISOString());
  }
});

test("manual validation preserves the last valid state and never coerces input", () => {
  const { controller } = fixture();
  const chosen = controller.setManual({ lat: 90, lon: -180 });
  for (const value of [null, {}, { lat: "55", lon: 37 }, { lat: Infinity, lon: 37 }, { lat: 91, lon: 37 }, { lat: 55, lon: 181 }]) {
    assert.equal(controller.setManual(value), chosen);
  }
});

test("invalid clocks cannot produce an admitted position or a fabricated observed time", () => {
  for (const time of [NaN, Infinity, "2026-10-14", 9e15]) {
    const { controller, requests } = fixture({ now: () => time });
    assert.deepEqual(controller.setManual({ lat: 55, lon: 37 }), { status: "idle", position: null });
    controller.request();
    requests[0].success(device());
    assert.deepEqual(controller.getSnapshot(), { status: "unavailable", position: null });
  }
});

test("great-circle distance handles coincident, antimeridian and antipodal points", () => {
  assert.equal(distanceMeters({ lat: 55, lon: 37 }, { lat: 55, lon: 37 }), 0);
  const oneDegree = distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.ok(Math.abs(oneDegree - 111_195.08) < 0.1);
  assert.ok(Math.abs(distanceMeters({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }) - 2 * oneDegree) < 0.1);
  const antipodal = distanceMeters({ lat: 90, lon: 0 }, { lat: -90, lon: 180 });
  assert.ok(Math.abs(antipodal - Math.PI * 6_371_008.8) < 0.1);
  for (const invalid of [null, {}, { lat: "0", lon: 0 }, { lat: 0, lon: NaN }, { lat: 91, lon: 0 }]) {
    assert.equal(distanceMeters(invalid, { lat: 0, lon: 0 }), null);
    assert.equal(distanceMeters({ lat: 0, lon: 0 }, invalid), null);
  }
});

test("map normalization clamps Mercator poles, wraps longitudes and keeps an integer zoom", () => {
  assert.deepEqual(normalizeMapCenter({ lat: 90, lon: 181 }), { lat: 85.05112878, lon: -179 });
  assert.deepEqual(normalizeMapCenter({ lat: -90, lon: -541 }), { lat: -85.05112878, lon: 179 });
  assert.equal(normalizeMapCenter({ lat: 0, lon: 180 }).lon, -180);
  assert.ok(Object.isFrozen(normalizeMapCenter({ lat: 0, lon: 0 })));
  assert.equal(normalizeMapZoom(-100), 3);
  assert.equal(normalizeMapZoom(100), 16);
  assert.equal(normalizeMapZoom(10.6), 11);
  for (const invalid of [NaN, Infinity, "10", undefined]) assert.equal(normalizeMapZoom(invalid), null);
  assert.equal(normalizeMapCenter({ lat: NaN, lon: 0 }), null);
  assert.equal(normalizeMapCenter({ lat: 0, lon: "37" }), null);
});

test("Mercator pixel shifts go east/right and south/down with reversible ordinary movement", () => {
  const center = { lat: 55.7558, lon: 37.6173 };
  const shifted = shiftMapCenter(center, 128, 128, 10);
  assert.ok(shifted.lon > center.lon);
  assert.ok(shifted.lat < center.lat);
  assert.ok(Math.abs(shifted.lon - center.lon - 128 / (256 * 2 ** 10) * 360) < 1e-9);
  const reversed = shiftMapCenter(shifted, -128, -128, 10);
  assert.ok(Math.abs(reversed.lat - center.lat) < 1e-9);
  assert.ok(Math.abs(reversed.lon - center.lon) < 1e-9);
  assert.deepEqual(shiftMapCenter({ lat: 0, lon: 0 }, 256 * 2 ** 3, 0, 3), { lat: 0, lon: 0 });
});

test("Mercator shifts remain bounded at poles and wrap across the date line", () => {
  assert.equal(shiftMapCenter({ lat: 0, lon: 179 }, 100, 0, 3).lon < 0, true);
  const north = shiftMapCenter({ lat: 85, lon: 0 }, 0, -1e20, 10);
  const south = shiftMapCenter({ lat: -85, lon: 0 }, 0, 1e20, 10);
  assert.ok(Math.abs(north.lat - 85.05112878) < 1e-8);
  assert.ok(Math.abs(south.lat + 85.05112878) < 1e-8);
  for (const args of [[null, 0, 0, 10], [{ lat: 0, lon: 0 }, Infinity, 0, 10], [{ lat: 0, lon: 0 }, 0, NaN, 10], [{ lat: 0, lon: 0 }, 0, 0, "10"]]) {
    assert.equal(shiftMapCenter(...args), null);
  }
});
