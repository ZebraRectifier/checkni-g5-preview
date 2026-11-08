export function createSelectedComparisonStores(scope, { onEdit } = {}) {
  if (!scope?.valid || scope.stores.length === 0) return null;
  const section = document.createElement("section");
  section.className = "future-step basket-addresses";
  section.setAttribute("aria-label", "Адреса для сравнения");
  const heading = document.createElement("h2");
  heading.textContent = scope.mode === "live-example" ? "Адреса примера" : "Адреса для сравнения";
  const list = document.createElement("ul");
  list.className = "basket-address-list";
  for (const store of scope.stores) {
    const row = document.createElement("li");
    row.className = "basket-address-card";
    const info = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = store.name;
    const address = document.createElement("p");
    address.textContent = store.address;
    info.append(name, address);
    row.append(info);
    if (typeof onEdit === "function") {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary-button basket-address-edit";
      edit.textContent = "Изменить";
      edit.setAttribute("aria-label", `Изменить адрес ${store.name}`);
      edit.addEventListener("click", () => onEdit(store.retailerId));
      row.append(edit);
    }
    list.append(row);
  }
  const note = document.createElement("p");
  note.className = "basket-address-note";
  note.textContent = scope.mode === "live-example"
    ? "Это адреса примера. Цены для этих магазинов проверяем отдельно."
    : "Проверь адреса. Для этих магазинов ещё может не хватать свежих цен.";
  section.append(heading, note, list);
  return section;
}
