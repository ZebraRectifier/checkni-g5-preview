import { MAX_QUANTITY } from "../state/basketStore.mjs";
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

export function createProductCard(product, { quantity = 0, onAdd }) {
  const article = document.createElement("article");
  article.className = "product-card";
  article.dataset.productId = product.id;

  const visual = document.createElement("div");
  visual.className = "product-visual";
  visual.setAttribute("aria-hidden", "true");
  visual.textContent = initials(product.name);

  const body = document.createElement("div");
  body.className = "product-body";

  const meta = document.createElement("div");
  meta.className = "product-meta";
  meta.innerHTML = `
    <span class="mock-chip">Тестовый товар</span>
    <span class="product-category">${product.category}</span>
  `;

  const heading = document.createElement("h3");
  heading.textContent = product.name;

  const unit = document.createElement("p");
  unit.className = "product-unit";
  unit.textContent = product.unit;

  const button = document.createElement("button");
  const focusKey = productAddFocusKey(product.id);
  const atLimit = isAddLimitReached(quantity);

  button.className = quantity > 0 ? "add-button is-added" : "add-button";
  button.type = "button";
  button.dataset.focusKey = focusKey;
  button.textContent = atLimit
    ? `Максимум · ${MAX_QUANTITY} в корзине`
    : quantity > 0
      ? `Добавить ещё · ${quantity} в корзине`
      : "Добавить";

  if (atLimit) {
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
    if (atLimit) return;

    onAdd(product);
    focusByKey(document, focusKey);
  });

  body.append(meta, heading, unit, button);
  article.append(visual, body);

  return article;
}
