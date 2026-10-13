// Request success is not commercial comparison success. Only Core's
// conclusion determines what the live-example notification may claim.
export function comparisonFeedback(state) {
  if (state?.status === "error") return "Не удалось проверить цены. Попробуйте позже.";
  if (state?.status !== "success") return "Сравнение не завершено.";

  switch (state.result?.conclusion?.kind) {
    case "cheapest-proven": return "Сравнение готово";
    case "lowest-tie": return "Подтверждены одинаковые суммы корзины";
    case "observed-total-only": return "Сумма подтверждена; сравнения с другими магазинами пока нет";
    case "insufficient-coverage": return "Для сравнения не хватает сопоставимых подтверждённых цен";
    default: return "Сравнение не завершено.";
  }
}
