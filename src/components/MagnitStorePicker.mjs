import { MAGNIT_MOSCOW_STORES, resolveMagnitMoscowStore } from "../data/magnitMoscowStores.mjs";

const normalized = (text) => text.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е");

export function createMagnitStorePicker({ shopCode, onSelect }) {
  const section = document.createElement("section");
  section.id = "magnit-store-picker";
  section.setAttribute("aria-label", "Выбор адреса Магнита");
  Object.assign(section.style, { marginBlock: "16px", display: "grid", gap: "8px" });

  const label = document.createElement("label");
  label.htmlFor = "magnit-store-address";
  label.textContent = "Адрес Магнита в Москве";

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Улица или номер дома";
  search.setAttribute("aria-label", "Найти адрес Магнита");
  Object.assign(search.style, { width: "100%", minHeight: "44px", boxSizing: "border-box" });

  const select = document.createElement("select");
  select.id = "magnit-store-address";
  Object.assign(select.style, { width: "100%", minHeight: "44px", boxSizing: "border-box" });
  const note = document.createElement("p");
  note.id = "magnit-store-note";
  note.setAttribute("role", "status");

  let selectedCode = shopCode;
  function renderOptions() {
    const terms = normalized(search.value).trim().split(/\s+/u).filter(Boolean);
    select.replaceChildren();
    for (const [index, store] of MAGNIT_MOSCOW_STORES.entries()) {
      if (store.shopCode !== selectedCode && !terms.every(term => normalized(store.address).includes(term))) continue;
      const option = document.createElement("option");
      option.value = store.shopCode ?? "unresolved-" + index;
      option.textContent = store.address + (store.shopCode ? "" : " — цены пока недоступны");
      option.disabled = !store.shopCode;
      option.selected = store.shopCode === selectedCode;
      select.append(option);
    }
  }
  search.addEventListener("input", renderOptions);
  select.addEventListener("change", () => {
    const store = resolveMagnitMoscowStore({ shopCode: select.value });
    if (store) onSelect(store);
  });
  section.append(label, search, select, note);
  renderOptions();
  return {
    element: section,
    update({ visible, store, status, hasCategories }) {
      section.hidden = !visible;
      // Inline display must also respect the hidden state.
      section.style.display = visible ? "grid" : "none";
      if (selectedCode !== store.shopCode) {
        selectedCode = store.shopCode;
        search.value = "";
        renderOptions();
      }
      note.textContent = status === "loading"
        ? "Загружаем каталог выбранного адреса…"
        : status === "ready" && !hasCategories
          ? "Каталог по этому адресу ещё не загружен."
          : "Показаны собранные цены сайта для этого адреса. Наличие неизвестно.";
    }
  };
}
