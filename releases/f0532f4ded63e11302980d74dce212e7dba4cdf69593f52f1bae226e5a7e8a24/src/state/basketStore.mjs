const DEFAULT_STORAGE_KEY = "checkni.surface.basket.v1";
export const MAX_QUANTITY = 99;
export const VALIDATED_MERGE_REASON = Object.freeze({
  INVALID_ITEM: "invalid_item",
  DUPLICATE_ITEM: "duplicate_item",
  METADATA_CONFLICT: "metadata_conflict",
  QUANTITY_LIMIT: "quantity_limit"
});

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

function normalizeValidatedBasketItem(item) {
  if (!item || typeof item !== "object") return null;
  if (!item.product || typeof item.product !== "object") return null;

  return normalizeStoredItem({
    id: item.product.id,
    name: item.product.name,
    unit: item.product.unit,
    quantity: item.quantity
  });
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
  if (!storage) return { ok: false, reason: "unavailable" };

  let raw;
  try {
    raw = storage.getItem(key);
    if (raw === null) return { ok: true, raw, items: [] };

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false, raw, reason: "read_failed" };

    return { ok: true, raw, items: normalizeStoredBasket(parsed) };
  } catch {
    return { ok: false, raw, reason: "read_failed" };
  }
}

export function createBasketStore(options = {}) {
  const storage = resolveStorage(options.storage);
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const restored = safeRead(storage, storageKey);
  let items = restored.items ?? [];
  let lastRaw = restored.raw;
  let dirty = false;
  let persistence = restored.ok ? "saved" : restored.reason;
  const listeners = new Set();
  const copyItems = () => items.map(item => ({ ...item }));
  const signature = rows => JSON.stringify(rows.map(row => ({ id: row.id, name: row.name, unit: row.unit, quantity: row.quantity }))
    .sort((a, b) => a.id.localeCompare(b.id)));
  const emit = origin => {
    const snapshot = copyItems();
    listeners.forEach(listener => listener(snapshot, { origin }));
  };

  // Storage events may be delayed while a tab is suspended. Always read the
  // current value, never an old event payload, and reconcile before mutations.
  const refresh = () => {
    const current = safeRead(storage, storageKey);
    const previousStatus = persistence;
    if (!current.ok) {
      persistence = current.reason;
    } else if (dirty) {
      if (current.raw !== lastRaw) persistence = "conflict";
    } else {
      const changed = signature(items) !== signature(current.items);
      lastRaw = current.raw;
      items = current.items;
      persistence = "saved";
      if (changed) { emit("external"); return; }
    }
    if (persistence !== previousStatus) emit("persistence");
  };

  const getSnapshot = () => { refresh(); return copyItems(); };
  const getPersistenceStatus = () => ({ saved: persistence === "saved", reason: persistence });

  const notify = (rollbackOnConflict) => {
    const current = safeRead(storage, storageKey);
    if (current.raw !== undefined && current.raw !== lastRaw && rollbackOnConflict) {
      rollbackOnConflict();
      refresh();
      return false;
    }
    dirty = true;
    if (!storage || current.raw === undefined) {
      persistence = current.reason ?? "unavailable";
    } else if (current.raw !== lastRaw) {
      persistence = "conflict";
    } else {
      try {
        const raw = JSON.stringify(items);
        storage.setItem(storageKey, raw);
        lastRaw = raw;
        dirty = false;
        persistence = "saved";
      } catch {
        persistence = "write_failed";
      }
    }
    emit("local");
    return true;
  };

  const add = (product) => {
    refresh();
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
    refresh();
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return getSnapshot();

    const nextQuantity = clampQuantity(quantity);
    if (item.quantity === nextQuantity) return getSnapshot();

    item.quantity = nextQuantity;
    notify();
    return getSnapshot();
  };

  const increment = (id) => {
    refresh();
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return getSnapshot();
    return setQuantity(id, item.quantity + 1);
  };

  const decrement = (id) => {
    refresh();
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return getSnapshot();
    return setQuantity(id, item.quantity - 1);
  };

  const remove = (id) => {
    refresh();
    const nextItems = items.filter((item) => item.id !== id);
    if (nextItems.length === items.length) return getSnapshot();

    items = nextItems;
    notify();
    return getSnapshot();
  };

  const clear = () => {
    refresh();
    if (items.length === 0) return getSnapshot();
    items = [];
    notify();
    return getSnapshot();
  };

  const mergeValidatedBasket = (validatedItems) => {
    refresh();
    if (!Array.isArray(validatedItems) || validatedItems.length === 0) {
      return { snapshot: getSnapshot(), rejectedRows: [] };
    }

    const nextItems = items.map((item) => ({ ...item }));
    const seen = new Set();
    const rejectedRows = [];
    let changed = false;

    validatedItems.forEach((item, index) => {
      const normalized = normalizeValidatedBasketItem(item);
      const productId = typeof item?.product?.id === "string"
        ? item.product.id
        : null;

      if (!normalized) {
        rejectedRows.push({
          index,
          productId,
          reason: VALIDATED_MERGE_REASON.INVALID_ITEM
        });
        return;
      }

      if (seen.has(normalized.id)) {
        rejectedRows.push({
          index,
          productId: normalized.id,
          reason: VALIDATED_MERGE_REASON.DUPLICATE_ITEM
        });
        return;
      }
      seen.add(normalized.id);

      const existing = nextItems.find((candidate) => candidate.id === normalized.id);
      if (!existing) {
        nextItems.push(normalized);
        changed = true;
        return;
      }

      if (
        existing.name !== normalized.name
        || existing.unit !== normalized.unit
      ) {
        rejectedRows.push({
          index,
          productId: normalized.id,
          reason: VALIDATED_MERGE_REASON.METADATA_CONFLICT
        });
        return;
      }

      const quantity = existing.quantity + normalized.quantity;
      if (!Number.isSafeInteger(quantity) || quantity > MAX_QUANTITY) {
        rejectedRows.push({
          index,
          productId: normalized.id,
          reason: VALIDATED_MERGE_REASON.QUANTITY_LIMIT
        });
        return;
      }

      existing.quantity = quantity;
      changed = true;
    });

    if (changed) {
      items = nextItems;
      notify();
    }

    return {
      snapshot: getSnapshot(),
      rejectedRows
    };
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  // Compare-and-swap a reviewed full basket. All rows validate before any write.
  // Includes quantities and metadata in the lease: manual edits invalidate it.
  const replaceReviewedBasket = (expected, replacement) => {
    refresh();
    if (!Array.isArray(expected) || !Array.isArray(replacement) || expected.some(row => !normalizeStoredItem(row))) {
      return { applied: false, reason: "invalid_basket", snapshot: getSnapshot() };
    }
    if (persistence === "conflict" || signature(expected) !== signature(items)) {
      return { applied: false, reason: "stale_basket", snapshot: getSnapshot() };
    }
    const normalized = replacement.map(normalizeStoredItem);
    if (normalized.some(row => !row) || new Set(normalized.map(row => row.id)).size !== normalized.length) {
      return { applied: false, reason: "invalid_basket", snapshot: getSnapshot() };
    }
    if (signature(normalized) !== signature(items)) {
      const previousItems = items;
      items = normalized;
      if (!notify(() => { items = previousItems; })) {
        return { applied: false, reason: "stale_basket", snapshot: getSnapshot() };
      }
    }
    return { applied: true, snapshot: getSnapshot(), rejectedRows: [] };
  };

  const eventTarget = options.eventTarget === undefined
    ? (typeof window !== "undefined" ? window : null) : options.eventTarget;
  const onStorage = event => {
    if (event.storageArea === storage && (event.key === storageKey || event.key === null)) refresh();
  };
  const onResume = () => refresh();
  eventTarget?.addEventListener?.("storage", onStorage);
  eventTarget?.addEventListener?.("pageshow", onResume);
  eventTarget?.addEventListener?.("focus", onResume);
  const dispose = () => {
    eventTarget?.removeEventListener?.("storage", onStorage);
    eventTarget?.removeEventListener?.("pageshow", onResume);
    eventTarget?.removeEventListener?.("focus", onResume);
    listeners.clear();
  };

  return {
    getSnapshot,
    getPersistenceStatus,
    refresh,
    dispose,
    add,
    setQuantity,
    increment,
    decrement,
    remove,
    clear,
    mergeValidatedBasket,
    replaceReviewedBasket,
    subscribe
  };
}

export function countBasketUnits(items) {
  return items.reduce((total, item) => total + clampQuantity(item.quantity), 0);
}
