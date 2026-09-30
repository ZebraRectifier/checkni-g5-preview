// Real product photos from Open Food Facts (open data, CC-BY-SA images),
// resolved through the CHECKNI catalog-photos edge boundary — the browser
// never calls Open Food Facts directly. Two honest sources:
//  - live catalogue results carry a barcode → exact product photo;
//  - demo catalogue items have no barcode → a labelled "пример товара"
//    lookup by name.
// Photos are decoration for identification only: they never assert price,
// availability or store truth, and every failure falls back silently to
// the pixel icon that is already rendered.

const CACHE_KEY = "checkni.productPhotos.v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 6;
// One batched edge call at a time, spaced out: polite to our own edge
// and, transitively, to Open Food Facts.
const BATCH_INTERVAL_MS = 4_000;
const MAX_FAILURES = 3;

export const PHOTO_ATTRIBUTION =
  "Фото товаров: Open Food Facts (CC-BY-SA); для демо-каталога — пример похожего товара";

function safeParse(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function createProductPhotoLoader({
  requestPhotos,
  storage = null,
  now = () => Date.now(),
  batchIntervalMs = BATCH_INTERVAL_MS,
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms)
} = {}) {
  if (typeof requestPhotos !== "function") {
    return Object.freeze({ load: () => Promise.resolve(null) });
  }

  let cache = {};
  try {
    cache = storage ? safeParse(storage.getItem(CACHE_KEY) ?? "{}") : {};
  } catch {
    cache = {};
  }

  const pending = new Map();
  const queue = [];
  let draining = false;
  let failures = 0;
  let nextBatchAt = 0;

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Quota/private mode: cache stays in memory only.
    }
  }

  function cached(key) {
    const entry = cache[key];
    if (!entry || typeof entry !== "object") return undefined;
    const ttl = entry.url ? CACHE_TTL_MS : NEGATIVE_TTL_MS;
    if (typeof entry.at !== "number" || now() - entry.at > ttl) return undefined;
    return entry.url ?? null;
  }

  function remember(key, url) {
    cache[key] = { url: url ?? null, at: now() };
    persist();
  }

  function abandonQueue() {
    while (queue.length > 0) {
      const dropped = queue.shift();
      dropped.resolve(null);
      pending.delete(dropped.key);
    }
  }

  function drain() {
    if (draining || queue.length === 0) return;
    draining = true;
    const wait = Math.max(0, nextBatchAt - now());

    setTimeoutImpl(async () => {
      nextBatchAt = now() + batchIntervalMs;
      const batch = queue.splice(0, BATCH_SIZE);

      let photos = null;
      try {
        photos = await requestPhotos(
          batch.map(({ key, kind, value }) => ({ key, kind, value }))
        );
        failures = 0;
      } catch {
        failures += 1;
      }

      for (const task of batch) {
        const url = photos instanceof Map ? photos.get(task.key) ?? null : null;
        if (photos instanceof Map) remember(task.key, url);
        task.resolve(url);
        pending.delete(task.key);
      }

      draining = false;
      if (failures >= MAX_FAILURES) abandonQueue();
      else drain();
    }, wait);
  }

  // load({ code }) for exact products, load({ name }) for demo examples.
  function load(request) {
    const code = typeof request?.code === "string" && /^\d{8,14}$/.test(request.code)
      ? request.code
      : null;
    const name = typeof request?.name === "string" ? request.name.trim() : "";
    if (!code && !name) return Promise.resolve(null);

    const key = code ? `c:${code}` : `n:${name.toLocaleLowerCase("ru-RU")}`;
    const hit = cached(key);
    if (hit !== undefined) return Promise.resolve(hit);
    if (pending.has(key)) return pending.get(key);
    if (failures >= MAX_FAILURES) return Promise.resolve(null);

    const promise = new Promise((resolve) => {
      queue.push({
        key,
        kind: code ? "code" : "name",
        value: code ?? name,
        resolve
      });
      drain();
    });
    pending.set(key, promise);
    return promise;
  }

  return Object.freeze({ load });
}
