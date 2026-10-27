import { GLOBUS_MOSCOW_REGION_DIRECTORY as directory, resolveGlobusMoscowRegionStore } from '../data/globusMoscowRegionStores.mjs';
import {
  classifyGlobusLatestObservation, GLOBUS_RECENT_PRICE_MAX_AGE_MS,
  readGlobusStoreLatestObservation
} from '../ports/globusStoreLatestObservationPort.mjs';
const normalize = text => String(text ?? '').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё','е');
const reviewedBasketStores = Object.freeze(['5011', '5020']);
const moscowDate = observedAt => new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit'
}).format(new Date(observedAt));

export function globusObservationCopy(result, nowMs = Date.now()) {
  if (result?.kind === 'loading') return {
    option: 'проверяем дату цен',
    note: 'Проверяем дату последнего наблюдения. Наличие неизвестно.'
  };
  const state = classifyGlobusLatestObservation(result, nowMs);
  if (state === 'recent') return {
    option: 'есть недавнее наблюдение',
    note: `Последнее наблюдение: ${moscowDate(result.observedAt)} МСК. Другие товары могут быть старее; наличие неизвестно.`
  };
  if (state === 'dated') return {
    option: 'свежих цен нет',
    note: `Последнее наблюдение: ${moscowDate(result.observedAt)} МСК. Свежих цен по адресу нет; сохранённые цены относятся к прошлым наблюдениям. Наличие неизвестно.`
  };
  if (state === 'missing') return {
    option: 'наблюдений цен нет',
    note: 'По этому адресу пока нет сохранённых цен. Наличие неизвестно.'
  };
  return {
    option: 'дата цен не проверена',
    note: 'Дата последнего наблюдения пока не проверена. Откройте источник у товара; наличие неизвестно.'
  };
}
export function resolveGlobusComparisonPeer(primaryId, peerId) {
  if (!reviewedBasketStores.includes(primaryId) || !reviewedBasketStores.includes(peerId) || primaryId === peerId) return null;
  const peer = resolveGlobusMoscowRegionStore(peerId);
  return peer?.priceStatus === 'verified' && peer.scope === 'moscow-city' ? peer : null;
}
export function createGlobusStorePicker({ officialStoreId = '5011', onSelect, onCompareSelect,
  readLatestObservation = readGlobusStoreLatestObservation } = {}) {
  const section = document.createElement('section'); section.id = 'globus-store-picker';
  section.setAttribute('aria-label','Выбор адреса Глобус');
  Object.assign(section.style, { marginBlock: '16px', display: 'grid', gap: '8px' });
  const label = document.createElement('label'); label.htmlFor = 'globus-store-address';
  label.textContent = 'Адрес Глобус — Москва и Московская область';
  const summary = document.createElement('p'); summary.id = 'globus-store-summary';
  const proven = directory.stores.filter(s => s.priceStatus === 'verified').length;
  summary.textContent = `${directory.stores.length} адресов в официальном справочнике · ${proven} с адресным каталогом · ${directory.stores.length - proven} пока без адресного каталога. Свежесть цен проверяется отдельно.`;
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Город, улица или номер дома';
  search.setAttribute('aria-label', 'Найти адрес Глобус');
  const select = document.createElement('select'); select.id = 'globus-store-address'; select.setAttribute('aria-label','Адрес Глобус');
  for (const el of [search,select]) Object.assign(el.style, { width: '100%', minHeight: '44px', boxSizing: 'border-box' });
  const note = document.createElement('p'); note.id = 'globus-store-note'; note.setAttribute('role','status');
  const compareLabel = document.createElement('label'); compareLabel.htmlFor = 'globus-compare-address';
  compareLabel.textContent = 'Второй адрес Глобус для сравнения корзины';
  const compareSelect = document.createElement('select'); compareSelect.id = 'globus-compare-address';
  compareSelect.setAttribute('aria-label', compareLabel.textContent);
  Object.assign(compareSelect.style, { width: '100%', minHeight: '44px', boxSizing: 'border-box' });
  const compareNote = document.createElement('p');
  let selected = String(officialStoreId), selectedStore = null, catalogStatus = 'idle', hasCategories = false;
  const checked = new Map(), pending = new Set(); let ageingTimer = null;
  const observedFor = id => checked.get(id)?.result ?? { kind: 'unknown' };
  function renderNote() {
    if (!selectedStore) return;
    note.textContent = catalogStatus === 'loading' ? 'Загружаем каталог выбранного адреса…'
      : selectedStore.priceStatus !== 'verified' ? 'По этому адресу каталог цен пока не подтверждён.'
      : catalogStatus === 'ready' && !hasCategories ? 'Адрес подтверждён, но каталог временно не загрузился. ' + globusObservationCopy(observedFor(selected)).note
      : globusObservationCopy(observedFor(selected)).note;
  }
  function scheduleAgeing(result) {
    if (ageingTimer) clearTimeout(ageingTimer);
    ageingTimer = null;
    if (classifyGlobusLatestObservation(result) !== 'recent') return;
    const delay = Date.parse(result.observedAt) + GLOBUS_RECENT_PRICE_MAX_AGE_MS - Date.now() + 1000;
    ageingTimer = setTimeout(() => { renderOptions(); renderNote(); }, Math.max(1000, delay));
  }
  function checkSelectedObservation() {
    if (selectedStore?.priceStatus !== 'verified' || pending.has(selected)) return;
    const prior = checked.get(selected);
    if (prior && Date.now() - prior.checkedAt < 60_000) return;
    const id = selected;
    pending.add(id);
    checked.set(id, { result: { kind: 'loading' }, checkedAt: Date.now() });
    renderOptions(); renderNote();
    void Promise.resolve().then(() => readLatestObservation(id)).then(result => {
      checked.set(id, { result, checkedAt: Date.now() });
      if (id === selected) { renderOptions(); renderNote(); scheduleAgeing(result); }
    }).catch(() => {
      checked.set(id, { result: { kind: 'unknown' }, checkedAt: Date.now() });
      if (id === selected) { renderOptions(); renderNote(); }
    }).finally(() => { pending.delete(id); });
  }
  let comparisonId = '';
  function renderComparisonOptions() {
    const primary = resolveGlobusMoscowRegionStore(selected);
    compareSelect.replaceChildren();
    const none = document.createElement('option'); none.value = ''; none.textContent = 'Выберите второй адрес';
    compareSelect.append(none);
    for (const store of directory.stores) {
      if (!resolveGlobusComparisonPeer(selected, store.officialStoreId)) continue;
      const option = document.createElement('option'); option.value = store.officialStoreId;
      option.textContent = `${store.name} · ${store.address}`; compareSelect.append(option);
    }
    compareSelect.value = comparisonId;
    if (compareSelect.value !== comparisonId) { comparisonId = ''; compareSelect.value = ''; }
    compareSelect.disabled = !reviewedBasketStores.includes(primary?.officialStoreId);
    compareNote.textContent = !compareSelect.disabled
      ? 'Сравним одинаковые упаковки в Красногорске и Медведково. Для расчёта нужны цены младше часа; наличие неизвестно.'
      : 'Первое сравнение корзины доступно между Глобус Красногорск и Глобус Медведково. По выбранному адресу остаётся просмотр каталога.';
  }
  function renderOptions() {
    const terms = normalize(search.value).trim().split(/\s+/u).filter(Boolean); select.replaceChildren();
    for (const store of directory.stores) {
      const region = store.scope === 'moscow-city' ? 'Москва' : 'МО';
      if (store.officialStoreId !== selected && !terms.every(t => normalize(store.name + ' ' + store.address + ' ' + region).includes(t))) continue;
      const option = document.createElement('option'); option.value = store.officialStoreId;
      const copy = store.officialStoreId === selected && checked.has(selected)
        ? globusObservationCopy(observedFor(selected)).option
        : 'дата цен после выбора';
      option.textContent = `${region} · ${store.name} · ${store.address} — ${store.priceStatus === 'verified' ? copy : 'адресный каталог пока недоступен'}`;
      option.disabled = store.priceStatus !== 'verified'; option.selected = store.officialStoreId === selected; select.append(option);
    }
  }
  search.addEventListener('input',renderOptions);
  select.addEventListener('change', () => {
    const store = resolveGlobusMoscowRegionStore(select.value);
    if (store?.priceStatus === 'verified') onSelect(store);
  });
  compareSelect.addEventListener('change', () => {
    comparisonId = compareSelect.value;
    onCompareSelect?.(comparisonId ? resolveGlobusMoscowRegionStore(comparisonId) : null);
  });
  section.append(label,summary,search,select,note);
  if (typeof onCompareSelect === 'function') section.append(compareLabel,compareSelect,compareNote);
  document.addEventListener('checkni:shop-state', event => {
    if (event.detail?.stage === 'store' && event.detail?.retailerId === 'globus') checkSelectedObservation();
  });
  renderOptions(); renderComparisonOptions();
  return { element: section, update({ visible, store, comparisonStore = null, status, hasCategories }) {
    section.hidden = !visible; section.style.display = visible ? 'grid' : 'none';
    if (store && selected !== store.officialStoreId) {
      if (ageingTimer) clearTimeout(ageingTimer);
      ageingTimer = null; selected = store.officialStoreId; search.value = ''; renderOptions();
    }
    selectedStore = store; catalogStatus = status; hasCategories = Boolean(hasCategories);
    comparisonId = comparisonStore?.officialStoreId ?? ''; renderComparisonOptions();
    if (!visible || !store) return;
    renderNote();
    if (document.body.dataset.pixelStage === 'store') checkSelectedObservation();
  } };
}

