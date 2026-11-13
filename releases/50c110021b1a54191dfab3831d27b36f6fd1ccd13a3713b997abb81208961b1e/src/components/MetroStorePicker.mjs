import {
  METRO_MOSCOW_REGION_STORES,
  resolveMetroMoscowRegionStore
} from "../data/metroMoscowRegionStores.mjs";

const normalized = (text) => String(text ?? "")
  .normalize("NFKC")
  .toLocaleLowerCase("ru")
  .replaceAll("ё", "е");

function searchableText(store) {
  return [
    store.storeNumber,
    store.address,
    store.onlinePickupLabel,
    store.scope === "moscow-city" ? "Москва" : "Московская область"
  ].filter(Boolean).join(" ");
}

export function createMetroStorePicker({ storeNumber, onSelect }) {
  const section = document.createElement("section");
  section.id = "metro-store-picker";
  section.setAttribute("aria-label", "Выбор адреса METRO");
  Object.assign(section.style, { marginBlock: "16px", display: "grid", gap: "8px" });

  const label = document.createElement("label");
  label.htmlFor = "metro-store-address";
  label.textContent = "Адрес METRO — Москва и Московская область";

  const summary = document.createElement("p");
  summary.id = "metro-store-summary";
  const provenCount = METRO_MOSCOW_REGION_STORES.filter(
    (store) => store.onlinePickupStatus === "proven"
  ).length;
  const unavailableCount = METRO_MOSCOW_REGION_STORES.length - provenCount;
  summary.textContent = `${METRO_MOSCOW_REGION_STORES.length} адреса в официальном справочнике · ${provenCount} с подтверждённым online pickup · ${unavailableCount} без публичной online-точки`;

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Город, улица или номер дома";
  search.setAttribute("aria-label", "Найти адрес METRO");
  Object.assign(search.style, { width: "100%", minHeight: "44px", boxSizing: "border-box" });

  const select = document.createElement("select");
  select.id = "metro-store-address";
  select.setAttribute("aria-label", "Адрес METRO");
  Object.assign(select.style, { width: "100%", minHeight: "44px", boxSizing: "border-box" });

  const note = document.createElement("p");
  note.id = "metro-store-note";
  note.setAttribute("role", "status");

  let selectedNumber = String(storeNumber ?? "10");

  function renderOptions() {
    const terms = normalized(search.value).trim().split(/\s+/u).filter(Boolean);
    select.replaceChildren();

    for (const store of METRO_MOSCOW_REGION_STORES) {
      const selected = store.storeNumber === selectedNumber;
      if (
        !selected
        && !terms.every((term) => normalized(searchableText(store)).includes(term))
      ) {
        continue;
      }

      const option = document.createElement("option");
      option.value = store.storeNumber;
      const scope = store.scope === "moscow-city" ? "Москва" : "МО";
      const suffix = store.onlinePickupStatus === "proven"
        ? "— online-цена подтверждена"
        : "— online pickup сейчас недоступен";
      option.textContent = `№${store.storeNumber} · ${scope} · ${store.address} ${suffix}`;
      option.disabled = store.onlinePickupStatus !== "proven";
      option.selected = selected;
      select.append(option);
    }
  }

  search.addEventListener("input", renderOptions);
  select.addEventListener("change", () => {
    const store = resolveMetroMoscowRegionStore({ storeNumber: select.value });
    if (store?.onlinePickupStatus === "proven" && store.bindingId) {
      onSelect(store);
    }
  });

  section.append(label, summary, search, select, note);
  renderOptions();

  return {
    element: section,
    update({ visible, store, status, hasCategories }) {
      section.hidden = !visible;
      section.style.display = visible ? "grid" : "none";

      if (store && selectedNumber !== store.storeNumber) {
        selectedNumber = store.storeNumber;
        search.value = "";
        renderOptions();
      }

      if (!visible || !store) return;

      if (store.onlinePickupStatus !== "proven") {
        note.textContent = "Адрес есть в официальном справочнике METRO, но текущий публичный online pickup его не показывает. Цены не подставляем.";
        return;
      }

      note.textContent = status === "loading"
        ? "Загружаем цены выбранного адреса…"
        : status === "ready" && !hasCategories
          ? "Адрес подтверждён, но каталог по нему пока не загружен."
          : "Показаны только цены, доказанные для выбранного адреса. Наличие неизвестно.";
    }
  };
}
