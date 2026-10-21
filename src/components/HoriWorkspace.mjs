import { createHoriCommerce } from './HoriCommerce.mjs';
import { createHoriCubes } from './HoriCubes.mjs';

// Existing assistant nodes keep their listeners, conversation and confirmation
// state. The app and Core remain the owners of all shopping facts.
export function createHoriWorkspace({ form, input, output, welcome, dialogue }) {
  const document = form.ownerDocument; const view = document.defaultView;
  const section = form.closest('#basket-proposal-section');
  const main = document.getElementById('main'); const header = document.querySelector('.app-header');
  const publicHost = view.location.hostname === 'zebrarectifier.github.io' || view.location.hostname.endsWith('.vercel.app');
  const retailSurface = publicHost || new URLSearchParams(view.location.search).get('catalog') === 'retail';
  if (!section || !main || !header || !retailSurface) return { present() {} };
  const sheet = document.createElement('link'); sheet.rel = 'stylesheet';
  sheet.href = new URL('./pixel-storefront.css', import.meta.url).href; document.head.append(sheet);
  document.body.classList.add('hori-workspace', 'pixel-workspace');
  header.classList.replace('app-header', 'hori-header'); header.classList.add('pixel-header');
  const badge = document.getElementById('comparison-mode-badge'); if (badge) badge.hidden = true;
  for (const selector of ['.hero-identity', '.hero>.eyebrow', '#shop-title', '.hero>.hero-copy', '#manual-divider']) {
    const existing = document.querySelector(selector); if (existing) existing.hidden = true;
  }

  const horyDialog = document.createElement('dialog');
  horyDialog.id = 'pixel-hory-dialog'; horyDialog.className = 'pixel-hory-dialog';
  horyDialog.setAttribute('aria-labelledby', 'pixel-hory-title');
  const dialogHeader = document.createElement('header'); dialogHeader.className = 'pixel-hory-header';
  const dialogTitle = document.createElement('h2'); dialogTitle.id = 'pixel-hory-title'; dialogTitle.textContent = 'Хоря';
  const close = document.createElement('button'); close.className = 'pixel-dialog-close'; close.type = 'button'; close.textContent = 'Закрыть';
  dialogHeader.append(dialogTitle, close); horyDialog.append(dialogHeader, section); document.body.append(horyDialog);
  section.classList.remove('phrase-entry', 'phrase-entry-primary'); section.classList.add('pixel-hory-section');
  section.setAttribute('aria-label', 'Хоря — помощник с покупками');
  const heading = section.querySelector('.phrase-entry-heading'); if (heading) heading.hidden = true;
  const title = section.querySelector('#phrase-entry-title'); if (title) title.textContent = 'Хоря';
  form.classList.replace('proposal-form', 'hori-form'); form.classList.add('pixel-hory-form');
  const greeting = document.createElement('p'); greeting.className = 'hori-greeting';
  greeting.textContent = 'Привет! Я Хоря. Что покупаем?'; welcome.prepend(greeting);
  const composer = form.querySelector('.proposal-box');
  if (composer) { composer.classList.replace('proposal-box', 'hori-composer'); form.append(composer); }
  input.placeholder = 'Что нужно купить?';
  document.getElementById('basket-proposal-submit')?.setAttribute('aria-label', 'Отправить сообщение Хоре');
  const help = document.getElementById('basket-proposal-help'); if (help) help.textContent = 'Напиши список продуктов или вопрос о покупках.';
  const results = document.createElement('section'); results.id = 'hori-shopping-results'; results.className = 'hori-shopping-results';
  results.setAttribute('aria-label', 'Подобранные товары и наблюдаемые цены'); results.hidden = true; horyDialog.append(results);

  let restoreAssistantFocus = true; let currentView = 'shop'; let commerce;
  const closeAssistant = ({ restoreFocus = true } = {}) => {
    restoreAssistantFocus = restoreFocus;
    if (typeof horyDialog.close === 'function') horyDialog.close();
    else { horyDialog.removeAttribute('open'); commerce?.setAssistantOpen(false); }
  };
  const openAssistant = () => {
    if (horyDialog.open) return;
    restoreAssistantFocus = true;
    if (typeof horyDialog.showModal === 'function') horyDialog.showModal(); else horyDialog.setAttribute('open', '');
    commerce?.setAssistantOpen(true);
    view.requestAnimationFrame(() => { if (horyDialog.open) input.focus({ preventScroll: true }); });
  };
  commerce = createHoriCommerce({ document, main, shop: document.getElementById('shop-view'), header,
    onOpenHory: openAssistant, onOpenAddress: () => { if (horyDialog.open) closeAssistant({ restoreFocus: false }); } });
  close.addEventListener('click', () => closeAssistant());
  horyDialog.addEventListener('close', () => {
    commerce.setAssistantOpen(false);
    if (restoreAssistantFocus && currentView !== 'basket') commerce.assistantButton.focus({ preventScroll: true });
    restoreAssistantFocus = true;
  });
  // Nearby/published catalogue controls may submit this same existing form.
  form.addEventListener('submit', openAssistant, { capture: true });
  document.addEventListener('checkni:shop-action', event => {
    if (horyDialog.open && ['stores', 'root', 'basket', 'address', 'manual-search'].includes(event.detail?.action)) {
      closeAssistant({ restoreFocus: false });
    }
  });
  document.addEventListener('checkni:shop-state', event => {
    if (event.detail?.view === 'shop' || event.detail?.view === 'basket') currentView = event.detail.view;
    if (event.detail?.view === 'basket' && horyDialog.open) {
      closeAssistant({ restoreFocus: false });
    }
  });

  const theme = document.createElement('button'); theme.id = 'hori-theme'; theme.type = 'button';
  let appearance = null;
  try { const saved = view.localStorage.getItem('checkni.appearance.v1'); if (['light', 'dark'].includes(saved)) appearance = saved; }
  catch { /* Theme remains usable without persistence. */ }
  const applyTheme = () => {
    const dark = appearance !== 'light'; document.body.dataset.horiTheme = dark ? 'dark' : 'light';
    theme.innerHTML = '<span aria-hidden="true">☀</span><span aria-hidden="true">☾</span>';
    theme.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  };
  theme.addEventListener('click', () => {
    appearance = document.body.dataset.horiTheme === 'dark' ? 'light' : 'dark';
    try { view.localStorage.setItem('checkni.appearance.v1', appearance); } catch { /* Tab-only theme is sufficient. */ }
    applyTheme();
  });
  commerce.headerControls.prepend(theme); applyTheme();
  createHoriCubes(commerce.motionHost, { toggleHost: commerce.motionControls });

  function renameAssistant() {
    const heading = dialogue.querySelector('.shopping-dialogue-header strong'); if (heading?.textContent === 'Хори') heading.textContent = 'Хоря';
    const currentGreeting = welcome.querySelector('.hori-greeting');
    if (currentGreeting?.textContent.includes('Я Хори')) currentGreeting.textContent = currentGreeting.textContent.replace('Я Хори', 'Я Хоря');
  }
  renameAssistant();
  const revealDialogue = () => view.requestAnimationFrame(() => { if (horyDialog.open) dialogue.scrollTop = dialogue.scrollHeight; });
  new view.MutationObserver(revealDialogue).observe(output, { childList: true, subtree: true, characterData: true });
  return Object.freeze({ present() {
    renameAssistant(); commerce.mountExtras();
    const previouslyVisible = !results.hidden; results.replaceChildren();
    for (const existing of output.querySelectorAll('.guided-shopping, .shopping-selection-cards')) results.append(existing);
    results.hidden = !results.childElementCount;
    if (!results.hidden && !previouslyVisible) commerce.reveal(results);
    revealDialogue();
  } });
}
