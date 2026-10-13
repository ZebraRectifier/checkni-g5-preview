export function createSelectedComparisonStores(scope, { onEdit } = {}) {
  if (!scope?.valid || scope.stores.length === 0) return null;
  const section = document.createElement("section");
  section.className = "future-step";
  section.setAttribute("aria-label", "Адреса для сравнения");
  const heading = document.createElement("h2");
  heading.textContent = scope.mode === "live-example" ? "Точки живого примера" : "Выбранные адреса для сравнения";
  const list = document.createElement("ul");
  for (const store of scope.stores) {
    const row = document.createElement("li");
    const label = document.createElement("p");
    label.textContent = `${store.name} · ${store.address}`;
    row.append(label);
    if (typeof onEdit === "function") {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = `Изменить адрес ${store.name}`;
      edit.addEventListener("click", () => onEdit(store.retailerId));
      row.append(edit);
    }
    list.append(row);
  }
  const note = document.createElement("p");
  note.textContent = "Расчёт относится к этим точкам. Для сравнения нужны свежие цены одинаковых товаров; для выбранного адреса они могут быть ещё не подтверждены.";
  section.append(heading, list, note);
  return section;
}
