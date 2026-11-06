/** Enhance actual cards without duplicating their price or add-to-basket logic. */
export function initShoppingV17(document) {
  const view = document.defaultView;
  const dialog = document.createElement('dialog');
  dialog.className = 'shopping-product-dialog';
  dialog.setAttribute('aria-label', 'Информация о товаре');
  document.body.append(dialog);
  const miniBasket = document.createElement('aside');
  miniBasket.className = 'shopping-mini-basket';
  miniBasket.setAttribute('aria-label', 'Корзина');
  document.getElementById('pixel-storefront')?.append(miniBasket);
  function renderMiniBasket() {
    const heading = document.createElement('h2');
    heading.textContent = 'Корзина';
    const rows = [...document.querySelectorAll('#basket-view .basket-row')];
    const list = document.createElement('div');
    list.className = 'shopping-mini-list';
    for (const row of rows) {
      const title = row.querySelector('.basket-item-info h2')?.textContent;
      if (!title) continue;
      const item = document.createElement('p');
      item.textContent = title + ' × ' + (row.querySelector('.stepper-value')?.textContent || '1');
      list.append(item);
    }
    if (!list.childElementCount) list.textContent = 'Добавь товары, чтобы сравнить цены.';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'primary-button';
    open.textContent = 'Открыть корзину';
    open.disabled = !rows.length;
    open.addEventListener('click', () => document.dispatchEvent(new view.CustomEvent('checkni:shop-action', {detail: {action: 'basket'}})));
    miniBasket.replaceChildren(heading, list, open);
  }
  const basketObserver = new view.MutationObserver(renderMiniBasket);
  const basketContent = document.getElementById('basket-view');
  if (basketContent) basketObserver.observe(basketContent, {childList: true, subtree: true});
  renderMiniBasket();
  let sourceCard = null;
  let trigger = null;

  function close() {
    dialog.close();
    trigger?.focus();
  }
  function renderDetails() {
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'shopping-product-close';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Закрыть товар');
    closeButton.addEventListener('click', close);
    const visual = sourceCard.querySelector('.product-visual')?.cloneNode(true);
    visual?.querySelectorAll('button, .pixel-product-actions').forEach(node => node.remove());
    const body = sourceCard.querySelector('.product-body')?.cloneNode(true);
    body?.querySelectorAll('.pixel-product-actions').forEach(node => node.remove());
    const clonedTrigger = body?.querySelector('.shopping-detail-trigger');
    if (clonedTrigger) clonedTrigger.replaceWith(document.createTextNode(clonedTrigger.textContent));
    const add = sourceCard.querySelector('.add-button');
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'primary-button';
    addButton.textContent = add?.disabled ? 'Пока только просмотр' : 'Добавить в корзину';
    addButton.disabled = !add || add.disabled;
    addButton.addEventListener('click', () => {
      // The current real card owns all admission and basket updates.
      const current = [...document.querySelectorAll('#product-grid .product-card')]
        .find(card => card.dataset.productId === sourceCard.dataset.productId);
      current?.querySelector('.add-button')?.click();
      close();
    });
    dialog.replaceChildren(closeButton);
    if (visual) dialog.append(visual);
    if (body) dialog.append(body);
    dialog.append(addButton);
    dialog.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  }
  function enhance() {
    document.querySelectorAll('#product-grid .product-card').forEach(card => {
      const heading = card.querySelector('h3');
      if (!heading || heading.querySelector('button')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shopping-detail-trigger';
      button.textContent = heading.textContent;
      button.setAttribute('aria-label', 'Подробнее о товаре ' + heading.textContent);
      button.addEventListener('click', () => {
        sourceCard = card;
        trigger = button;
        renderDetails();
        dialog.showModal();
      });
      heading.replaceChildren(button);
    });
  }
  const observer = new view.MutationObserver(enhance);
  const grid = document.getElementById('product-grid');
  if (grid) observer.observe(grid, {childList: true});
  enhance();
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  return () => { observer.disconnect(); basketObserver.disconnect(); miniBasket.remove(); dialog.remove(); };
}
