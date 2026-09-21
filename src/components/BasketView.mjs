import { MAX_QUANTITY } from "../state/basketStore.mjs";
import {
  basketControlFocusKey,
  focusByKey
} from "../runtime/focusRecovery.mjs";

function pluralizeProducts(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "позиции";
  return "позиций";
}

export function renderBasketView(container, items, actions) {
  container.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "basket-empty";
    empty.innerHTML = `
      <div class="empty-icon" aria-hidden="true">＋</div>
      <h2>Корзина пока пустая</h2>
      <p>Вернитесь к товарам и добавьте то, что собираетесь купить.</p>
    `;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary-button";
    button.textContent = "Найти товар";
    button.addEventListener("click", actions.onBackToShop);
    empty.append(button);
    container.append(empty);
    return;
  }

  const summary = document.createElement("div");
  summary.className = "basket-summary";
  summary.innerHTML = `
    <span>${items.length} ${pluralizeProducts(items.length)}</span>
    <span class="mock-chip">Тестовые цены · MOCK</span>
  `;

  const list = document.createElement("div");
  list.className = "basket-list";

  items.forEach((item, index) => {
    const row = document.createElement("article");
    row.className = "basket-row";

    const info = document.createElement("div");
    info.className = "basket-item-info";
    const title = document.createElement("h2");
    title.textContent = item.name;
    const unit = document.createElement("p");
    unit.textContent = item.unit;
    info.append(title, unit);

    const controls = document.createElement("div");
    controls.className = "basket-item-actions";

    const stepper = document.createElement("div");
    stepper.className = "stepper";
    stepper.setAttribute("role", "group");
    stepper.setAttribute("aria-label", `Количество: ${item.name}`);

    const minus = document.createElement("button");
    const minusFocusKey = basketControlFocusKey("minus", item.id);
    minus.type = "button";
    minus.className = "stepper-button";
    minus.dataset.focusKey = minusFocusKey;
    minus.textContent = "−";
    minus.disabled = item.quantity <= 1;
    minus.setAttribute("aria-label", `Уменьшить количество ${item.name}`);
    minus.addEventListener("click", () => {
      actions.onDecrement(item.id);
      if (!focusByKey(document, minusFocusKey)) {
        focusByKey(document, basketControlFocusKey("plus", item.id));
      }
    });

    const quantity = document.createElement("output");
    quantity.className = "stepper-value";
    quantity.value = String(item.quantity);
    quantity.textContent = String(item.quantity);
    quantity.setAttribute("aria-label", `Количество: ${item.quantity}`);
    quantity.setAttribute("aria-live", "polite");

    const plus = document.createElement("button");
    const plusFocusKey = basketControlFocusKey("plus", item.id);
    plus.type = "button";
    plus.className = "stepper-button";
    plus.dataset.focusKey = plusFocusKey;
    plus.textContent = "+";
    plus.disabled = item.quantity >= MAX_QUANTITY;
    plus.setAttribute("aria-label", `Увеличить количество ${item.name}`);
    plus.addEventListener("click", () => {
      actions.onIncrement(item.id);
      if (!focusByKey(document, plusFocusKey)) {
        focusByKey(document, basketControlFocusKey("minus", item.id));
      }
    });

    stepper.append(minus, quantity, plus);

    const remove = document.createElement("button");
    const removeFocusKey = basketControlFocusKey("remove", item.id);
    const nextItem = items[index + 1] ?? items[index - 1] ?? null;
    remove.type = "button";
    remove.className = "remove-button";
    remove.dataset.focusKey = removeFocusKey;
    remove.textContent = "Удалить";
    remove.setAttribute("aria-label", `Удалить ${item.name} из корзины`);
    remove.addEventListener("click", () => {
      actions.onRemove(item.id);

      if (nextItem) {
        focusByKey(document, basketControlFocusKey("remove", nextItem.id));
      } else {
        document.querySelector("#basket-title")?.focus({ preventScroll: true });
      }
    });

    controls.append(stepper, remove);
    row.append(info, controls);
    list.append(row);
  });

  const compareStep = document.createElement("section");
  compareStep.className = "future-step comparison-step";
  compareStep.setAttribute("aria-labelledby", "compare-title");

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Сравнение";

  const heading = document.createElement("h2");
  heading.id = "compare-title";
  heading.textContent = "Где корзина дешевле?";

  const help = document.createElement("p");
  help.id = "compare-help";
  help.textContent = "Сравним эту же корзину по трём демонстрационным магазинам. Все цены и наличие здесь тестовые.";

  const compareButton = document.createElement("button");
  compareButton.id = "compare-basket";
  compareButton.type = "button";
  compareButton.className = "primary-button";
  compareButton.textContent = "Сравнить магазины";
  compareButton.setAttribute("aria-describedby", "compare-help");
  compareButton.addEventListener("click", actions.onCompare);

  compareStep.append(eyebrow, heading, help, compareButton);

  const comparisonOutput = document.createElement("div");
  comparisonOutput.id = "comparison-output";
  comparisonOutput.className = "comparison-output";
  comparisonOutput.setAttribute("aria-live", "polite");
  comparisonOutput.setAttribute("aria-atomic", "true");

  container.append(summary, list, compareStep, comparisonOutput);
}
