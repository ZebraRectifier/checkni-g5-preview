import { filterRegisteredMagnitStores, resolveRegisteredMagnitStore as resolveMagnitMoscowStore } from "../data/registeredMagnitStores.mjs";

export function createMagnitStorePicker({ shopCode, onSelect }) {
  const section = document.createElement("section");
  section.id = "magnit-store-picker";
  section.setAttribute("aria-label", "Выбор адреса Магнита");
  Object.assign(section.style, { marginBlock: "16px", display: "grid", gap: "8px" });

  const label = document.createElement("label");
  label.htmlFor = "magnit-store-address";
  label.textContent = "Адрес Магнита в Москве и Московской области";

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
    const matches = filterRegisteredMagnitStores(search.value);
    select.replaceChildren();
    // Keep selection explicit when a search filters out the current address: selecting
    // the only result must still emit change, rather than silently changing the UI.
    if (!matches.some(store => store.shopCode === selectedCode)) {
      const prompt = document.createElement("option");
      prompt.value = "";
      prompt.textContent = matches.length ? "Выберите найденный адрес" : "Адрес не найден";
      prompt.disabled = true;
      prompt.selected = true;
      select.append(prompt);
    }
    for (const [index, store] of matches.entries()) {
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
