const DEFAULT_STORAGE_KEY = "checkni.surface.basket.v1";
export const MAX_QUANTITY = 99;

function clampQuantity(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(MAX_QUANTITY, Math.max(1, parsed));
}

function normalizeStoredItem(item) {
  if (!item || typeof item !== "object") return null;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  if (item.id !== item.id.trim()) return null;
  if (typeof item.name !== "string" || !item.name.trim()) return null;
  if (typeof item.unit !== "string" || !item.unit.trim()) return null;
  if (
    typeof item.quantity !== "number" ||
    !Number.isInteger(item.quantity) ||
    item.quantity < 1 ||
    item.quantity > MAX_QUANTITY
  ) {
    return null;
  }

  return {
    id: item.id,
    name: item.name.trim(),
    unit: item.unit.trim(),
    quantity: item.quantity
  };
}

function normalizeStoredBasket(items) {
  const byId = new Map();
  const rejectedIds = new Set();

  for (const item of items) {
    const normalized = normalizeStoredItem(item);
    if (!normalized || rejectedIds.has(normalized.id)) continue;

    const existing = byId.get(normalized.id);
    if (existing) {
      const metadataConflicts =
        existing.name !== normalized.name ||
        existing.unit !== normalized.unit;

      if (metadataConflicts) {
        byId.delete(normalized.id);
        rejectedIds.add(normalized.id);
        continue;
      }

      existing.quantity = clampQuantity(existing.quantity + normalized.quantity);
      continue;
    }

    byId.set(normalized.id, normalized);
  }

  return Array.from(byId.values());
}

function resolveStorage(explicitStorage) {
  if (explicitStorage !== undefined) return explicitStorage;

  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function safeRead(storage, key) {
  if (!storage) return [];

  try {
    const raw = storage.getItem(key);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return normalizeStoredBasket(parsed);
  } catch {
    return [];
  }
}

function safeWrite(storage, key, items) {
  if (!storage) return;

  try {
    storage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
    // The in-memory basket must remain usable even when persistence fails.
  }
}

export function createBasketStore(options = {}) {
  const storage = resolveStorage(options.storage);
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  let items = safeRead(storage, storageKey);
  const listeners = new Set();

  const getSnapshot = () => items.map((item) => ({ ...item }));

  const notify = () => {
    safeWrite(storage, storageKey, items);
    const snapshot = getSnapshot();
    listeners.forEach((listener) => listener(snapshot));
  };

  const add = (product) => {
    const normalized = normalizeStoredItem({ ...product, quantity: 1 });
    if (!normalized) return getSnapshot();

    const existing = items.find((item) => item.id === normalized.id);
    if (existing) {
      if (existing.quantity >= MAX_QUANTITY) return getSnapshot();

      existing.name = normalized.name;
      existing.unit = normalized.unit;
      existing.quantity = clampQuantity(existing.quantity + 1);
    } else {
      items = [...items, normalized];
    }

    notify();
    return getSnapshot();
  };

  const setQuantity = (id, quantity) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return getSnapshot();

    const nextQuantity = clampQuantity(quantity);
    if (item.quantity === nextQuantity) return getSnapshot();

    item.quantity = nextQuantity;
    notify();
    return getSnapshot();
  };

  const increment = (id) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return getSnapshot();
    return setQuantity(id, item.quantity + 1);
  };

  const decrement = (id) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return getSnapshot();
    return setQuantity(id, item.quantity - 1);
  };

  const remove = (id) => {
    const nextItems = items.filter((item) => item.id !== id);
    if (nextItems.length === items.length) return getSnapshot();

    items = nextItems;
    notify();
    return getSnapshot();
  };

  const clear = () => {
    if (items.length === 0) return getSnapshot();
    items = [];
    notify();
    return getSnapshot();
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    getSnapshot,
    add,
    setQuantity,
    increment,
    decrement,
    remove,
    clear,
    subscribe
  };
}

export function countBasketUnits(items) {
  return items.reduce((total, item) => total + clampQuantity(item.quantity), 0);
}
