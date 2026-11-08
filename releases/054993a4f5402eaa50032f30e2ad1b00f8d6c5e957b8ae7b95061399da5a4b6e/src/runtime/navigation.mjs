export const VIEW = Object.freeze({
  SHOP: "shop",
  BASKET: "basket"
});

export const FOCUS_MODE = Object.freeze({
  NONE: "none",
  INTERACTIVE: "interactive",
  HEADING: "heading"
});

function normalizeScrollY(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function viewFromHash(hash) {
  return hash === "#basket" ? VIEW.BASKET : VIEW.SHOP;
}

export function hashForView(view) {
  return view === VIEW.BASKET ? "#basket" : "#shop";
}

export function createRouteState(view, fromView = null, scrollY = 0) {
  return {
    checkniSurfaceView: view,
    checkniSurfaceFrom: fromView,
    checkniSurfaceScrollY: normalizeScrollY(scrollY)
  };
}

export function scrollYFromState(state) {
  return normalizeScrollY(state?.checkniSurfaceScrollY);
}

export function shouldUseHistoryBack(currentView, state) {
  return (
    currentView === VIEW.BASKET &&
    state?.checkniSurfaceView === VIEW.BASKET &&
    state?.checkniSurfaceFrom === VIEW.SHOP
  );
}

export function focusTargetId(view, mode) {
  if (mode === FOCUS_MODE.HEADING) {
    return view === VIEW.BASKET ? "basket-title" : "shop-title";
  }

  if (mode === FOCUS_MODE.INTERACTIVE) {
    return view === VIEW.BASKET ? "back-to-shop" : "product-search";
  }

  return null;
}
