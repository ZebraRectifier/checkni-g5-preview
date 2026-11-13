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

  // A catalogue card must let people inspect a product before changing their
  // basket. Collections can be the only root content for a real store, so a
  // detail view cannot depend on the normal product grid being present.
  const detailsButton = document.createElement('button');
  detailsButton.type = 'button';
  detailsButton.className = 'shopping-detail-trigger';
  detailsButton.textContent = 'О товаре';
  detailsButton.setAttribute('aria-label', `Информация о товаре: ${product.name}`);
  detailsButton.addEventListener('click', () => {
    document.getElementById('shopping-product-dialog')?.remove();

    const dialog = document.createElement('dialog');
    dialog.id = 'shopping-product-dialog';
    dialog.className = 'shopping-product-dialog';
    dialog.setAttribute('aria-label', 'Информация о товаре');

    const title = document.createElement('h2');
    title.id = 'shopping-product-dialog-title';
    title.textContent = product.name;
    const unit = document.createElement('p');
    unit.textContent = product.unit || 'Упаковка не указана';
    const priceCopy = body.querySelector('.product-price')?.cloneNode(true);
    const sourceCopy = body.querySelector('a.product-unit')?.cloneNode(true);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Закрыть';
    close.addEventListener('click', () => dialog.close());
    const addFromDialog = document.createElement('button');
    addFromDialog.type = 'button';
    addFromDialog.textContent = 'Добавить в корзину';
    addFromDialog.disabled = add.disabled || add.getAttribute('aria-disabled') === 'true';
    addFromDialog.addEventListener('click', () => {
      if (!addFromDialog.disabled) add.click();
      dialog.close();
    });
    dialog.append(title, unit);
    if (priceCopy) dialog.append(priceCopy);
    if (sourceCopy) dialog.append(sourceCopy);
    dialog.append(addFromDialog, close);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });

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
  body.append(detailsButton, actions, details);
  return card;
}
