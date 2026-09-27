import { MAX_QUANTITY, countBasketUnits } from "../state/basketStore.mjs";
import { createAggregatorChecks } from "./AggregatorChecks.mjs";
import {
  basketControlFocusKey,
  focusByKey
} from "../runtime/focusRecovery.mjs";

export const BASKET_COMPARE_LABEL = "Где дешевле?";

const REMOVE_RETARGET_WINDOW_MS = 600;
const REMOVE_RETARGET_RADIUS_PX = 24;
const removeRetargetGuards = new WeakMap();

export function createRemoveRetargetGuard({
  windowMs = REMOVE_RETARGET_WINDOW_MS,
  radiusPx = REMOVE_RETARGET_RADIUS_PX
} = {}) {
  let previous = null;

  const reset = () => {
    previous = null;
  };

  const admit = (event) => {
    const pointerActivation = Number(event?.detail) > 0;
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    const timeStamp = Number(event?.timeStamp);

    if (
      !pointerActivation
      || !Number.isFinite(clientX)
      || !Number.isFinite(clientY)
      || !Number.isFinite(timeStamp)
    ) {
      reset();
      return true;
    }

    const current = { clientX, clientY, timeStamp };

    if (previous) {
      const elapsed = current.timeStamp - previous.timeStamp;
      const distance = Math.hypot(
        current.clientX - previous.clientX,
        current.clientY - previous.clientY
      );

      if (
        elapsed >= 0
        && elapsed <= windowMs
        && distance <= radiusPx
      ) {
        previous = null;
        return false;
      }
    }

    previous = current;
    return true;
  };

  return Object.freeze({ admit, reset });
}

function removeRetargetGuardFor(container) {
  let guard = removeRetargetGuards.get(container);
  if (!guard) {
    guard = createRemoveRetargetGuard();
    removeRetargetGuards.set(container, guard);
  }
  return guard;
}

function pluralizeProducts(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "позиции";
  return "позиций";
}

export function basketSummaryText(items) {
  const units = countBasketUnits(items);
  return `${units} шт. · ${items.length} ${pluralizeProducts(items.length)}`;
}

export function renderBasketView(container, items, actions) {
  container.replaceChildren();
  const isObservedMode = actions?.comparisonMode === "observed";
  const removeRetargetGuard = removeRetargetGuardFor(container);

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
    <span>${basketSummaryText(items)}</span>
    <span class="mock-chip">${isObservedMode ? "OBSERVED · REAL" : "Тестовые цены · MOCK"}</span>
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
    remove.addEventListener("click", (event) => {
      if (!removeRetargetGuard.admit(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      remove.disabled = true;
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
  help.textContent = isObservedMode
    ? "Используем только свежие доверенные наблюдения реальных цен. Если данных недостаточно, MOCK сюда не подставляется."
    : "Сравним эту же корзину по трём демонстрационным магазинам. Все цены и наличие здесь тестовые.";

  const compareButton = document.createElement("button");
  compareButton.id = "compare-basket";
  compareButton.type = "button";
  compareButton.className = "primary-button";
  compareButton.textContent = BASKET_COMPARE_LABEL;
  compareButton.setAttribute("aria-describedby", "compare-help");
  compareButton.setAttribute("aria-busy", "false");
  compareButton.addEventListener("click", (event) => {
    if (compareButton.disabled) {
      event.preventDefault();
      return;
    }

    compareButton.disabled = true;
    compareButton.setAttribute("aria-busy", "true");
    compareButton.textContent = "Сравниваем…";
    actions.onCompare(event);
  });

  const captureLink = document.createElement("a");
  captureLink.className = "text-button";
  captureLink.href = "./prices.html";
  captureLink.textContent = isObservedMode
    ? "Добавить реальные цены"
    : "Проверить реальные цены · beta";
  captureLink.setAttribute(
    "aria-label",
    "Подтвердить свежие реальные цены для этой корзины"
  );

  compareStep.append(eyebrow, heading, help, captureLink, compareButton);

  const comparisonOutput = document.createElement("div");
  comparisonOutput.id = "comparison-output";
  comparisonOutput.className = "comparison-output";
  comparisonOutput.setAttribute("aria-live", "polite");
  comparisonOutput.setAttribute("aria-atomic", "true");

  const aggregatorChecks = createAggregatorChecks();

  container.append(summary, list, compareStep, comparisonOutput, aggregatorChecks);
}
