// Retail-only presentation. Reuse the live controls and their handlers; never
// derive prices, totals, eligibility or a recommendation in this component.
export function createHoriCommerce({ document, main, shop, header }) {
  const basketView = document.getElementById('basket-view');
  const basketContent = document.getElementById('basket-content');
  const openBasket = document.getElementById('open-basket');
  const dock = document.getElementById('basket-dock');
  const pane = document.createElement('div');
  pane.id = 'hori-shop-pane';
  pane.className = 'hori-shop-pane';
  main.append(pane);
  if (shop) pane.append(shop);
  if (basketView) pane.append(basketView);

  const nearby = document.createElement('button');
  nearby.type = 'button'; nearby.className = 'hori-location';
  nearby.textContent = '⌖ Адрес и радиус';
  nearby.addEventListener('click', () => {
    if (shop.hidden) document.getElementById('back-to-shop')?.click();
    const target = document.getElementById('nearby-shopping');
    const trigger = target?.querySelector('button[aria-controls="nearby-shopping-panel"]');
    if (trigger?.getAttribute('aria-expanded') !== 'true') trigger?.click();
    requestAnimationFrame(() => {
      reveal(target);
      document.getElementById('nearby-address')?.focus({ preventScroll: true });
    });
  });
  const selected = document.createElement('button');
  selected.type = 'button';
  selected.className = 'hori-selected-store';
  selected.setAttribute('aria-label', 'Выбранный каталог');
  selected.setAttribute('aria-haspopup', 'dialog');
  const storeDialog = document.createElement('dialog');
  storeDialog.id = 'hori-store-dialog';
  storeDialog.setAttribute('aria-labelledby', 'hori-store-dialog-title');
  const dialogHeader = document.createElement('header');
  const dialogTitle = document.createElement('h2');
  dialogTitle.id = 'hori-store-dialog-title';
  dialogTitle.textContent = 'Выбери магазин';
  const closeStores = document.createElement('button');
  closeStores.type = 'button'; closeStores.textContent = 'Готово';
  closeStores.addEventListener('click', () => storeDialog.close());
  dialogHeader.append(dialogTitle, closeStores); storeDialog.append(dialogHeader);
  document.body.append(storeDialog);
  const movedControls = [];
  storeDialog.addEventListener('close', () => {
    for (const { node, anchor } of movedControls.splice(0)) { anchor.replaceWith(node); }
    selected.setAttribute('aria-expanded', 'false');
  });
  storeDialog.addEventListener('click', event => {
    if (event.target.closest('.retail-store-card')) {
      storeDialog.close();
      requestAnimationFrame(() => { pane.scrollTop = 0; });
    }
  });
  selected.addEventListener('click', () => {
    if (shop.hidden) document.getElementById('back-to-shop')?.click();
    for (const selector of ['#retail-store-grid', '#globus-store-picker', '#metro-store-picker', '#magnit-store-picker']) {
      const node = document.querySelector(selector);
      if (!node || storeDialog.contains(node)) continue;
      const anchor = document.createComment('Hori store control return position');
      node.before(anchor); movedControls.push({ node, anchor }); storeDialog.append(node);
    }
    selected.setAttribute('aria-expanded', 'true');
    storeDialog.showModal();
  });
  header.querySelector('.brand')?.after(nearby, selected);

  const aside = document.createElement('aside');
  aside.id = 'hori-basket-preview';
  aside.className = 'hori-basket-preview';
  aside.setAttribute('aria-label', 'Быстрая корзина');
  main.append(aside);

  function reveal(target) {
    const searchHeight = shop?.querySelector('.hero')?.getBoundingClientRect().height || 0;
    if (target) pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top - searchHeight - 12;
  }

  let currentView = shop?.hidden ? 'basket' : 'shop';
  const scrollPositions = { shop:0, basket:0 };
  pane.addEventListener('scroll', () => { scrollPositions[currentView] = pane.scrollTop; }, { passive:true });
  function syncView() {
    const nextView = shop?.hidden ? 'basket' : 'shop';
    const changed = nextView !== currentView;
    currentView = nextView;
    main.dataset.horiView = currentView;
    aside.hidden = Boolean(shop?.hidden);
    if (changed) pane.scrollTop = scrollPositions[currentView];
  }

  function syncStore() {
    const card = document.querySelector('.retail-store-card.is-selected');
    const name = card?.querySelector('strong')?.textContent?.trim();
    const logo = card?.querySelector('.retail-store-logo')?.cloneNode(true);
    if (logo) logo.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'hori-store-label';
    label.textContent = name || 'Выбери магазин';
    selected.replaceChildren(...(logo ? [logo, label] : [label]));
    selected.title = card?.querySelector('.retail-store-copy')?.textContent?.trim() || '';
    for (const card of document.querySelectorAll('.retail-store-card')) {
      card.title = card.querySelector('.retail-store-copy')?.textContent?.trim() || '';
    }
  }

  function renderPreview() {
    const focusKey = aside.contains(document.activeElement) ? document.activeElement.dataset.horiControl : null;
    aside.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = '🛒 Корзина';
    const count = document.createElement('p'); count.className = 'hori-basket-count';
    count.textContent = basketContent?.querySelector('.basket-summary > span')?.textContent || 'Пока пусто';
    const list = document.createElement('div'); list.className = 'hori-basket-items';
    const rows = basketContent?.querySelectorAll('.basket-row') || [];
    for (const [index, row] of [...rows].entries()) {
      const item = document.createElement('article'); item.className = 'hori-mini-item';
      const name = row.querySelector('h2')?.textContent || '';
      const title = document.createElement('strong'); title.textContent = name;
      const unit = document.createElement('small'); unit.textContent = row.querySelector('.basket-item-info p')?.textContent || '';
      const controls = document.createElement('div'); controls.className = 'hori-mini-stepper';
      const quantity = document.createElement('output');
      quantity.textContent = row.querySelector('.stepper-value')?.textContent || '';
      for (const [offset, label] of [[0, 'Уменьшить'], [1, 'Увеличить']]) {
        const original = row.querySelectorAll('.stepper-button')[offset];
        if (!original) continue;
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = original.textContent;
        button.disabled = original.disabled;
        button.setAttribute('aria-label', `Быстрая корзина: ${label.toLowerCase()} ${name}`);
        button.dataset.horiControl = original.dataset.focusKey || `${index}-${offset}`;
        button.addEventListener('click', () => { if (original.isConnected && !original.disabled) original.click(); });
        controls.append(button);
        if (offset === 0) controls.append(quantity);
      }
      item.append(title, unit, controls); list.append(item);
    }
    if (!rows.length) {
      const empty = document.createElement('p'); empty.className = 'hori-basket-empty';
      const icon = document.createElement('span'); icon.className = 'hori-empty-basket';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 80 72" width="80" height="72" fill="none"><path d="M20 26 32 6h8L29 26m15 0L39 6h8l13 20" stroke="#aa8fe5" stroke-width="6"/><path d="m8 25 52-4 13 8-11 36-43 3-11-43Z" fill="#c4b0f3"/><path d="m8 25 11 43 8-7-8-32" fill="#dfd2fc"/><path d="m19 29 54 0-11 36-35-4-8-32Z" fill="#b39ae9"/><path d="m8 25 52-4 13 8-54 0-11-4Z" fill="#e9dfff"/><path d="m30 36 3 19m10-20-1 20m12-20-4 20" stroke="#f1eaff" stroke-width="5"/></svg>';
      const title = document.createElement('strong'); title.textContent = 'Здесь появятся покупки';
      const copy = document.createElement('span'); copy.textContent = 'Добавляй товары из каталога или попроси Хори помочь.';
      empty.append(icon, title, copy);
      list.append(empty);
    }
    aside.append(heading, count, list);
    if (dock) aside.append(dock);
    if (focusKey) [...aside.querySelectorAll('[data-hori-control]')].find(node => node.dataset.horiControl === focusKey)?.focus({ preventScroll: true });
  }
  // Existing controllers remain the only writers of basket and store state.
  if (basketContent) new MutationObserver(renderPreview).observe(basketContent, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  if (shop) new MutationObserver(syncView).observe(shop, { attributes: true, attributeFilter: ['hidden'] });
  const stores = document.getElementById('retail-store-grid');
  if (stores) new MutationObserver(syncStore).observe(stores, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed'] });
  const search = document.getElementById('product-search');
  const grid = document.getElementById('product-grid');
  let revealSearch = false;
  document.getElementById('search-form')?.addEventListener('submit', () => {
    revealSearch = Boolean(search?.value.trim());
  });
  search?.addEventListener('input', () => {
    if (!search.value.trim()) revealSearch = false;
  });
  document.getElementById('clear-search')?.addEventListener('click', () => { revealSearch = false; });
  if (grid) new MutationObserver(() => {
    if (!search?.value.trim()) revealSearch = false;
    if (revealSearch && grid.querySelector('.product-card')) {
      revealSearch = false;
      requestAnimationFrame(() => {
        const catalog = grid.closest('.catalog-section');
        reveal(catalog);
      });
    }
  }).observe(grid, { childList:true });
  renderPreview(); syncView(); syncStore();
  openBasket?.addEventListener('click', () => { pane.scrollTop = 0; });
  // Keep the actual product browser before the long reference directories.
  // Reparent existing nodes without replacing any picker, data or listeners.
  queueMicrotask(() => {
    const catalog = shop?.querySelector('.catalog-section');
    if (!catalog) return;
    const searchForm = document.getElementById('search-form');
    const sort = catalog.querySelector('.catalog-sort');
    if (searchForm && sort) searchForm.append(sort);
    const note = document.getElementById('catalog-note');
    if (searchForm && note) {
      const details = document.createElement('details'); details.className = 'hori-price-note';
      const summary = document.createElement('summary'); summary.textContent = 'О ценах';
      summary.setAttribute('aria-label', 'О ценах и источниках каталога');
      details.append(summary, note); searchForm.append(details);
    }
    const extras = document.createElement('section');
    extras.className = 'hori-store-extras';
    extras.setAttribute('aria-label', 'Адреса, источники и справочники магазинов');
    catalog.after(extras);
    for (const selector of ['#nearby-shopping', '.pyat-published', '#globus-store-picker', '#metro-store-picker', '#magnit-store-picker']) {
      const node = document.querySelector(selector);
      if (node) extras.append(node);
    }
    const browser = document.getElementById('retail-browser');
    for (const node of [...(browser?.children || [])]) {
      if (!['retail-store-grid', 'retail-catalog-nav'].includes(node.id)) extras.append(node);
    }
    // One real store picker: the header opens it in a modal. Its original
    // controls remain below the catalogue for navigation/recovery, without
    // consuming the first visible row of products or duplicating handlers.
    const stores = document.getElementById('retail-store-grid');
    if (stores) {
      extras.prepend(stores);
      stores.addEventListener('click', event => {
        if (event.target.closest('.retail-store-card')) requestAnimationFrame(() => { pane.scrollTop = 0; });
      });
    }
  });
  return Object.freeze({ reveal });
}
