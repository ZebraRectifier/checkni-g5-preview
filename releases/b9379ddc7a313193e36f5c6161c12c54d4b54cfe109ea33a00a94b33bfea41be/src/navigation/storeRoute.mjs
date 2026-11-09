export function yandexStoreRouteUrl(point) {
  const lat = point?.lat, lon = point?.lon;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90
      || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  return `https://yandex.ru/maps/?rtext=~${encodeURIComponent(`${lat},${lon}`)}&rtt=auto`;
}
