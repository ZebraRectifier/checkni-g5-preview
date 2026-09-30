// Price hints from the dated web snapshot: cheapest visible pack price and
// price per kg / l / piece for each canonical product, plus the live dock
// suffix. Same truth level as the snapshot itself: region not confirmed.

import {
  WEB_SNAPSHOT_CANONICAL_SIZES,
  WEB_SNAPSHOT_META,
  WEB_SNAPSHOT_OFFERS,
  WEB_SNAPSHOT_RETAILERS
} from "../data/webPriceSnapshot.mjs";
import {
  compareWebSnapshot,
  snapshotLinePriceMinor
} from "../core/web-snapshot-comparison.mjs";
import { formatRubMinor } from "../components/ComparisonResult.mjs";

const BASE_UNIT_LABEL = Object.freeze({
  g: "кг",
  ml: "л",
  pcs: "шт"
});

export function buildSnapshotPriceHints({
  offers = WEB_SNAPSHOT_OFFERS,
  sizes = WEB_SNAPSHOT_CANONICAL_SIZES,
  retailers = WEB_SNAPSHOT_RETAILERS,
  meta = WEB_SNAPSHOT_META
} = {}) {
  const retailerName = new Map(retailers.map((entry) => [entry.id, entry.name]));
  const hints = new Map();

  for (const offer of offers) {
    const size = sizes[offer.canonicalProductId];
    const packMinor = snapshotLinePriceMinor(offer, size);
    if (packMinor === null) continue;

    const existing = hints.get(offer.canonicalProductId);
    if (existing && existing.minMinor <= packMinor) continue;

    const perBaseMinor = size.unit === "pcs"
      ? Math.round(packMinor / size.size)
      : Math.round((packMinor * 1000) / size.size);

    hints.set(offer.canonicalProductId, Object.freeze({
      canonicalProductId: offer.canonicalProductId,
      minMinor: packMinor,
      retailerId: offer.retailerId,
      retailerName: retailerName.get(offer.retailerId) ?? offer.retailerId,
      perBaseMinor,
      baseUnit: BASE_UNIT_LABEL[size.unit],
      observedDateLabel: meta.observedDateLabel
    }));
  }

  return hints;
}

export function formatPerUnit(hint) {
  if (!hint) return null;
  const amount = formatRubMinor(hint.perBaseMinor);
  return amount ? `${amount}/${hint.baseUnit}` : null;
}

export function priceHintTitle(hint) {
  if (!hint) return null;
  return `Лучшая цена с сайтов магазинов (${hint.retailerName}), `
    + `${hint.observedDateLabel}. Регион не подтверждён.`;
}

// Appended to the basket dock: " · от 247,22 ₽ (Чижик)" when at least one
// snapshot store covers the whole basket. Never invents a total from
// partial coverage.
export function dockPriceSuffix(items, { compare = compareWebSnapshot } = {}) {
  if (!Array.isArray(items) || items.length === 0) return "";

  let result = null;
  try {
    result = compare(items);
  } catch {
    return "";
  }
  if (!result) return "";

  if (result.conclusion.kind === "cheapest") {
    const winner = result.stores.find(
      (store) => store.retailerId === result.conclusion.winnerId
    );
    return ` · от ${formatRubMinor(result.conclusion.totalMinor)} (${winner.name})`;
  }
  if (result.conclusion.kind === "tie") {
    return ` · от ${formatRubMinor(result.conclusion.totalMinor)}`;
  }
  return "";
}

// Catalogue orderings over the snapshot hints. Products without a price
// keep their relative order at the end.
export const CATALOG_SORT = Object.freeze({
  DEFAULT: "default",
  CHEAPEST: "cheapest",
  PER_UNIT: "per-unit"
});

export function sortCatalogProducts(products, sortMode, hints) {
  if (
    !Array.isArray(products)
    || sortMode === CATALOG_SORT.DEFAULT
    || !(hints instanceof Map)
  ) {
    return products;
  }

  const key = sortMode === CATALOG_SORT.PER_UNIT ? "perBaseMinor" : "minMinor";
  // In per-unit mode weighed/volume goods come before piece goods: mixing
  // rubles-per-piece into the kg/l ladder reads as nonsense.
  const rank = (hint) => {
    if (!hint) return 2;
    if (sortMode === CATALOG_SORT.PER_UNIT && hint.baseUnit === "шт") return 1;
    return 0;
  };
  return products
    .map((product, index) => ({ product, index, hint: hints.get(product.id) }))
    .sort((left, right) => (
      rank(left.hint) - rank(right.hint)
      || (left.hint && right.hint ? left.hint[key] - right.hint[key] : 0)
      || left.index - right.index
    ))
    .map((entry) => entry.product);
}
