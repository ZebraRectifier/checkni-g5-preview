import { OKEY_STORE_DIRECTORY } from "../data/okeyStoreDirectory.mjs";

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

export function createOkeyStoreDirectory() {
  const section = document.createElement("section");
  section.className = "okey-directory";
  section.setAttribute("aria-label", "Адреса О’КЕЙ в Москве и Московской области");

  const details = document.createElement("details");
  details.open = false;
  const summary = document.createElement("summary");
  summary.append(
    element("strong", null, "О’КЕЙ · адреса магазинов"),
    element("span", null, "8 в Москве · 3 в области из справочника")
  );
  details.append(summary);
  details.append(element(
    "p", "okey-directory-note",
    "Цена с О’КАРТОЙ и без карты для каждой точки пока неизвестна. " +
      "Городские акции не подтверждают цену в выбранном магазине. " +
      "Показаны адреса из выбора «Москва» на сайте сети; перечень области может быть неполным."
  ));

  for (const region of ["Москва", "Московская область"]) {
    const stores = OKEY_STORE_DIRECTORY.filter((store) => store.region === region);
    details.append(element("h3", null, `${region} · ${stores.length}`));
    const list = document.createElement("ul");
    for (const store of stores) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = store.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = store.name;
      item.append(link, element("span", null, store.address));
      list.append(item);
    }
    details.append(list);
  }
  const source = document.createElement("a");
  source.href = "https://www.okmarket.ru/stores/moskva/";
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.textContent = "Официальный справочник О’КЕЙ";
  details.append(source);
  section.append(details);
  return section;
}
