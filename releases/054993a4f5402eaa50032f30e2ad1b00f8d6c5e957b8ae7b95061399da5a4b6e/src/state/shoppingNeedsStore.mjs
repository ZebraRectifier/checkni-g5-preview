import { NEED_LIMIT, decimal } from '../intelligence/shoppingNeeds.mjs';
export const SHOPPING_NEEDS_KEY = 'checkni.shopping-needs.v1';
const copy = value => JSON.parse(JSON.stringify(value));
const initial = () => ({ version: 1, revision: 0, lines: [], focus: [], pending: null, receipts: [], undo: null });
const valid = state => state?.version === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0
  && Array.isArray(state.lines) && state.lines.length <= NEED_LIMIT && new Set(state.lines.map(x => x.lineId)).size === state.lines.length
  && state.lines.every(row => typeof row.lineId === 'string' && typeof row.requestedName === 'string' && row.requestedName.length <= 300
    && typeof row.rawText === 'string' && row.rawText.length <= 300 && row.quantity && decimal(row.quantity.value) === row.quantity.value
    && ['piece','bottle','pack','box','can','bag','bunch','head','kg','g','l','ml'].includes(row.quantity.unit)
    && row.resolution && ['unresolved','selected','needs_clarification'].includes(row.resolution.status))
  && Array.isArray(state.focus) && Array.isArray(state.receipts) && state.receipts.length <= 128
  && state.receipts.every(x => typeof x.operationId === 'string' && typeof x.requestId === 'string');

export function createShoppingNeedsStore(options = {}) {
  let storage;
  try { storage = options.storage === undefined ? globalThis.localStorage ?? null : options.storage; } catch { storage = null; }
  const ephemeral = options.storage === null;
  const locks = options.locks ?? globalThis.navigator?.locks;
  let state = initial(), readError = false;
  const listeners = new Set();
  function read() {
    if (ephemeral) return copy(state);
    if (!storage) throw new Error('storage_unavailable');
    const raw = storage.getItem(SHOPPING_NEEDS_KEY);
    if (raw === null) return initial();
    if (raw.length > 500000) throw new Error('invalid_storage');
    const parsed = JSON.parse(raw);
    if (!valid(parsed)) throw new Error('invalid_storage');
    return parsed;
  }
  try { state = read(); } catch { readError = true; }
  const emit = () => { for (const listener of listeners) { try { listener(copy(state)); } catch { /* Presentation cannot roll back a committed operation. */ } } };
  const refresh = () => { try { const next = read(); const changed = JSON.stringify(next) !== JSON.stringify(state); state = next; readError = false; if (changed) emit(); return true; } catch { readError = true; return false; } };
  async function transact({ requestId, revision }, reduce) {
    const commit = () => {
      let current;
      try { current = read(); } catch { return { ok: false, reason: 'storage_unavailable' }; }
      const prior = current.receipts.find(row => row.requestId === requestId);
      if (prior) { state = current; return { ok: true, replay: true, receipt: copy(prior), snapshot: copy(state) }; }
      if (current.revision !== revision) { state = current; emit(); return { ok: false, reason: 'conflict' }; }
      const proposed = reduce(copy(current));
      if (!proposed) return { ok: false, reason: 'invalid_operation' };
      const next = proposed.state;
      next.revision = current.revision + 1;
      const receipt = { operationId: requestId, requestId, revision: next.revision, message: proposed.message, lineIds: proposed.lineIds ?? [] };
      next.receipts = [...current.receipts, receipt].slice(-128);
      if (!valid(next)) return { ok: false, reason: 'invalid_operation' };
      try {
        // One record holds list, focus, pending action, revision and receipt.
        // Web Locks serialize tabs; no basket SKU is written by this transaction.
        if (!ephemeral) storage.setItem(SHOPPING_NEEDS_KEY, JSON.stringify(next));
      } catch { return { ok: false, reason: 'write_failed' }; }
      state = next; readError = false; emit();
      return { ok: true, receipt: copy(receipt), snapshot: copy(state) };
    };
    if (ephemeral || options.allowUnlockedForTests === true) return commit();
    if (!locks?.request) return { ok: false, reason: 'storage_unavailable' };
    try { return await locks.request(SHOPPING_NEEDS_KEY, commit); } catch { return { ok: false, reason: 'write_failed' }; }
  }
  return Object.freeze({ getSnapshot: () => copy(state), hasReadError: () => readError, refresh, transact,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } });
}
