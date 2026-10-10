import { WEB_SNAPSHOT_CONCLUSION } from "../core/web-snapshot-comparison.mjs";
import { formatRubMinor } from "./ComparisonResult.mjs";

const STORE_COLORS = Object.freeze({
  perekrestok: "#2e8b3e",
  vkusvill: "#1f9a4a",
  chizhik: "#f2b632",
  metro: "#003d7d",
  globus: "#f07800"
});

const REGION_NOTE =
  "Цены взяты с сайтов магазинов для адреса, который сайт выбирает сам. "
  + "Что это Москва, не подтверждено: в вашем магазине цена и наличие могут отличаться. "
  + "Для каждого товара взят самый дешёвый похожий вариант, цена пересчитана на размер из корзины.";

function storeById(result, retailerId) {
  return result.stores.find((store) => store.retailerId === retailerId) ?? null;
}

export function buildWebSnapshotModel(result) {
  if (!result || result.kind !== "web-snapshot-comparison") return null;

  const { conclusion, meta } = result;
  const eyebrow = `Архив цен с сайтов · ${meta.observedDateLabel}`;

  // This snapshot uses similar products, resized packages and an unconfirmed
  // default region. Its arithmetic cannot prove a purchasable basket winner,
  // even when every reference line has a price.
  const title = conclusion.kind === WEB_SNAPSHOT_CONCLUSION.NO_DATA
    ? "Для этих товаров архивных цен нет"
    : "Архивный ориентир по похожим товарам";
  const facts = conclusion.kind === WEB_SNAPSHOT_CONCLUSION.NO_DATA
    ? "В архиве есть только часть базовых продуктов."
    : "Расчёт по прежним ценам похожих товаров. Это не текущая стоимость вашей корзины; самый дешёвый магазин и экономия не подтверждены.";

  const stores = [...result.stores]
    .sort((left, right) => left.name.localeCompare(right.name, "ru"))
    .map((store) => ({
    retailerId: store.retailerId,
    name: store.name,
    siteUrl: store.siteUrl,
    isWinner: false,
    diffMinor: null,
    summary: store.complete
      ? `Ориентир: ${formatRubMinor(store.totalMinor)}`
      : `архивные цены на ${store.coveredCount} из ${store.totalCount}`,
    lines: store.lines.map((line) => (
      line.status === "priced"
        ? {
            productName: line.productName,
            quantity: line.quantity,
            itemName: line.itemName,
            priceLabel: formatRubMinor(line.lineMinor),
            detail: line.recalculated
              ? `пересчитано: ${formatRubMinor(line.unitMinor)} за размер из корзины`
              : null,
            sourceUrl: line.sourceUrl
          }
        : {
            productName: line.productName,
            quantity: line.quantity,
            itemName: null,
            priceLabel: "нет цены",
            detail: null,
            sourceUrl: null
          }
    ))
  }));

  return {
    kind: conclusion.kind,
    eyebrow,
    chip: "Архив · регион не подтверждён",
    title,
    facts,
    note: REGION_NOTE,
    referenceOnly: true,
    winner: null,
    stores
  };
}

function textElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function createStoreDetails(store) {
  const details = document.createElement("details");
  details.className = "snapshot-store";

  const dot = document.createElement("span");
  dot.className = "sn-dot";
  dot.setAttribute("aria-hidden", "true");
  dot.style.background = STORE_COLORS[store.retailerId] ?? "#5b667e";
  dot.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/><path d="M5 13v7h14v-7"/></svg>';

  const right = document.createElement("span");
  right.className = "snapshot-store-right";
  right.append(textElement("span", "snapshot-store-total", store.summary));
  if (store.diffMinor !== null && store.diffMinor !== undefined) {
    const diff = textElement(
      "em",
      store.diffMinor === 0 ? "snapshot-diff is-best" : "snapshot-diff",
      store.diffMinor === 0
        ? "Лучшая цена"
        : `+${formatRubMinor(store.diffMinor)} к лучшей`
    );
    right.append(diff);
  }

  const summary = document.createElement("summary");
  summary.append(
    dot,
    textElement("span", "snapshot-store-name", store.name),
    right
  );
  details.append(summary);

  const list = document.createElement("ul");
  list.className = "snapshot-lines";

  for (const line of store.lines) {
    const item = document.createElement("li");
    const head = textElement(
      "p",
      "snapshot-line-head",
      `${line.productName}${line.quantity > 1 ? ` ×${line.quantity}` : ""} — ${line.priceLabel}`
    );
    item.append(head);

    if (line.itemName) {
      const source = document.createElement("p");
      source.className = "snapshot-line-source";
      if (line.sourceUrl) {
        const link = document.createElement("a");
        link.href = line.sourceUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = line.itemName;
        source.append(link);
      } else {
        source.textContent = line.itemName;
      }
      if (line.detail) source.append(` · ${line.detail}`);
      item.append(source);
    }

    list.append(item);
  }

  details.append(list);
  return details;
}

export function createWebSnapshotResult(result) {
  const model = buildWebSnapshotModel(result);
  if (!model) return null;

  const section = document.createElement("section");
  section.className = "future-step comparison-result snapshot-result";
  section.setAttribute("aria-label", "Сравнение по ценам с сайтов магазинов");

  const meta = document.createElement("div");
  meta.className = "product-meta";
  meta.append(
    textElement("p", "eyebrow", model.eyebrow),
    textElement("span", "mock-chip snapshot-chip", model.chip)
  );

  section.append(meta, textElement("h2", null, model.title));

  section.append(textElement("p", "snapshot-facts", model.facts));

  if (model.stores.some((store) => store.lines.length > 0)) {
    const stores = document.createElement("div");
    stores.className = "snapshot-stores";
    for (const store of model.stores) {
      const ticket = document.createElement("div");
      ticket.className = "snapshot-ticket";
      if (store.isWinner) {
        ticket.append(textElement("div", "ticket-badge", "Самый дешёвый"));
      }
      ticket.append(createStoreDetails(store));
      stores.append(ticket);
    }
    section.append(stores);
  }

  section.append(textElement("p", "comparison-provenance", model.note));


  return section;
}
