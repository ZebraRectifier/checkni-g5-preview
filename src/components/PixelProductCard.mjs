import { createProductCard } from './ProductCard.mjs';

// Keep the existing identity/admission and add handler. This wrapper changes
// only how that control and the already confirmed basket quantity are shown.
export function createPixelProductCard(product, options = {}) {
  const card = createProductCard(product, options);
  card.classList.add('pixel-product-card');
  const document = card.ownerDocument;
  const body = card.querySelector('.product-body');
  const add = card.querySelector('.add-button');
  const quantity = options.quantity ?? 0;

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
  if (add.disabled) {
    add.title = add.textContent;
    add.textContent = 'Пока только просмотр';
    actions.classList.add('is-view-only');
  } else {
    // aria-label retains the full, established product-and-pack identity.
    add.textContent = '+';
    add.title = add.getAttribute('aria-label') || 'Добавить в список';
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
