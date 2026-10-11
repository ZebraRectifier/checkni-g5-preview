import { createShoppingConversation, CONVERSATION_LIMITS, shoppingTargetLabel } from "../intelligence/shoppingConversation.mjs";

export const SHOPPING_PREFERENCE_STORAGE_KEY = "checkni.shopping.preferences.v1";
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const scope = value => ["goal", "conversation"].includes(value);
const allowedFact = (key, value) => ({
  budgetMinor: Number.isSafeInteger(value) && value >= 1000 && value <= 99999900,
  cookingEffort: ["minimal", "normal"].includes(value),
  brandStyle: ["specific", "any"].includes(value),
  budgetStyle: ["better", "cheaper"].includes(value),
  direction: ["cold", "heat", "quick"].includes(value),
  unresolvedConstraints: Array.isArray(value) && value.length > 0 && value.length <= CONVERSATION_LIMITS.bytes
    && value.every(item => typeof item === "string" && item.trim() && item.length <= 80 && !/[<>\u0000-\u001f]/u.test(item))
}[key] === true);
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const size = value => new TextEncoder().encode(value).length;

function validPayload(value) {
  if (!exact(value, ["version", "facts", "rejected", "exceptions", "wishes"]) || value.version !== 1) return false;
  for (const key of ["facts", "rejected", "exceptions", "wishes"]) {
    if (!record(value[key]) || Object.keys(value[key]).length > CONVERSATION_LIMITS[key]) return false;
    for (const [name, entry] of Object.entries(value[key])) {
      if (!exact(entry, ["value", "scope"]) || !scope(entry.scope)) return false;
      if (key === "facts" ? !allowedFact(name, entry.value) : shoppingTargetLabel(name) === name || entry.value !== true) return false;
    }
  }
  return !Object.keys(value.rejected).some(key => Object.hasOwn(value.wishes, key) || Object.hasOwn(value.exceptions, key));
}

function restore(payload) {
  const memory = { ...createShoppingConversation(), revision: 1 };
  for (const key of ["facts", "rejected", "exceptions", "wishes"]) {
    memory[key] = Object.fromEntries(Object.entries(payload[key]).map(([name, entry]) => [name, {
      ...entry, origin: "explicit", confidence: "high", evidenceTurn: 1
    }]));
  }
  return size(JSON.stringify(memory)) <= CONVERSATION_LIMITS.bytes ? freeze(memory) : null;
}

function blockedMemory() {
  return restore({ version: 1, facts: { unresolvedConstraints: { scope: "goal",
    value: ["Сохранённые условия повреждены: сбрось предпочтения или уточни их заново"] } }, rejected: {}, exceptions: {}, wishes: {} });
}

export function createShoppingPreferenceStore({ storage } = {}) {
  if (storage === undefined) {
    try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
  }
  let saved = false;
  let failed = false;
  let lastRaw = null;
  const available = () => Boolean(storage?.getItem && storage?.setItem && storage?.removeItem);
  function read() {
    if (!available()) return createShoppingConversation();
    try {
      const raw = storage.getItem(SHOPPING_PREFERENCE_STORAGE_KEY);
      if (raw === null) return createShoppingConversation();
      if (typeof raw !== "string" || raw.length > CONVERSATION_LIMITS.bytes || size(raw) > CONVERSATION_LIMITS.bytes) return blockedMemory();
      const payload = JSON.parse(raw);
      const memory = validPayload(payload) ? restore(payload) : null;
      if (!memory) return blockedMemory();
      lastRaw = raw; saved = true;
      return memory;
    } catch { failed = true; return blockedMemory(); }
  }
  function write(memory) {
    if (!available()) return false;
    const payload = { version: 1, facts: {}, rejected: {}, exceptions: {}, wishes: {} };
    for (const key of ["facts", "rejected", "exceptions", "wishes"]) {
      payload[key] = Object.fromEntries(Object.entries(memory[key]).filter(([name, entry]) => (
        entry.origin === "explicit" && scope(entry.scope)
        && (key === "facts" ? allowedFact(name, entry.value) : shoppingTargetLabel(name) !== name && entry.value === true)
      )).map(([name, { value, scope }]) => [name, { value, scope }]));
    }
    const empty = ["facts", "rejected", "exceptions", "wishes"].every(key => !Object.keys(payload[key]).length);
    const raw = empty ? null : JSON.stringify(payload);
    if (!validPayload(payload) || raw && size(raw) > CONVERSATION_LIMITS.bytes) return false;
    try {
      if (raw === null) storage.removeItem(SHOPPING_PREFERENCE_STORAGE_KEY);
      else if (raw !== lastRaw) storage.setItem(SHOPPING_PREFERENCE_STORAGE_KEY, raw);
      lastRaw = raw; saved = !empty; failed = false;
      return true;
    } catch { failed = true; return false; }
  }
  return Object.freeze({ read, write, status: () => ({ available: available(), saved, failed }) });
}
