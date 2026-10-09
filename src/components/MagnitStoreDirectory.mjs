import { MAGNIT_MOSCOW_STORES } from "../data/magnitMoscowStores.mjs";
import { MAGNIT_MOSCOW_OBLAST_STORES } from "../data/magnitMoscowOblastStores.mjs";

import { createRetailCatalogClient } from "../ports/retailCatalogPort.mjs";
import { MAGNIT_MOSCOW_OBLAST_BINDINGS } from "../data/magnitMoscowOblastBindings.mjs";

export const MAGNIT_DIRECTORY_PAGE_SIZE = 60;

export const MAGNIT_STORE_DIRECTORY = Object.freeze([
  ...MAGNIT_MOSCOW_STORES.map((store) => Object.freeze({
    shopCode: store.shopCode,
    type: store.type,
    region: "Москва",
    address: store.address,
    sourceUrl: store.sourceUrl,
    observedAt: store.observedAt
  })),
  ...MAGNIT_MOSCOW_OBLAST_STORES.map(store => Object.freeze({
    ...store,
    shopCode: MAGNIT_MOSCOW_OBLAST_BINDINGS.find(binding => binding.address === store.address)?.shopCode ?? null
  }))
]);

export const MAGNIT_STORE_DIRECTORY_COUNTS = Object.freeze({
  moscow: MAGNIT_MOSCOW_STORES.length,
  oblast: MAGNIT_MOSCOW_OBLAST_STORES.length,
  total: MAGNIT_MOSCOW_STORES.length + MAGNIT_MOSCOW_OBLAST_STORES.length
});

function normalized(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

export function filterMagnitStoreDirectory({
  query = "",
  region = "all"
} = {}) {
  const needle = normalized(query);
  return MAGNIT_STORE_DIRECTORY.filter((store) => {
    if (region === "moscow" && store.region !== "Москва") return false;
    if (region === "oblast" && store.region !== "Московская область") return false;
    if (!needle) return true;
    return normalized(store.address + " " + store.type + " " + store.region)
      .includes(needle);
  });
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

export function createMagnitStoreDirectory() {
  const section = document.createElement("section");
  section.id = "magnit-directory";
  section.className = "magnit-directory";
  section.setAttribute(
    "aria-label",
    "Адреса магазинов Магнит в Москве и Московской области"
  );

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.append(
    element("strong", null, "Магнит · адреса магазинов"),
    element(
      "span",
      null,
      `${MAGNIT_STORE_DIRECTORY_COUNTS.moscow} в Москве · `
        + `${MAGNIT_STORE_DIRECTORY_COUNTS.oblast} в области`
    )
  );
  details.append(summary);

  details.append(element(
    "p",
    "magnit-directory-note",
    "Официальный справочник адресов Магнита. Наличие и цена по каждому адресу "
      + "не подтверждены этим списком."
  ));

  const controls = document.createElement("div");
  controls.className = "magnit-directory-controls";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "magnit-directory-search";
  search.placeholder = "Город, улица или район";
  search.autocomplete = "off";
  search.setAttribute("aria-label", "Найти адрес Магнита");

  const region = document.createElement("select");
  region.className = "magnit-directory-region";
  region.setAttribute("aria-label", "Регион Магнита");
  for (const [value, label] of [
    ["all", "Москва + область"],
    ["moscow", "Москва"],
    ["oblast", "Московская область"]
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    region.append(option);
  }

  controls.append(search, region);
  details.append(controls);

  const status = element("p", "magnit-directory-status", "");
  status.setAttribute("aria-live", "polite");
  details.append(status);

  const list = document.createElement("ul");
  list.className = "magnit-directory-list";
  details.append(list);

  const more = document.createElement("button");
  more.type = "button";
  more.className = "magnit-directory-more";
  more.textContent = "Показать ещё";
  more.hidden = true;
  details.append(more);

  const source = document.createElement("a");
  source.className = "magnit-directory-source";
  source.href = "https://magnit.ru/shops";
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.textContent = "Официальный справочник Магнита";
  details.append(source);

  let visibleCount = MAGNIT_DIRECTORY_PAGE_SIZE;
  let rendered = false;

  function render({ reset = false } = {}) {
    if (reset) visibleCount = MAGNIT_DIRECTORY_PAGE_SIZE;
    const matches = filterMagnitStoreDirectory({
      query: search.value,
      region: region.value
    });
    const visible = matches.slice(0, visibleCount);

    list.replaceChildren();
    for (const store of visible) {
      const item = document.createElement("li");
      item.append(
        element("strong", null, store.type || "Магнит"),
        element("span", null, store.address)
      );
      item.append(createAddressPrices(store));
      list.append(item);
    }

    status.textContent = matches.length === 0
      ? "Ничего не найдено"
      : `Найдено ${matches.length} · показано ${visible.length}`;

    more.hidden = visible.length >= matches.length;
    rendered = true;
  }

  search.addEventListener("input", () => render({ reset: true }));
  region.addEventListener("change", () => render({ reset: true }));
  more.addEventListener("click", () => {
    visibleCount += MAGNIT_DIRECTORY_PAGE_SIZE;
    render();
  });
  details.addEventListener("toggle", () => {
    if (details.open && !rendered) render();
  });

  section.append(details);
  return section;
}

function createAddressPrices(store) {
  if (!store.shopCode) return element("span", null, "Цены пока не подтверждены");
  const details = document.createElement("details");
  details.className = "magnit-address-prices";
  details.append(element("summary", null, "Посмотреть цены"));
  const status = element("p", null, "");
  status.setAttribute("aria-live", "polite");
  const list = document.createElement("ul");
  const more = element("button", null, "Ещё цены");
  more.type = "button";
  more.hidden = true;
  details.append(status, list, more);
  const client = createRetailCatalogClient({retailerId:"magnit",store:{shopCode:store.shopCode,address:store.address}});
  let loaded = false;
  let loading = false;
  let offset = 0;
  const rubles = new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB"});
  async function load() {
    if (loading) return;
    loading = true;
    more.disabled = true;
    status.textContent = "Загружаю цены…";
    const result = await client.browse({limit:12,offset});
    loading = false;
    more.disabled = false;
    if (result.kind !== "catalog") {
      status.textContent = "Не удалось загрузить цены. Попробуйте ещё раз.";
      more.hidden = false;
      more.textContent = "Повторить";
      return;
    }
    loaded = true;
    for (const product of result.products) {
      const row = document.createElement("li");
      const source = element("a", null, product.name);
      source.href = product.productUrl;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      row.append(source, element("strong", null, rubles.format(product.priceMinor/100)),
        element("span", null, "Проверено " + new Date(product.observedAt).toLocaleDateString("ru-RU")));
      list.append(row);
    }
    offset = result.nextOffset;
    more.hidden = result.pageSize < 12;
    more.textContent = "Ещё цены";
    status.textContent = list.children.length
      ? "Публичные цены сайта. Часть товаров; наличие и условия покупки проверьте у Магнита."
      : "Подтверждённых цен по этому адресу пока нет.";
  }
  details.addEventListener("toggle",()=>{if(details.open && !loaded) void load();});
  more.addEventListener("click",()=>void load());
  return details;
}
