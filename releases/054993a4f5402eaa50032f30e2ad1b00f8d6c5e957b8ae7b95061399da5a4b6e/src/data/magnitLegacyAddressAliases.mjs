// Reviewed legacy labels point to an existing canonical store; they are search aliases,
// never alternative price/stock identities. Preserve the original directory snapshot.
// Review: artifacts/magnit-remaining-124/legacy-address-resolutions-20261022.json.
const COUPON = 'https://storage.yandexcloud.net/configurator-images-platform-prod/common-content-web/files/upload/c0a098885ba34d93a8bc420b86260457.pdf';
export const MAGNIT_LEGACY_ADDRESS_ALIASES = Object.freeze([
  {
    legacyAddress: '143444, Московская обл, Красногорский р-н, Красногорск г, Опалиха мкр, Геологов ул, дом № 5, корпус XV',
    canonicalAddress: 'Московская обл, г Красногорск, мкр Опалиха, ул Геологов, д 5',
    shopCode: '502509', shopType: '1',
    evidenceUrl: COUPON + '#page=71',
    identityNote: 'The retailer document names premises XV within house 5, not a separate building XV.'
  },
  {
    legacyAddress: '143444, Московская обл, Красногорский р-н, Красногорск г, Опалиха мкр, Островского проезд, дом № 19',
    canonicalAddress: 'Московская обл, г Красногорск, мкр Опалиха, проезд Островского, д 19',
    shopCode: '503510', shopType: '1',
    evidenceUrl: COUPON + '#page=102',
    identityNote: 'Same city, microdistrict, street and house; administrative wording and order differ.'
  },
  {
    legacyAddress: '143700, Московская обл, Шаховская пгт, Дятлово д, дом № 1, корпус Б',
    canonicalAddress: 'Московская обл, Шаховская, деревня Дятлово, 1Б',
    shopCode: '884472', shopType: '1',
    evidenceUrl: COUPON + '#page=111',
    identityNote: 'The retailer document explicitly names this village and house 1Б.'
  },
  {
    legacyAddress: 'Московская обл, Подольск, Южный поселок (Климовск мкр.) ул, 50',
    canonicalAddress: 'Московская обл, г Подольск, мкр Климовск, ул Южный поселок, д 50',
    shopCode: '351814', shopType: '1',
    evidenceUrl: 'https://magnit.ru/product/1000241684-balzam_opolaskivatel_garnier_fructis_rost_vo_vsyu_silu_387ml?shopCode=351814&shopType=1',
    identityNote: 'The historical indexed title and current official page use the same shopCode and both address forms.'
  }
].map(alias => Object.freeze({ ...alias, reviewedAt: '2026-10-22', priceEvidence: false })));

const NONE = Object.freeze([]);

// Deliberately exact: no general removal of house letters, premises or districts.
export function resolveMagnitLegacyAddressAlias(address) {
  return MAGNIT_LEGACY_ADDRESS_ALIASES.find(alias => alias.legacyAddress === address) ?? null;
}

export function getMagnitLegacySearchAliases(store) {
  const alias = MAGNIT_LEGACY_ADDRESS_ALIASES.find(candidate => candidate.shopCode === store?.shopCode
    && candidate.canonicalAddress === store.address && candidate.shopType === (store.shopType ?? '1'));
  return alias ? Object.freeze([alias.legacyAddress]) : NONE;
}
