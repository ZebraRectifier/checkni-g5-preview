export function formatRubMinor(minor) {
  if (!Number.isSafeInteger(minor) || minor < 0) return null;

  const rubles = Math.floor(minor / 100);
  const kopeks = String(minor % 100).padStart(2, "0");

  return `${rubles.toLocaleString("ru-RU")},${kopeks} ₽`;
}

export function buildWinnerResultModel(result) {
  const winner = result?.winner;
  if (!winner) return null;

  const totalLabel = formatRubMinor(winner.totalMinor);
  if (!totalLabel) return null;

  const coverage = winner.coverage ?? {};
  const coveredItems = Number.isInteger(coverage.coveredItems)
    ? coverage.coveredItems
    : null;
  const totalItems = Number.isInteger(coverage.totalItems)
    ? coverage.totalItems
    : null;

  if (coveredItems == null || totalItems == null) return null;

  const savingsLabel = result.savingsMinor == null
    ? null
    : formatRubMinor(result.savingsMinor);

  return Object.freeze({
    storeId: winner.storeId,
    storeName: winner.storeName,
    isMock: winner.isMock === true,
    totalLabel,
    coverageLabel: `${coveredItems} из ${totalItems} позиций`,
    savingsLabel,
    actionLabel: "Показать список для этого магазина"
  });
}

export function createComparisonResult(result, { onInspectStore } = {}) {
  const model = buildWinnerResultModel(result);
  if (!model) return null;

  const section = document.createElement("section");
  section.className = "future-step comparison-result";
  section.setAttribute("aria-label", "Лучший вариант покупки");

  const meta = document.createElement("div");
  meta.className = "product-meta";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Лучший вариант";

  const mockChip = document.createElement("span");
  mockChip.className = "mock-chip";
  mockChip.textContent = model.isMock ? "DEMO · MOCK" : "CHECKNI";

  meta.append(eyebrow, mockChip);

  const heading = document.createElement("h2");
  heading.textContent = model.storeName;

  const facts = document.createElement("p");
  const factsParts = [
    `Итого ${model.totalLabel}`,
    model.coverageLabel
  ];
  if (model.savingsLabel) {
    factsParts.push(`Экономия ${model.savingsLabel}`);
  }
  facts.textContent = factsParts.join(" · ");

  const note = document.createElement("p");
  note.textContent = model.isMock
    ? "Тестовые данные. Это не подтверждённые цены или наличие конкретного магазина."
    : "Сравнение рассчитано CHECKNI.";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "primary-button";
  action.textContent = model.actionLabel;
  action.setAttribute(
    "aria-label",
    `${model.actionLabel}: ${model.storeName}`
  );
  action.addEventListener("click", () => {
    if (typeof onInspectStore === "function") {
      onInspectStore(model.storeId);
    }
  });

  section.append(meta, heading, facts, note, action);
  return section;
}
