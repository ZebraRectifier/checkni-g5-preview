import { createHoriCommerce } from './HoriCommerce.mjs';

// Presentation shell only: existing ports, confirmation handlers and Core keep
// ownership of product identities, observed prices and basket calculations.
export function createHoriWorkspace({ form, input, output, welcome, dialogue }) {
  const document = form.ownerDocument;
  const section = form.closest('#basket-proposal-section');
  const main = document.getElementById('main');
  const header = document.querySelector('.app-header');
  const publicHost = location.hostname === 'zebrarectifier.github.io' || location.hostname.endsWith('.vercel.app');
  const retailSurface = publicHost || new URLSearchParams(location.search).get('catalog') === 'retail';
  if (!section || !main || !header || !retailSurface) return { present() {} };
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = new URL('./hori-reference-v13.css', import.meta.url).href;
  document.head.append(sheet);
  document.body.classList.add('hori-workspace');
  header.classList.replace('app-header', 'hori-header');
  form.classList.replace('proposal-form', 'hori-form');
  section.classList.remove('phrase-entry', 'phrase-entry-primary');
  section.classList.add('hori-stage');
  header.after(section);
  section.setAttribute('aria-label', 'Хори — помощник с покупками');
  const title = section.querySelector('#phrase-entry-title');
  if (title) title.innerHTML = '<span class="hori-name">Хори</span>';
  const scene = document.createElement('div');
  scene.className = 'hori-scene';
  scene.setAttribute('role', 'img');
  scene.setAttribute('aria-label', 'Хори в чёрных очках за ноутбуком');
  const room = document.createElement('img');
  room.src = new URL('../img/hori-room-v13.png', import.meta.url).href;
  room.alt = ''; room.width = 1448; room.height = 1086;
  room.fetchPriority = 'high';
  scene.append(room);
  section.append(scene);
  const greeting = document.createElement('p');
  greeting.className = 'hori-greeting';
  greeting.append('Привет! Я Хори. ', document.createElement('br'), 'Что покупаем?');
  welcome.prepend(greeting);
  const label = form.querySelector('.proposal-box');
  if (label) { label.classList.replace('proposal-box', 'hori-composer'); form.append(label); }
  input.placeholder = 'Что нужно купить?';
  const send = document.getElementById('basket-proposal-submit');
  send?.setAttribute('aria-label', 'Отправить сообщение Хори');
  document.getElementById('product-search')?.setAttribute('placeholder', 'Найти продукты');
  const help = document.getElementById('basket-proposal-help');
  if (help) { help.textContent = 'Можно списком или своими словами.'; form.append(help); }
  const results = document.createElement('section');
  results.id = 'hori-shopping-results';
  results.className = 'hori-shopping-results';
  results.setAttribute('aria-label', 'Подобранные товары и реальные наблюдения цен');
  results.hidden = true;
  const shop = document.getElementById('shop-view');
  shop?.querySelector('.hero')?.after(results);
  const commerce = createHoriCommerce({ document, main, shop, header });

  const theme = document.createElement('button');
  theme.id = 'hori-theme'; theme.type = 'button';
  let appearance = null;
  try { const saved = localStorage.getItem('checkni.appearance.v1'); if (['light', 'dark'].includes(saved)) appearance = saved; } catch { /* Tab-only theme remains usable. */ }
  const system = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    // The newly approved v13 starts in its soft light palette. A previous
    // explicit appearance choice still wins and never resets shopping state.
    const dark = appearance === 'dark';
    document.body.dataset.horiTheme = dark ? 'dark' : 'light';
    theme.innerHTML = '<span aria-hidden="true">☀</span><span aria-hidden="true">☾</span>';
    theme.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  };
  theme.addEventListener('click', () => {
    appearance = document.body.dataset.horiTheme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('checkni.appearance.v1', appearance); } catch { /* Keep current session. */ }
    applyTheme();
  });
  system?.addEventListener?.('change', () => { if (!appearance) applyTheme(); });
  header.append(theme); applyTheme();

  // These existing pickers are mounted by app.mjs immediately after this
  // component. Keep their identity/listeners but place commerce below the AI.
  queueMicrotask(() => {
    for (const node of form.querySelectorAll('.nearby-shopping, .pyat-published')) results.before(node);
    const example = document.getElementById('beta-live-section');
    if (example) shop?.querySelector('.catalog-section')?.after(example);
  });
  // Keep the newest finite response visible without scrolling the shop pane.
  const reveal = () => requestAnimationFrame(() => { dialogue.scrollTop = dialogue.scrollHeight; });
  const observer = new MutationObserver(reveal);
  observer.observe(output, { childList: true, subtree: true, characterData: true });
  return Object.freeze({
    present() {
      const previouslyVisible = !results.hidden;
      results.replaceChildren();
      for (const node of output.querySelectorAll('.guided-shopping, .shopping-selection-cards')) results.append(node);
      results.hidden = !results.childElementCount;
      if (!results.hidden && !previouslyVisible) commerce.reveal(results);
      reveal();
    }
  });
}
