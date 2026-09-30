// Browser port for the catalog-photos edge function. The browser never
// talks to Open Food Facts directly: the CSP connect-src boundary stays
// narrowed to the CHECKNI Supabase edge, and only image URLs hosted on
// images.openfoodfacts.org come back (loaded later as plain <img>).

export const CATALOG_PHOTOS_ENDPOINT =
  "https://cxpneczhczashanbetgj.supabase.co/functions/v1/catalog-photos";
export const CATALOG_PHOTOS_PUBLISHABLE_KEY =
  "sb_publishable_yyIT9Clu4jTphSdVLCVWFA_KQsZZ2rt";
export const CATALOG_PHOTOS_TIMEOUT_MS = 8_000;
export const MAX_CATALOG_PHOTOS_PER_REQUEST = 6;

const IMAGE_HOST = "https://images.openfoodfacts.org/";

// requests: [{ key, kind: "code"|"name", value }]
// Returns Map key -> url|null. Throws on transport failure so the
// loader can count it as a failure and back off.
export async function requestCatalogPhotos(requests, {
  fetchImpl = typeof fetch === "function" ? fetch : null,
  endpoint = CATALOG_PHOTOS_ENDPOINT,
  publishableKey = CATALOG_PHOTOS_PUBLISHABLE_KEY,
  timeoutMs = CATALOG_PHOTOS_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("no fetch");
  if (!Array.isArray(requests) || requests.length === 0) return new Map();

  const body = {
    requests: requests
      .slice(0, MAX_CATALOG_PHOTOS_PER_REQUEST)
      .map((request) => (
        request.kind === "code"
          ? { code: request.value }
          : { name: request.value }
      ))
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let payload;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response?.ok) throw new Error(`photos http ${response?.status}`);
    payload = await response.json();
  } finally {
    clearTimeout(timer);
  }

  const photos = new Map();
  if (payload?.kind !== "photos" || !Array.isArray(payload.photos)) {
    throw new Error("photos payload malformed");
  }
  for (const entry of payload.photos) {
    if (!entry || typeof entry.key !== "string") continue;
    const url = typeof entry.url === "string" && entry.url.startsWith(IMAGE_HOST)
      ? entry.url
      : null;
    photos.set(entry.key, url);
  }
  return photos;
}
