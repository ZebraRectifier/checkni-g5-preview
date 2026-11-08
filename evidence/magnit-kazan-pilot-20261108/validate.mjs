const exact = Object.freeze({
  schemaVersion: 1,
  pilotState: 'address-only-not-enabled',
  retailerId: 'magnit', cityId: 'kazan', city: 'Казань', sourceStoreId: '010852',
  storeId: 'magnit-010852', name: 'Магнит',
  address: 'Респ Татарстан, г Казань, ул Академика Глушко, д 5А',
  lat: 55.778891, lon: 49.234856, storeType: 'MM',
  sourceUrl: 'https://magnit.ru/shops', sourceType: 'official-store-directory',
  coordinateEvidence: 'official-roster', verification: 'official-listed',
  observedAt: '2026-11-07T05:32:49.007Z', catalogEvidence: null, priceEvidence: false
});

export function validMagnitKazanPilotAddressEvidence(value, directoryRow) {
  if (!value || !directoryRow || Object.keys(exact).some(key => value[key] !== exact[key])) return false;
  if (!/^\d{6}$/u.test(value.sourceStoreId) || !Number.isFinite(Date.parse(value.observedAt))) return false;
  if (Object.keys(value).some(key => /price|catalogBinding|availability|products|categories/iu.test(key)
      && !['priceEvidence', 'catalogEvidence'].includes(key))) return false;
  return directoryRow.id === `official:magnit:${value.sourceStoreId}`
    && directoryRow.sourceStoreId === value.sourceStoreId
    && ['retailerId','name','city','address','lat','lon','storeType','sourceUrl','sourceType',
      'coordinateEvidence','verification','observedAt'].every(key => directoryRow[key] === value[key])
    && directoryRow.catalogBinding === undefined
    && directoryRow.priceMinor === undefined;
}
