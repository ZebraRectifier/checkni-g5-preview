import { publicDataUrl } from './publicDataUrl.mjs';
import { admitPublishedPromotionListCard } from '../catalog/publishedPromotionListAdmission.mjs';
import { currentOfficialProducts, validOfficialSnapshot, OFFICIAL_CATALOG_URL } from '../observations/okeyOfficialPromotions.mjs';
import { currentPublishedProducts, validPublishedSnapshot, PUBLISHED_URL } from '../observations/okeyPublishedPromotions.mjs';
import { currentPyatProducts, validPyatSnapshot, pyatWeeklyCards, PYAT_PUBLISHED_URL } from '../observations/pyaterochkaPublishedPromotions.mjs';

const categories = Object.freeze([
  ['frukty-ovoshi-zelen', 'Овощи и фрукты'], ['moloko-syr-yajca', 'Молоко, сыр и яйца'],
  ['myaso-ryba-kolbasy', 'Мясо и рыба'], ['zamorozhennye-produkty', 'Замороженные продукты'],
  ['konservaciya', 'Консервы'], ['makarony-krupy-muka', 'Крупы и макароны'],
  ['masla-sousy-specii', 'Масла, соусы и специи'], ['sladosti-vypechka-hleb', 'Хлеб и сладости'],
  ['chaj-kofe-kakao', 'Чай и кофе'], ['voda-soki-napitki', 'Напитки'], ['orehi-sneki', 'Орехи и снеки']
].map(([key, name], index) => Object.freeze({ key, name, id: index + 1 })));
const sources = Object.freeze({
  okey: Object.freeze([
    { file: 'okeyOfficialPromotions.json', publisher: 'okey', storeId: 'okey-moscow-official',
      valid: validOfficialSnapshot, current: currentOfficialProducts, sourceUrl: OFFICIAL_CATALOG_URL },
    { file: 'okeyPublishedPromotions.json', publisher: 'proshoper', storeId: 'okey-moscow-proshoper',
      valid: validPublishedSnapshot, current: currentPublishedProducts, sourceUrl: PUBLISHED_URL }
  ]),
  pyaterochka: Object.freeze([
    { file: 'pyaterochkaPublishedPromotions.json', publisher: 'proshoper', storeId: 'pyaterochka-moscow-proshoper',
      valid: validPyatSnapshot, current: currentPyatProducts, sourceUrl: PYAT_PUBLISHED_URL }
  ])
});
const result = (kind, extra = {}) => Object.freeze({ kind, ...extra });
export function publishedCatalogProductExpiry(product) {
  const observed = Date.parse(product?.observedAt);
  const dayEnd = Date.parse(product?.validUntil + 'T00:00:00+03:00') + 86_400_000;
  return Number.isFinite(observed) && Number.isFinite(dayEnd)
    ? Math.min(observed + 86_400_000 + 1, dayEnd) : 0;
}
const normalize = text => String(text).normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
const validPage = (limit, offset) => Number.isSafeInteger(limit) && limit > 0 && limit <= 40
  && Number.isSafeInteger(offset) && offset >= 0 && offset <= 10_000;

// A city-promotion adapter, not a physical-store binding. Preserve the original
// guards: only current campaigns observed within 24h can enter the storefront.
// Its source-specific records cannot claim comparison or basket admission.
export function createPublishedPromotionCatalogClient({ definition, fetchImpl, readJson, cleanQuery, now = Date.now, timeoutMs = 5000 }) {
  const definitions = sources[definition.retailerId];
  let pending = null;
  async function fetchSnapshot(source) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, 15000)));
    try {
      const response = await fetchImpl(publicDataUrl(source.file), {
        cache: 'no-store', credentials: 'omit', signal: controller.signal
      });
      if (!response.ok) return { source, code: 'transport_unavailable' };
      const snapshot = await readJson(response, 262_144);
      // The official collector's known empty placeholder is not fabricated
      // evidence. Another usable source may still supply current observations.
      if (snapshot?.version === 1 && Array.isArray(snapshot.products) && snapshot.products.length === 0
          && Object.keys(snapshot).length === 2) return { source, empty: true };
      return source.valid(snapshot) ? { source, snapshot } : { source, code: 'malformed_transport_response' };
    } catch { return { source, code: 'transport_unavailable' }; }
    finally { clearTimeout(timer); }
  }
  async function load() {
    if (typeof fetchImpl !== 'function') return result('unavailable', { code: 'transport_unconfigured' });
    // Coalesce concurrent categories/products reads; do not cache a failure or
    // hide a repaired source from the user's next retry.
    if (!pending) pending = Promise.all(definitions.map(fetchSnapshot)).finally(() => { pending = null; });
    const snapshots = await pending;
    const usable = snapshots.filter(row => row.snapshot);
    if (!usable.length) return result('unavailable', {
      code: snapshots.find(row => row.code)?.code ?? 'no_verified_promotions'
    });
    const at = now();
    const products = usable.flatMap(({ source, snapshot }) => {
      const reviewed = definition.retailerId === 'pyaterochka'
        ? new Map(pyatWeeklyCards(snapshot, at).map(card => [card.sourceProductId, card])) : new Map();
      return source.current(snapshot, at).map(product => {
        const category = definition.retailerId === 'pyaterochka' ? categories.find(row => row.key === product.category) : null;
        const card = Object.freeze({
          id: `retail:${definition.retailerId}:${source.storeId}:${product.sourceProductId}`,
          retailerId: definition.retailerId, retailerDisplayName: definition.displayName,
          storeId: source.storeId, storeName: definition.displayName + ' · акции Москвы',
          localityId: 'city-moscow-promo', localityName: 'Москва',
          sourceProductId: product.sourceProductId, name: product.name,
          unit: reviewed.get(product.sourceProductId)?.unit ?? 'Фасовка — у источника',
          category: category?.name ?? 'Акции', categoryId: category?.id ?? 1,
          priceMinor: product.priceMinor, currency: 'RUB', availability: 'unknown',
          priceCondition: product.priceCondition,
          priceConditionLabel: source.publisher === 'okey'
            ? 'Акция Москвы · условия карты неизвестны' : 'Акция Москвы · Прошопер · условия карты неизвестны',
          observedAt: product.observedAt, validFrom: product.validFrom ?? null, validUntil: product.validUntil,
          sourceUrl: product.productUrl, productUrl: product.productUrl, catalogSourceUrl: source.sourceUrl, imageUrl: null,
          publisher: source.publisher, priceScope: 'city-promotion', physicalStoreId: null, physicalStoreAddress: null,
          catalogSource: definition.retailerId, catalogDisplayOnly: true, comparisonEligible: false
        });
        return definition.retailerId === 'pyaterochka'
          ? admitPublishedPromotionListCard(card, { snapshot, product, nowMs: at }) ?? card : card;
      });
    });
    // Deterministic source identity order makes subsequent pages disjoint.
    products.sort((a, b) => a.id.localeCompare(b.id, 'en'));
    return result('catalog', { products: Object.freeze(products), partial: snapshots.some(row => !row.snapshot),
      unavailableSources: snapshots.filter(row => row.code).length,
      priceScope: 'city-promotion', physicalStoreId: null,
      ...(products.length ? {} : { emptyReason: 'no_current_promotions' }) });
  }
  async function page({ query = null, categoryId = null, ids = null, limit = 24, offset = 0 } = {}) {
    if (!validPage(limit, offset) || categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId <= 0)
        || ids !== null && (!Array.isArray(ids) || !ids.length || ids.length > 40
          || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(id))))
      return result('error', { code: 'invalid_request' });
    const response = await load();
    if (response.kind !== 'catalog') return response;
    const terms = query ? normalize(query).split(/\s+/u) : [];
    const matching = response.products.filter(row => (categoryId === null || row.categoryId === categoryId)
      && (ids === null || ids.includes(row.sourceProductId)) && terms.every(term => normalize(row.name).includes(term)));
    const rows = Object.freeze(matching.slice(offset, offset + limit));
    return result('catalog', { ...response, products: rows, nextOffset: offset + rows.length, pageSize: rows.length,
      totalCount: matching.length });
  }
  async function categoryRows({ parentId = null, limit = 160 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200
        || parentId !== null && (!Number.isSafeInteger(parentId) || parentId <= 0))
      return result('error', { code: 'invalid_request' });
    const response = await load();
    if (response.kind !== 'catalog') return response;
    const groups = new Map();
    if (parentId === null) for (const product of response.products) {
      const group = groups.get(product.categoryId) ?? { categoryId: product.categoryId, name: product.category,
        parentId: null, rootId: product.categoryId, depth: 0, productCount: 0,
        sourceUrl: product.catalogSourceUrl };
      group.productCount++; groups.set(product.categoryId, group);
    }
    return result('categories', { categories: Object.freeze([...groups.values()].sort((a, b) => a.categoryId - b.categoryId)
      .slice(0, limit).map(Object.freeze)), partial: response.partial, unavailableSources: response.unavailableSources,
      ...(response.emptyReason ? { emptyReason: response.emptyReason } : {}) });
  }
  return Object.freeze({ definition,
    browse: (options = {}) => page(options),
    search(query, options = {}) {
      const cleaned = cleanQuery(query);
      return cleaned ? page({ ...options, query: cleaned }) : Promise.resolve(result('error', { code: 'invalid_request' }));
    },
    bySourceProductIds: ids => page({ ids, limit: ids?.length }),
    browseCategory(category, options = {}) {
      const categoryId = Number.isSafeInteger(category) ? category : category?.categoryId;
      return Number.isSafeInteger(categoryId) && categoryId > 0 ? page({ ...options, categoryId })
        : Promise.resolve(result('error', { code: 'invalid_request' }));
    },
    rootCategories: options => categoryRows(options),
    subcategories: (parentId, options = {}) => categoryRows({ ...options, parentId })
  });
}
