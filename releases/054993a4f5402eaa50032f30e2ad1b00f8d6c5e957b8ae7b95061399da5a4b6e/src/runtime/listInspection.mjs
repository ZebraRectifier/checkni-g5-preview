export function revealWinningBasketList(root, storeName) {
  if (!root || typeof root.querySelector !== "function") return false;

  const list = root.querySelector(".basket-list");
  if (!list) return false;

  const normalizedStoreName =
    typeof storeName === "string" ? storeName.trim() : "";
  const label = normalizedStoreName
    ? `Список покупок для ${normalizedStoreName}`
    : "Список покупок";

  list.tabIndex = -1;
  if (typeof list.setAttribute === "function") {
    list.setAttribute("role", "region");
    list.setAttribute("aria-label", label);
  }

  if (typeof list.focus === "function") {
    list.focus({ preventScroll: true });
  }

  if (typeof list.scrollIntoView === "function") {
    list.scrollIntoView({
      block: "start",
      behavior: "auto"
    });
  }

  return true;
}
