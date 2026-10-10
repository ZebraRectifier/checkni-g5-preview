import { GLOBUS_MOSCOW_REGION_DIRECTORY as directory, resolveGlobusMoscowRegionStore } from '../data/globusMoscowRegionStores.mjs';
const normalize = text => String(text ?? '').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё','е');
export function createGlobusStorePicker({ officialStoreId = '5011', onSelect }) {
  const section = document.createElement('section'); section.id = 'globus-store-picker';
  section.setAttribute('aria-label','Выбор адреса Глобус');
  Object.assign(section.style, { marginBlock: '16px', display: 'grid', gap: '8px' });
  const label = document.createElement('label'); label.htmlFor = 'globus-store-address';
  label.textContent = 'Адрес Глобус — Москва и Московская область';
  const summary = document.createElement('p'); summary.id = 'globus-store-summary';
  const proven = directory.stores.filter(s => s.priceStatus === 'verified').length;
  summary.textContent = `${directory.stores.length} адресов в официальном справочнике · ${proven} с подтверждёнными ценами · ${directory.stores.length - proven} пока без подтверждения`;
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Город, улица или номер дома';
  search.setAttribute('aria-label', 'Найти адрес Глобус');
  const select = document.createElement('select'); select.id = 'globus-store-address'; select.setAttribute('aria-label','Адрес Глобус');
  for (const el of [search,select]) Object.assign(el.style, { width: '100%', minHeight: '44px', boxSizing: 'border-box' });
  const note = document.createElement('p'); note.id = 'globus-store-note'; note.setAttribute('role','status');
  let selected = String(officialStoreId);
  function renderOptions() {
    const terms = normalize(search.value).trim().split(/\s+/u).filter(Boolean); select.replaceChildren();
    for (const store of directory.stores) {
      const region = store.scope === 'moscow-city' ? 'Москва' : 'МО';
      if (store.officialStoreId !== selected && !terms.every(t => normalize(store.name + ' ' + store.address + ' ' + region).includes(t))) continue;
      const option = document.createElement('option'); option.value = store.officialStoreId;
      option.textContent = `${region} · ${store.name} · ${store.address} — ${store.priceStatus === 'verified' ? 'цены подтверждены' : 'цены пока не подтверждены'}`;
      option.disabled = store.priceStatus !== 'verified'; option.selected = store.officialStoreId === selected; select.append(option);
    }
  }
  search.addEventListener('input',renderOptions);
  select.addEventListener('change', () => {
    const store = resolveGlobusMoscowRegionStore(select.value);
    if (store?.priceStatus === 'verified') onSelect(store);
  });
  section.append(label,summary,search,select,note); renderOptions();
  return { element: section, update({ visible, store, status, hasCategories }) {
    section.hidden = !visible; section.style.display = visible ? 'grid' : 'none';
    if (store && selected !== store.officialStoreId) { selected = store.officialStoreId; search.value = ''; renderOptions(); }
    if (!visible || !store) return;
    note.textContent = status === 'loading' ? 'Загружаем цены выбранного адреса…'
      : store.priceStatus !== 'verified' ? 'По этому адресу цены пока не подтверждены.'
      : status === 'ready' && !hasCategories ? 'Адрес подтверждён, но каталог временно не загрузился.'
      : 'Показаны обычные цены выбранного гипермаркета без карты. Ассортимент частичный; наличие неизвестно.';
  } };
}
