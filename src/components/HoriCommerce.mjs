// Presentation only. The app owns navigation, selected addresses, catalogue
// requests and every basket mutation; this shell only reuses their real nodes.
import { findStoreSearchMatches } from './storeSearchIndex.mjs';

export function createHoriCommerce({ document, main, shop, header, onOpenHory, onOpenAddress }) {
  const view = document.defaultView;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const action = name => document.dispatchEvent(new view.CustomEvent('checkni:shop-action', { detail: { action: name } }));
  const pane = node('div', 'hori-shop-pane pixel-shop-pane');
  pane.id = 'hori-shop-pane'; main.append(pane);
  if (shop) pane.append(shop);
  const basketView = document.getElementById('basket-view');
  if (basketView) pane.append(basketView);

  const home = node('section', 'pixel-store-home');
  home.id = 'pixel-store-home'; home.setAttribute('aria-labelledby', 'pixel-store-home-title');
  const homeTitle = node('h1', '', 'Где ищем продукты?');
  homeTitle.id = 'pixel-store-home-title'; homeTitle.tabIndex = -1;
  const storeSearch = node('form', 'pixel-store-search');
  storeSearch.id = 'pixel-store-search-form'; storeSearch.setAttribute('role', 'search');
  const searchLabel = node('label', 'sr-only', 'Найти магазин'); searchLabel.htmlFor = 'pixel-store-search';
  const searchInput = node('input');
  searchInput.id = 'pixel-store-search'; searchInput.type = 'search'; searchInput.name = 'store';
  searchInput.placeholder = 'Магазин или город'; searchInput.autocomplete = 'off'; searchInput.maxLength = 100;
  searchInput.setAttribute('enterkeyhint', 'search'); searchInput.setAttribute('aria-describedby', 'pixel-store-status');
  const searchButton = node('button', 'pixel-store-search-submit', 'Найти'); searchButton.type = 'submit';
  storeSearch.append(searchLabel, searchInput, searchButton);
  const storeStatus = node('p', 'pixel-store-status');
  storeStatus.id = 'pixel-store-status'; storeStatus.setAttribute('role', 'status');
  const addressResults = node('section', 'pixel-store-address-results');
  addressResults.id = 'pixel-store-address-results'; addressResults.hidden = true;
  addressResults.setAttribute('aria-label', 'Найденные адреса магазинов');
  const addressChooser = node('section', 'pixel-address-chooser');
  addressChooser.id = 'pixel-address-chooser'; addressChooser.hidden = true;
  addressChooser.setAttribute('aria-labelledby', 'pixel-address-chooser-title');
  const chooserTitle = node('h2'); chooserTitle.id = 'pixel-address-chooser-title';
  const chooserHint = node('p', 'pixel-address-chooser-hint', 'Нажмите на адрес, чтобы открыть товары. Или найдите магазины рядом по своему местоположению.');
  const chooserControls = node('div', 'pixel-address-chooser-controls');
  const chooserActions = node('div', 'pixel-address-chooser-actions');
  const chooserBack = node('button', 'pixel-address-chooser-back', 'К сетям'); chooserBack.type = 'button';
  chooserActions.append(chooserBack);
  const exactCards = node('div', 'pixel-exact-address-cards');
  exactCards.id = 'pixel-exact-address-cards';
  addressChooser.append(chooserTitle, chooserHint, chooserControls, exactCards, chooserActions);
  const stores = document.getElementById('retail-store-grid');
  const publishedEntries = [
    { id: 'okey', name: 'О’КЕЙ', selector: '[data-okey-official="true"]', aliases: 'окей okey o\'key',
      scope: 'Акции Москвы · цена в конкретном магазине не подтверждена' },
    { id: 'pyaterochka', name: 'Пятёрочка', selector: '#pyaterochka-published', aliases: 'пятерочка',
      scope: 'Акции Москвы · цена в конкретном магазине не подтверждена' }
  ];
  const publishedButtons = new Map();
  home.append(homeTitle, storeSearch, storeStatus, addressChooser); if (stores) home.append(stores);
  home.append(addressResults);

  const storefront = node('section', 'pixel-storefront');
  storefront.id = 'pixel-storefront'; storefront.hidden = true;
  storefront.setAttribute('aria-labelledby', 'pixel-storefront-title');
  const storeHeading = node('header', 'pixel-store-heading');
  const back = node('button', 'pixel-back', '← К магазинам');
  back.type = 'button'; back.addEventListener('click', () => action('stores'));
  const title = node('h1', '', 'Каталог магазина'); title.id = 'pixel-storefront-title'; title.tabIndex = -1;
  const address = node('button', 'pixel-store-address', 'Выбрать адрес'); address.type = 'button';
  const scope = node('p', 'pixel-store-scope');
  storeHeading.append(back, title, address, scope); storefront.append(storeHeading);
  for (const selector of ['.hero', '#retail-browser', '.catalog-section']) {
    const existing = shop?.querySelector(selector); if (existing) storefront.append(existing);
  }

  // Shared references are reachable without implicitly selecting the default
  // retailer. Chain-specific pickers appear only in an explicit storefront.
  const details = node('details', 'pixel-store-details'); details.id = 'pixel-store-details';
  let sharedDetailsOpen = false;
  const summary = node('summary', '', 'Адрес и источники');
  const detailsContent = node('div', 'pixel-store-details-content');
  const pickers = node('div', 'pixel-store-pickers'); pickers.hidden = true;
  const scopeReference = node('p', 'field-help pixel-store-reference-scope'); scopeReference.hidden = true;
  pickers.append(scopeReference);
  detailsContent.append(pickers); details.append(summary, detailsContent);
  shop?.prepend(home, storefront); shop?.append(details);

  const exactPickerIds = Object.freeze({
    magnit: ['magnit-store-picker', 'magnit-store-address'],
    globus: ['globus-store-picker', 'globus-store-address'],
    metro: ['metro-store-picker', 'metro-store-address']
  });
  let pendingAddress = null;
  const watchedPickerSearches = new WeakSet();
  function clearPendingSelection() {
    if (!pendingAddress) return;
    const { select } = pendingAddress;
    for (const option of [...select.options]) {
      if (!option.value && option.dataset.pixelAddressPrompt !== 'true') option.remove();
    }
    let prompt = select.querySelector('[data-pixel-address-prompt]');
    if (!prompt) {
      prompt = node('option');
      prompt.value = ''; prompt.disabled = true; prompt.dataset.pixelAddressPrompt = 'true';
      select.prepend(prompt);
    }
    prompt.textContent = [...select.options].some(option => option.value && !option.disabled)
      ? 'Выберите адрес магазина' : 'Адрес не найден';
    select.value = '';
    renderExactCards();
  }
  function renderExactCards() {
    exactCards.replaceChildren();
    if (!pendingAddress) return;
    const options = [...pendingAddress.select.options].filter(option => option.value && !option.disabled);
    for (const option of options.slice(0, 24)) {
      const card = node('button', 'pixel-store-address-choice'); card.type = 'button';
      card.dataset.storeId = option.value;
      card.append(node('strong', '', option.textContent), node('small', '', 'Открыть каталог · дату цен покажем внутри'));
      card.addEventListener('click', () => {
        if (!pendingAddress) return;
        pendingAddress.select.value = option.value;
        pendingAddress.select.dispatchEvent(new view.Event('change', { bubbles: true }));
      });
      exactCards.append(card);
    }
    if (!options.length) exactCards.append(node('p', '', 'Адрес не найден. Уточните город или улицу.'));
    if (options.length > 24) exactCards.append(node('p', '', 'Показаны первые 24 адреса. Уточните город или улицу.'));
  }
  function showPendingPicker() {
    if (!pendingAddress) return;
    for (const [id, [sectionId]] of Object.entries(exactPickerIds)) {
      const section = document.getElementById(sectionId);
      if (!section) continue;
      const visible = id === pendingAddress.retailerId;
      section.hidden = !visible;
      section.style.display = visible ? 'grid' : 'none';
    }
    pickers.hidden = false;
  }
  function closeAddressChooser({ restoreFocus = false, preserveSelection = false } = {}) {
    if (!pendingAddress) return;
    const { select, search, originalValue, sourceButton } = pendingAddress;
    pendingAddress = null;
    search.value = '';
    search.dispatchEvent(new view.Event('input', { bubbles: true }));
    select.querySelector('[data-pixel-address-prompt]')?.remove();
    delete select.dataset.pixelOriginalAddress;
    if (!preserveSelection) select.value = originalValue;
    detailsContent.prepend(pickers);
    addressChooser.hidden = true;
    storeSearch.hidden = false; storeStatus.hidden = false;
    if (stores) stores.hidden = false;
    pickers.hidden = state.stage !== 'store';
    if (restoreFocus && sourceButton.isConnected) sourceButton.focus({ preventScroll: true });
  }
  function openAddressChooser(retailerId, sourceButton) {
    const pair = exactPickerIds[retailerId];
    if (!pair) return;
    const section = document.getElementById(pair[0]);
    const select = document.getElementById(pair[1]);
    const search = section?.querySelector('input[type="search"]');
    if (!section || !select || !search) {
      storeStatus.textContent = 'Выбор адреса временно недоступен. Попробуйте ещё раз.';
      return;
    }
    closeAddressChooser();
    pendingAddress = { retailerId, sourceButton, select, search, originalValue: select.value };
    select.dataset.pixelOriginalAddress = select.value;
    const name = sourceButton.querySelector('.retail-store-copy strong')?.textContent || retailerId;
    chooserTitle.textContent = `Выберите адрес: ${name}`;
    addressChooser.hidden = false;
    storeSearch.hidden = true; storeStatus.hidden = true;
    addressResults.hidden = true;
    if (stores) stores.hidden = true;
    chooserControls.append(pickers);
    search.value = '';
    search.dispatchEvent(new view.Event('input', { bubbles: true }));
    showPendingPicker();
    clearPendingSelection();
    if (!watchedPickerSearches.has(search)) {
      search.addEventListener('input', () => {
        if (pendingAddress?.search === search) clearPendingSelection();
      });
      watchedPickerSearches.add(search);
    }
    addressChooser.scrollIntoView({ block: 'start', behavior: 'auto' });
    search.focus({ preventScroll: true });
  }
  chooserBack.addEventListener('click', () => closeAddressChooser({ restoreFocus: true }));
  document.addEventListener('checkni:shop-action', event => {
    if (event.detail?.action !== 'choose-address') return;
    openAddressChooser(event.detail.retailerId, event.detail.sourceButton);
  });

  const location = node('button', 'hori-location pixel-location', '⌖ Москва и МО'); location.type = 'button';
  const selected = node('button', 'hori-selected-store pixel-selected-store');
  selected.type = 'button'; selected.hidden = true; selected.addEventListener('click', () => action('root'));
  const headerControls = node('div', 'pixel-header-controls');
  const motionControls = node('div', 'pixel-motion-controls'); motionControls.setAttribute('aria-label', 'Анимация фона');
  headerControls.append(motionControls);
  const motionHost = node('div', 'pixel-motion-band pixel-motion-host'); motionHost.setAttribute('aria-hidden', 'true');
  const nav = node('nav', 'pixel-nav'); nav.setAttribute('aria-label', 'Основная навигация');
  const navButtons = new Map(); let count;
  const storeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M4 3h16v3h2v5h-2v10h-7v-7H9v7H4V11H2V6h2zm2 3v3h3V6zm6 0v3h3V6zm6 0v3h2V6z"/></svg>';
  const listIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M3 3h4v4H3zm7 0h11v4H10zM3 10h4v4H3zm7 0h11v4H10zM3 17h4v4H3zm7 0h11v4H10z"/></svg>';
  for (const [name, label] of [['stores', 'Магазины'], ['basket', 'Список'], ['hory', 'Хоря']]) {
    const button = node('button', 'pixel-nav-button'); button.type = 'button'; button.dataset.pixelAction = name;
    const icon = node('span', 'pixel-nav-icon'); icon.setAttribute('aria-hidden', 'true');
    if (name === 'hory') {
      const mascot = node('img', 'pixel-hory-avatar');
      mascot.src = new URL('../img/hory-avatar-v5.webp', import.meta.url).href;
      mascot.alt = ''; mascot.width = 40; mascot.height = 32; icon.append(mascot);
    } else icon.innerHTML = name === 'stores' ? storeIcon : listIcon;
    const caption = node('span', 'pixel-nav-label', label);
    if (name === 'hory') {
      const copy = node('span', 'pixel-hory-copy');
      copy.append(caption, node('span', 'pixel-hory-hint', 'Помогу с покупками'));
      button.append(icon, copy);
      button.title = 'Хоря поможет подобрать продукты и собрать список';
      button.setAttribute('aria-label', 'Хоря — помогу с покупками');
    } else button.append(icon, caption);
    if (name === 'basket') {
      count = node('span', 'pixel-nav-count', '0'); count.id = 'pixel-list-count';
      count.setAttribute('aria-hidden', 'true'); button.append(count);
    }
    if (name === 'hory') {
      button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'pixel-hory-dialog');
      button.setAttribute('aria-expanded', 'false'); button.addEventListener('click', () => onOpenHory?.());
    } else button.addEventListener('click', () => action(name));
    navButtons.set(name, button); nav.append(button);
  }
  header.append(location, selected, nav, headerControls, motionHost);
  // A fixed mobile bar must not share the animated header's stacking context.
  // Move the original tree, so navigation handlers, counts and focus stay intact.
  const desktopNavigation = view.matchMedia('(min-width: 1000px)');
  function mountNavigation() {
    const parent = desktopNavigation.matches ? header : document.body;
    if (nav.parentElement === parent) return;
    const focused = document.activeElement;
    const restoreFocus = nav.contains(focused);
    if (desktopNavigation.matches) header.insertBefore(nav, headerControls); else parent.append(nav);
    if (restoreFocus && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }
  mountNavigation();
  if (desktopNavigation.addEventListener) desktopNavigation.addEventListener('change', mountNavigation);
  else desktopNavigation.addListener(mountNavigation);

  let state = { stage: 'stores', view: 'shop', basketUnits: 0 }; let assistantOpen = false;
  function syncNavigation() {
    const active = assistantOpen ? 'hory' : state.view === 'basket' ? 'basket' : 'stores';
    for (const [name, button] of navButtons) {
      if (name === active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    navButtons.get('hory').setAttribute('aria-expanded', String(assistantOpen));
  }
  function mountExtras() {
    const searchForm = document.getElementById('search-form');
    const sort = document.querySelector('.catalog-section .catalog-sort');
    if (searchForm && sort) searchForm.append(sort);
    const note = document.getElementById('catalog-note');
    if (searchForm && note && !note.closest('.hori-price-note')) {
      const priceNote = node('details', 'hori-price-note');
      const priceSummary = node('summary', '', 'О ценах');
      priceSummary.setAttribute('aria-label', 'О ценах и источниках каталога');
      priceNote.append(priceSummary, note); searchForm.append(priceNote);
    }
    for (const selector of ['#globus-store-picker', '#metro-store-picker', '#magnit-store-picker']) {
      const existing = document.querySelector(selector); if (existing && existing.parentElement !== pickers) pickers.append(existing);
    }
    for (const selector of ['#beta-live-section', '#pyaterochka-published,.pyat-published', '.okey-directory', '.okey-delivery', '#stores-section']) {
      for (const existing of document.querySelectorAll(selector)) {
        if (existing.parentElement !== detailsContent) detailsContent.append(existing);
      }
    }
    const nearby = document.getElementById('nearby-shopping');
    if (nearby) {
      const destination = state.stage === 'store' ? detailsContent : home;
      if (nearby.parentElement !== destination) {
        if (destination === home) home.insertBefore(nearby, storeSearch); else destination.append(nearby);
        const extra = nearby.querySelector('.nearby-extra');
        if (extra) extra.open = destination !== home;
      }
      nearby.classList.toggle('nearby-home', destination === home);
      if (destination === home) {
        nearby.querySelector('#nearby-shopping-panel').hidden = false;
        nearby.querySelector(':scope > button').setAttribute('aria-expanded', 'true');
      }
    }
    ensurePublishedEntries();
  }
  // These entries reveal existing city-promotion readers. They do not select
  // an exact store or create a new catalogue/price/comparison definition.
  function ensurePublishedEntries() {
    if (!stores) return;
    for (const entry of publishedEntries) {
      const target = document.querySelector(entry.selector);
      if (!target) continue;
      let button = publishedButtons.get(entry.id);
      if (!button) {
        button = node('button', 'retail-store-card pixel-published-store-card');
        button.type = 'button'; button.id = `retail-store-card-${entry.id}`;
        button.dataset.retailerId = entry.id; button.dataset.storeSearchAliases = entry.aliases;
        button.setAttribute('aria-label', `${entry.name}: ${entry.scope}`);
        button.setAttribute('aria-controls', target.id);
        const logo = node('span', 'retail-store-logo', entry.name); logo.setAttribute('aria-hidden', 'true');
        const copy = node('span', 'retail-store-copy');
        copy.append(node('span', 'retail-store-kicker', 'Акции Москвы'), node('strong', '', entry.name), node('span', '', entry.scope));
        button.append(logo, copy, node('span', 'retail-store-total', 'Посмотреть акции'));
        button.addEventListener('click', () => {
          openDetails(); target.open = true;
          view.requestAnimationFrame(() => {
            if (!target.isConnected) return;
            reveal(target); target.querySelector(':scope > summary')?.focus({ preventScroll: true });
          });
        });
        target.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(target.open)));
        publishedButtons.set(entry.id, button);
      }
      button.setAttribute('aria-expanded', String(target.open));
      if (button.parentElement !== stores) stores.append(button);
    }
  }
  function reveal(target) {
    if (!target?.isConnected) return;
    const dialog = target.closest('dialog');
    if (dialog) { if (dialog.open) target.scrollIntoView({ block: 'nearest', behavior: 'auto' }); return; }
    if (details.contains(target)) details.open = true;
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  function openDetails({ focusNearby = false, emit = true } = {}) {
    closeAddressChooser();
    sharedDetailsOpen = true;
    mountExtras(); details.hidden = false; details.open = true; if (emit) action('address');
    view.requestAnimationFrame(() => {
      reveal(details);
      const target = focusNearby ? detailsContent.querySelector('#nearby-address') : state.stage === 'store'
        ? [...pickers.querySelectorAll('select')].find(control => !control.closest('[hidden]'))
        : detailsContent.querySelector('#nearby-shopping button');
      (target || summary).focus({ preventScroll: true });
    });
  }
  function focusAddress() {
    closeAddressChooser(); action('stores'); mountExtras();
    const input = document.getElementById('nearby-address');
    input?.scrollIntoView({ block: 'center' }); input?.focus({ preventScroll: true });
  }
  address.addEventListener('click', focusAddress); location.addEventListener('click', focusAddress);
  document.addEventListener('checkni:shop-action', event => {
    if (event.detail?.action !== 'stores') return;
    sharedDetailsOpen = false;
    details.open = false;
    details.hidden = state.stage !== 'store';
  });
  document.addEventListener('checkni:shop-action', event => {
    if (event.detail?.action !== 'address' || !['nearby','map'].includes(event.detail?.target)) return;
    onOpenAddress?.();
    openDetails({ focusNearby: true, emit: false });
  });

  const selectableAddressIndex = new Map();
  let addressQuery = '', addressesExpanded = false;
  function filterStores() {
    if (!stores) return;
    ensurePublishedEntries();
    const query = searchInput.value.trim();
    if (query !== addressQuery) { addressQuery = query; addressesExpanded = false; }
    const pickerIds = { magnit: 'magnit-store-address', metro: 'metro-store-address', globus: 'globus-store-address' };
    const cards = [...stores.querySelectorAll('.retail-store-card')];
    const entries = cards.map(card => {
      const retailerId = card.dataset.retailerId;
      const select = document.getElementById(pickerIds[retailerId]);
      if (select && !selectableAddressIndex.has(retailerId)) {
        selectableAddressIndex.set(retailerId, [...select.options].map(option => ({
          label: option.textContent, value: option.value, selectable: !option.disabled && Boolean(option.value)
        })));
      }
      return { retailerId, name: card.querySelector('.retail-store-copy strong')?.textContent || retailerId,
        cardText: `${card.textContent} ${card.dataset.storeSearchAliases || ''}`,
        addresses: selectableAddressIndex.get(retailerId) ?? [] };
    });
    const matches = findStoreSearchMatches(query, entries);
    const matchingIds = new Set(matches.map(match => match.retailerId));
    for (const card of cards) card.hidden = !matchingIds.has(card.dataset.retailerId);
    addressResults.replaceChildren();
    const addresses = query ? matches.flatMap(match => match.matchedAddresses.map(address => ({
      ...address, retailerId: match.retailerId,
      name: entries.find(entry => entry.retailerId === match.retailerId)?.name ?? match.retailerId
    }))) : [];
    // Show one address per matching network before the remaining choices.
    const firstByNetwork = matches.flatMap(match => {
      const address = addresses.find(row => row.retailerId === match.retailerId);
      return address ? [address] : [];
    });
    const firstKeys = new Set(firstByNetwork.map(row => `${row.retailerId}:${row.value}`));
    const ordered = [...firstByNetwork, ...addresses.filter(row => !firstKeys.has(`${row.retailerId}:${row.value}`))];
    const shown = addressesExpanded ? ordered : ordered.slice(0, 4);
    if (shown.length) {
      const title = node('h2', 'pixel-store-address-title', 'Подходящие адреса');
      const list = node('div', 'pixel-store-address-list');
      for (const address of shown) {
        const button = node('button', 'pixel-store-address-choice'); button.type = 'button';
        button.dataset.retailerId = address.retailerId; button.dataset.storeId = address.value;
        button.textContent = address.retailerId === 'globus'
          ? address.label.replace(/^(?:Москва|МО) · /u, '').replace(/ — [^—]+$/u, '')
          : `${address.name} · ${address.label}`;
        button.addEventListener('click', () => {
          const select = document.getElementById(pickerIds[address.retailerId]);
          const pickerSearch = select?.parentElement?.querySelector('input[type="search"]');
          if (pickerSearch?.value) {
            pickerSearch.value = '';
            pickerSearch.dispatchEvent(new view.Event('input', { bubbles: true }));
          }
          const option = [...(select?.options ?? [])].find(item => item.value === address.value && !item.disabled);
          if (!option) return;
          select.value = address.value;
          select.dispatchEvent(new view.Event('change', { bubbles: true }));
        });
        list.append(button);
      }
      addressResults.append(title, list);
      if (addresses.length > 4) {
        const toggle = node('button', 'pixel-store-address-toggle', addressesExpanded
          ? 'Свернуть адреса' : `Показать все ${addresses.length} адресов`);
        toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(addressesExpanded));
        toggle.addEventListener('click', () => {
          addressesExpanded = !addressesExpanded;
          filterStores();
          addressResults.querySelector('.pixel-store-address-toggle')?.focus({ preventScroll: true });
        });
        addressResults.append(toggle);
      }
    }
    addressResults.hidden = Boolean(pendingAddress) || !shown.length;
    storeStatus.textContent = query && !matches.length
      ? 'Магазин или адрес не найден. Уточните название или город.'
      : query ? `Сетей: ${matches.length}${addresses.length ? ` · адресов: ${addresses.length}` : ''}`
        : `Сетей: ${cards.length}`;
  }
  storeSearch.addEventListener('submit', event => { event.preventDefault(); filterStores(); });
  searchInput.addEventListener('input', filterStores);
  if (stores) new view.MutationObserver(filterStores).observe(stores, { childList: true });

  function applyState(detail = {}) {
    state = { ...state, ...detail,
      stage: detail.stage === 'store' ? 'store' : detail.stage === 'stores' ? 'stores' : state.stage,
      view: detail.view === 'basket' ? 'basket' : detail.view === 'shop' ? 'shop' : state.view };
    const inStore = state.stage === 'store';
    if (inStore) closeAddressChooser({ preserveSelection: true });
    document.body.dataset.pixelStage = state.stage; document.body.dataset.pixelView = state.view;
    main.dataset.horiView = state.view === 'basket' ? 'basket' : state.stage;
    home.hidden = inStore; storefront.hidden = !inStore; details.hidden = !inStore && !sharedDetailsOpen;
    pickers.hidden = !inStore; selected.hidden = !inStore;
    const displayName = typeof state.displayName === 'string' ? state.displayName : 'Магазин';
    selected.textContent = displayName; selected.setAttribute('aria-label', `Категории магазина ${displayName}`);
    title.textContent = displayName; address.textContent = state.storeAddress || 'Выбрать адрес';
    const fullScope = typeof state.scopeLabel === 'string' ? state.scopeLabel : '';
    const storeAddress = typeof state.storeAddress === 'string' ? state.storeAddress : '';
    const repeatedPrefix = storeAddress && [' · ', ' — ', ' | '].map(separator => storeAddress + separator)
      .find(prefix => fullScope.startsWith(prefix));
    scope.textContent = repeatedPrefix ? fullScope.slice(repeatedPrefix.length) : fullScope;
    scope.hidden = !scope.textContent;
    scopeReference.textContent = inStore ? fullScope : ''; scopeReference.hidden = !inStore || !fullScope;
    const units = Number.isSafeInteger(state.basketUnits) && state.basketUnits >= 0 ? state.basketUnits : 0;
    const needs = Number.isSafeInteger(state.unresolvedNeeds) && state.unresolvedNeeds > 0 ? state.unresolvedNeeds : 0;
    count.textContent = needs ? units ? `${units} · +${needs} поз.` : `${needs} поз.` : String(units);
    navButtons.get('basket').setAttribute('aria-label', `Открыть список покупок, выбранных товаров: ${units}${needs ? `, ещё выбрать позиций: ${needs}` : ''}`);
    const dock = document.getElementById('basket-dock');
    if (dock) dock.hidden = state.view === 'basket' || !inStore || units === 0;
    syncNavigation(); mountExtras(); filterStores();
    if (pendingAddress) showPendingPicker();
  }
  document.addEventListener('checkni:shop-state', event => applyState(event.detail));
  queueMicrotask(() => { mountExtras(); filterStores(); }); applyState();

  // Keep the app's original search request and stale-response guards.
  const productSearch = document.getElementById('product-search');
  const products = document.getElementById('product-grid'); let revealSearch = false;
  document.getElementById('search-form')?.addEventListener('submit', () => { revealSearch = Boolean(productSearch?.value.trim()); });
  productSearch?.addEventListener('input', () => { if (!productSearch.value.trim()) revealSearch = false; });
  document.getElementById('clear-search')?.addEventListener('click', () => { revealSearch = false; });
  if (products) new view.MutationObserver(() => {
    if (!productSearch?.value.trim()) revealSearch = false;
    if (revealSearch && products.querySelector('.product-card')) {
      revealSearch = false;
      const query = productSearch.value;
      const retailer = state.retailerId;
      view.requestAnimationFrame(() => {
        if (state.view !== 'shop' || state.stage !== 'store' || assistantOpen
          || productSearch.value !== query || state.retailerId !== retailer) return;
        reveal(products.closest('.catalog-section'));
      });
    }
  }).observe(products, { childList: true });
  return Object.freeze({ reveal, mountExtras, motionHost, motionControls, headerControls,
    assistantButton: navButtons.get('hory'),
    setAssistantOpen(open) { assistantOpen = Boolean(open); syncNavigation(); } });
}
