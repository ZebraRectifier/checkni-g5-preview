import { WEB_SNAPSHOT_CONCLUSION } from "../core/web-snapshot-comparison.mjs";
import { formatRubMinor } from "./ComparisonResult.mjs";
import { shareSnapshotResult } from "./shareResult.mjs";
import { PIXEL_ICONS } from "./pixelIcons.mjs";

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
  const eyebrow = `Цены с сайтов магазинов · ${meta.observedDateLabel}`;

  let title;
  let facts = null;
  let winner = null;

  if (conclusion.kind === WEB_SNAPSHOT_CONCLUSION.CHEAPEST) {
    winner = storeById(result, conclusion.winnerId);
    const runnerUp = conclusion.runnerUpId
      ? storeById(result, conclusion.runnerUpId)
      : null;
    title = `Дешевле ${winner.nameIn}`;
    facts = runnerUp && conclusion.savingsMinor > 0
      ? `Корзина ${formatRubMinor(conclusion.totalMinor)} — на ${formatRubMinor(conclusion.savingsMinor)} дешевле, чем ${runnerUp.nameIn}`
      : `Корзина ${formatRubMinor(conclusion.totalMinor)}`;
  } else if (conclusion.kind === WEB_SNAPSHOT_CONCLUSION.TIE) {
    const names = conclusion.tiedIds
      .map((id) => storeById(result, id)?.name)
      .filter(Boolean);
    title = "Одинаково по цене";
    facts = `${names.join(" и ")}: ${formatRubMinor(conclusion.totalMinor)}`;
  } else if (conclusion.kind === WEB_SNAPSHOT_CONCLUSION.PARTIAL_ONLY) {
    title = "Цены есть не на всё";
    facts = "Ни в одном магазине не нашли цены на всю корзину, поэтому «дешевле» не называем.";
  } else {
    title = "Для этих товаров цен пока нет";
    facts = "Мы собрали цены только на базовые продукты из каталога.";
  }

  const winnerMinor = winner?.totalMinor ?? null;
  const stores = result.stores.map((store) => ({
    retailerId: store.retailerId,
    name: store.name,
    siteUrl: store.siteUrl,
    isWinner: winner?.retailerId === store.retailerId,
    diffMinor: store.complete && winnerMinor !== null
      ? store.totalMinor - winnerMinor
      : null,
    summary: store.complete
      ? formatRubMinor(store.totalMinor)
      : `цены на ${store.coveredCount} из ${store.totalCount}`,
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
    chip: "Регион не подтверждён",
    title,
    facts,
    note: REGION_NOTE,
    winner: winner ? { name: winner.name, siteUrl: winner.siteUrl } : null,
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

  if (model.winner) {
    const found = document.createElement("div");
    found.className = "horek-found";
    const icon = document.createElement("span");
    icon.className = "hf-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = PIXEL_ICONS.ferret;
    const col = document.createElement("div");
    col.append(
      textElement("div", "hf-label", "ХОРЁК НАШЁЛ"),
      textElement("div", "hf-text", model.facts)
    );
    found.append(icon, col);
    section.append(found);
  } else {
    section.append(textElement("p", "snapshot-facts", model.facts));
  }

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

  if (model.winner) {
    const share = document.createElement("button");
    share.type = "button";
    share.className = "text-button share-button";
    share.textContent = "Поделиться картинкой";
    share.addEventListener("click", async () => {
      share.disabled = true;
      try {
        const outcome = await shareSnapshotResult(model);
        share.textContent = outcome === "downloaded"
          ? "Картинка сохранена"
          : outcome === "shared"
            ? "Отправлено!"
            : "Поделиться картинкой";
      } catch {
        share.textContent = "Не получилось, попробуй ещё раз";
      } finally {
        share.disabled = false;
      }
    });
    section.append(share);

    const action = document.createElement("a");
    action.className = "primary-button";
    action.href = model.winner.siteUrl;
    action.target = "_blank";
    action.rel = "noopener noreferrer";
    action.textContent = `Открыть ${model.winner.name}`;
    action.setAttribute(
      "aria-label",
      `Открыть ${model.winner.name} — сайт магазина, откроется в новой вкладке`
    );
    section.append(action);
  }

  return section;
}
