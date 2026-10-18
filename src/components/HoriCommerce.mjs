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
  nearby.textContent = '📍 Адрес и магазины';
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
  selected.addEventListener('click', () => {
    if (shop.hidden) document.getElementById('back-to-shop')?.click();
    const retailer = document.querySelector('.retail-store-card.is-selected')?.dataset.retailerId;
    const picker = document.getElementById(`${retailer}-store-picker`);
    const target = picker && !picker.hidden ? picker : document.getElementById('retail-store-grid');
    requestAnimationFrame(() => {
      reveal(target);
      target?.querySelector('select,button')?.focus({ preventScroll: true });
    });
  });
  header.querySelector('.brand')?.after(nearby, selected);

  const aside = document.createElement('aside');
  aside.id = 'hori-basket-preview';
  aside.className = 'hori-basket-preview';
  aside.setAttribute('aria-label', 'Быстрая корзина');
  main.append(aside);

  function reveal(target) {
    if (target) pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
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
    selected.textContent = name || 'Выбери магазин';
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
      empty.textContent = 'Добавляй товары из каталога или попроси Хори помочь с выбором.';
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
        pane.scrollTop += catalog.getBoundingClientRect().top - pane.getBoundingClientRect().top - 62;
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
  });
  return Object.freeze({ reveal });
}
