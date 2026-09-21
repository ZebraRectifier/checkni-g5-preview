export function focusByKey(root, key) {
  if (!root || typeof root.querySelectorAll !== "function" || !key) return false;

  const target = Array.from(root.querySelectorAll("[data-focus-key]"))
    .find((node) => node?.dataset?.focusKey === key);

  if (
    !target ||
    target.disabled === true ||
    typeof target.focus !== "function"
  ) {
    return false;
  }

  target.focus({ preventScroll: true });
  return true;
}

export function productAddFocusKey(productId) {
  return `product-add:${productId}`;
}

export function basketControlFocusKey(action, productId) {
  return `basket-${action}:${productId}`;
}
