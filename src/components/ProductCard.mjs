import { MAX_QUANTITY } from "../state/basketStore.mjs";
import { categoryPixelIcon } from "./pixelIcons.mjs";
import { formatRubMinor } from "./ComparisonResult.mjs";
import { formatPerUnit, priceHintTitle } from "../runtime/priceHints.mjs";
import { focusByKey, productAddFocusKey } from "../runtime/focusRecovery.mjs";

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("ru-RU");
}

export function isAddLimitReached(quantity) {
  return Number.isFinite(quantity) && quantity >= MAX_QUANTITY;
}

export function createProductCard(product, {
  quantity = 0,
  onAdd,
  priceHint = null,
  loadPhoto = null
}) {
  const article = document.createElement("article");
  article.className = "product-card";
  article.dataset.productId = product.id;

  const visual = document.createElement("div");
  visual.className = "product-visual";
  visual.setAttribute("aria-hidden", "true");
  visual.innerHTML = categoryPixelIcon(product.category);
  visual.dataset.fallback = initials(product.name);

  // Real photo from Open Food Facts, when one resolves. Decoration only:
  // the pixel icon stays until then, and any failure leaves it in place.
  if (typeof loadPhoto === "function") {
    Promise.resolve()
      .then(() => loadPhoto(product))
      .then((photoUrl) => {
        if (typeof photoUrl !== "string" || !photoUrl || !article.isConnected) {
          return;
        }
        const image = document.createElement("img");
        image.className = "product-photo";
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.src = photoUrl;
        image.title = product.catalogSource === "globus"
          ? "Фото: официальный каталог Глобус"
          : product.catalogSource === "open-food-facts"
            ? "Фото: Open Food Facts"
            : "Фото: Open Food Facts · пример похожего товара";
        image.addEventListener("error", () => image.remove());
        image.addEventListener("load", () => {
          visual.replaceChildren(image);
          visual.classList.add("has-photo");
        });
      })
      .catch(() => {});
  }

  const body = document.createElement("div");
  body.className = "product-body";

  const meta = document.createElement("div");
  meta.className = "product-meta";

  const badge = document.createElement("span");
  badge.className = "mock-chip";
  badge.textContent = product.catalogSource === "globus"
    ? "Глобус · цена наблюдалась"
    : product.catalogSource === "open-food-facts"
      ? "Каталог · не наличие"
      : "Тестовый товар";

  const category = document.createElement("span");
  category.className = "product-category";
  category.textContent = typeof product.category === "string" && product.category.trim()
    ? product.category.trim()
    : "Товар";

  meta.append(badge, category);

  const heading = document.createElement("h3");
  heading.textContent = product.name;

  const unit = document.createElement("p");
  unit.className = "product-unit";
  unit.textContent = product.unit;

  let price = null;
  if (Number.isSafeInteger(product.priceMinor) && product.priceMinor > 0) {
    price = document.createElement("p");
    price.className = "product-price";
    price.title = "Наблюдаемая цена; наличие не подтверждено";
    const amount = document.createElement("strong");
    amount.textContent = formatRubMinor(product.priceMinor);
    price.append(amount);
  } else if (priceHint) {
    price = document.createElement("p");
    price.className = "product-price";
    price.title = priceHintTitle(priceHint);
    const amount = document.createElement("strong");
    amount.textContent = `от ${formatRubMinor(priceHint.minMinor)}`;
    const perUnit = document.createElement("span");
    perUnit.className = "product-price-unit";
    perUnit.textContent = ` · ${formatPerUnit(priceHint)}`;
    price.append(amount, perUnit);
  }

  let source = null;
  if (
    product.catalogSource === "globus"
    && typeof product.sourceUrl === "string"
    && typeof product.observedAt === "string"
  ) {
    source = document.createElement("a");
    source.className = "product-unit";
    source.href = product.sourceUrl;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    const observed = new Date(product.observedAt);
    const observedLabel = Number.isFinite(observed.getTime())
      ? observed.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "время неизвестно";
    source.textContent = `${product.storeName ?? "Глобус"} · источник · ${observedLabel}`;
  }

  const button = document.createElement("button");
  const focusKey = productAddFocusKey(product.id);
  const displayOnly = product.catalogDisplayOnly === true;
  const atLimit = isAddLimitReached(quantity);

  button.className = quantity > 0 ? "add-button is-added" : "add-button";
  button.type = "button";
  button.dataset.focusKey = focusKey;
  button.textContent = displayOnly
    ? "Сопоставление для сравнения ещё не подтверждено"
    : atLimit
      ? `Максимум · ${MAX_QUANTITY} в корзине`
      : quantity > 0
        ? `Добавить ещё · ${quantity} в корзине`
        : "Добавить";

  if (displayOnly) {
    button.disabled = true;
    button.setAttribute("aria-label", `${product.name}: пока только просмотр`);
  } else if (atLimit) {
    button.setAttribute("aria-disabled", "true");
    button.setAttribute(
      "aria-label",
      `${product.name}, максимум ${MAX_QUANTITY} в корзине`
    );
  } else {
    button.setAttribute(
      "aria-label",
      `Добавить ${product.name}, ${product.unit}, в корзину`
    );
  }

  button.addEventListener("click", () => {
    if (displayOnly || atLimit) return;

    onAdd(product);
    focusByKey(document, focusKey);
  });

  body.append(meta, heading, unit);
  if (price) body.append(price);
  if (source) body.append(source);
  body.append(button);
  article.append(visual, body);

  return article;
}
