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

  const legacyRetailerId = product.catalogSource === "globus"
    ? "globus"
    : null;
  const retailObservation = (
    product.catalogDisplayOnly === true
    && (
      (
        typeof product.retailerId === "string"
        && product.retailerId
      )
      || legacyRetailerId
    )
  );
  const visual = document.createElement("div");
  visual.className = retailObservation
    ? "product-visual retail-photo-fallback"
    : "product-visual";
  visual.setAttribute("aria-hidden", "true");
  if (retailObservation) {
    visual.textContent = "Фото товара";
  } else {
    visual.innerHTML = categoryPixelIcon(product.category);
    visual.dataset.fallback = initials(product.name);
  }

  // Retail rows already contain a verified official image URL. Start that
  // request synchronously so real catalogue cards do not briefly become
  // pixel placeholders or lose the request before insertion into the DOM.
  function attachPhoto(photoUrl) {
    if (typeof photoUrl !== "string" || !photoUrl) return;

    const image = document.createElement("img");
    image.className = "product-photo";
    image.alt = "";
    image.loading = retailObservation ? "eager" : "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.title = retailObservation
      ? `Фото: официальный каталог ${product.retailerDisplayName ?? product.storeName ?? "магазина"}`
      : product.catalogSource === "open-food-facts"
        ? "Фото: Open Food Facts"
        : "Фото: Open Food Facts · пример похожего товара";
    image.addEventListener("error", () => image.remove());
    image.addEventListener("load", () => {
      // The card can still be detached while a very fast/cached image
      // completes. Updating the detached visual is intentional: when the
      // caller inserts the card a moment later, the real photo is already
      // there instead of the pixel placeholder.
      visual.replaceChildren(image);
      visual.classList.add("has-photo");
    });
    image.src = photoUrl;
  }

  if (typeof product?.imageUrl === "string" && product.imageUrl) {
    attachPhoto(product.imageUrl);
  } else if (typeof loadPhoto === "function") {
    Promise.resolve()
      .then(() => loadPhoto(product))
      .then(attachPhoto)
      .catch(() => {});
  }

  const body = document.createElement("div");
  body.className = "product-body";

  const meta = document.createElement("div");
  meta.className = "product-meta";

  const badge = document.createElement("span");
  badge.className = "mock-chip";
  const retailerDisplayName = product.retailerDisplayName
    ?? (legacyRetailerId === "globus" ? "Глобус" : "Магазин");
  badge.textContent = retailObservation
    ? `${retailerDisplayName} · цена наблюдалась`
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
    if (
      typeof product.priceConditionLabel === "string"
      && product.priceConditionLabel
    ) {
      const condition = document.createElement("span");
      condition.className = "product-price-unit";
      condition.textContent = ` · ${product.priceConditionLabel}`;
      price.append(condition);
      price.title = `Наблюдаемая цена ${product.priceConditionLabel}; наличие не подтверждено`;
    }
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
    retailObservation
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
    source.textContent = `${product.storeName ?? product.retailerDisplayName ?? "Магазин"} · источник · ${observedLabel}`;
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
