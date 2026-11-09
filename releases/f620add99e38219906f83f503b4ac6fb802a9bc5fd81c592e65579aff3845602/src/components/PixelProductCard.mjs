import { createProductCard } from './ProductCard.mjs';
import { SOURCE_CATALOG_LIST_MAX_AGE_MS } from '../catalog/sourceCatalogListAdmission.mjs';
import { getLentaObservationStatus } from '../catalog/lentaObservationPolicy.mjs';
import { METRO_CATALOG_PRICE_MAX_AGE_MS } from '../observations/retailCatalogFreshnessPolicy.mjs';

// Presentation only: legacy reviewed identities may still enter a shopping
// list. This warning neither admits their price nor changes that identity rule.
export function hasDatedListPrice(product, nowMs = Date.now()) {
  const observed = Date.parse(product?.observedAt);
  return Number.isFinite(observed) && Number.isFinite(nowMs)
    && nowMs - observed >= SOURCE_CATALOG_LIST_MAX_AGE_MS;
}

// Keep the existing identity/admission and add handler. This wrapper changes
// only how that control and the already confirmed basket quantity are shown.
export function createPixelProductCard(product, options = {}) {
  const card = createProductCard(product, options);
  card.classList.add('pixel-product-card');
  const document = card.ownerDocument;
  const body = card.querySelector('.product-body');
  const add = card.querySelector('.add-button');
  const quantity = options.quantity ?? 0;
  const lentaObservationStatus = getLentaObservationStatus(product);

  const details = document.createElement('details');
  details.className = 'pixel-product-details';
  const summary = document.createElement('summary');
  summary.textContent = 'Цена и источник';
  details.append(summary);
  const meta = body.querySelector('.product-meta');
  if (meta) details.append(meta);
  for (const link of body.querySelectorAll('a.product-unit')) details.append(link);
  const price = body.querySelector('.product-price');
  if (!price) {
    const unknown = document.createElement('p');
    unknown.className = 'product-price pixel-unknown-price';
    unknown.textContent = 'Цена неизвестна';
    body.insertBefore(unknown, add);
  }

  const actions = document.createElement('div');
  actions.className = 'pixel-product-actions';
  const datedPrice = hasDatedListPrice(product);
  const staleObservedPrice = datedPrice && Number.isSafeInteger(product.priceMinor) && product.priceMinor > 0;
  if (datedPrice && (!add.disabled || staleObservedPrice)) {
    const stamp = card.querySelector('.product-observed-at');
    if (stamp) stamp.textContent = stamp.textContent.replace(/^Цена от/u, 'Старая цена от');
  }
  if (add.disabled) {
    const staleReadonlyPrice = staleObservedPrice && !lentaObservationStatus;
    const observedAt = Date.parse(product.observedAt);
    const metroNeedsFreshPrice = product.retailerId === 'metro'
      && Number.isSafeInteger(product.priceMinor) && product.priceMinor > 0
      && Number.isFinite(observedAt) && Date.now() - observedAt > METRO_CATALOG_PRICE_MAX_AGE_MS;
    add.title = add.textContent;
    add.textContent = staleReadonlyPrice
      ? 'Цена устарела · просмотр'
      : metroNeedsFreshPrice
        ? 'Для сравнения нужна свежая цена'
      : lentaObservationStatus === 'stale'
      ? 'Старая цена · просмотр'
      : lentaObservationStatus === 'unknown'
        ? 'Дата цены неизвестна'
        : 'Пока только просмотр';
    if (staleReadonlyPrice) {
      add.setAttribute('aria-label', `${product.name}: цена устарела, только просмотр`);
      if (product.retailerId === 'magnit') add.title = add.textContent;
    } else if (metroNeedsFreshPrice) {
      add.setAttribute('aria-label', `${product.name}: для сравнения нужна свежая цена`);
    }
    actions.classList.add('is-view-only');
  } else {
    // aria-label retains the full, established product-and-pack identity.
    add.textContent = '+';
    add.title = add.getAttribute('aria-label') || 'Добавить в список';
    if (datedPrice) {
      add.classList.add('is-dated-list');
      add.textContent = 'В список без цены';
      add.setAttribute('aria-label', `Добавить ${product.name}, ${product.unit}, в список без цены`);
      add.title = add.getAttribute('aria-label');
    }
    if (quantity > 0 && typeof options.onRemoveOne === 'function') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pixel-remove-one';
      remove.textContent = '−';
      remove.dataset.focusKey = `pixel-remove:${product.id}`;
      remove.setAttribute('aria-label', `Уменьшить ${product.name}, ${product.unit}, в списке`);
      remove.addEventListener('click', () => {
        options.onRemoveOne();
        const fresh = [...document.querySelectorAll('.pixel-product-card')]
          .find(candidate => candidate.dataset.productId === product.id);
        (fresh?.querySelector('.pixel-remove-one') || fresh?.querySelector('.add-button'))?.focus({ preventScroll: true });
      });
      const count = document.createElement('output');
      count.className = 'pixel-quantity';
      count.textContent = String(quantity);
      count.setAttribute('aria-label', `В списке: ${quantity}`);
      actions.append(remove, count);
    }
  }
  actions.append(add);
  body.append(actions, details);
  return card;
}
