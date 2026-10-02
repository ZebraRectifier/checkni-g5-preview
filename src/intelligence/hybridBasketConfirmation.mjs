export const HYBRID_DRAFT_CONFIRMATION = Object.freeze({
  CONFIRM_ALL: "confirm_all",
  ADD_FOUND_ONLY: "add_found_only"
});

const CONFIRMABLE_TRIGGER_REASONS = new Set([
  "budget_request",
  "semantic_intent",
  "unresolved_segment",
  "context_correction",
  "identity_specification",
  "unit_quantity_ambiguous"
]);

export function canConfirmHybridBasketDraft(result, mode) {
  if (
    !result
    || typeof result !== "object"
    || Array.isArray(result)
    || result.kind !== "clarification"
  ) {
    return false;
  }

  if (
    result.reason === "confirmation_required"
    && mode === HYBRID_DRAFT_CONFIRMATION.CONFIRM_ALL
  ) {
    return CONFIRMABLE_TRIGGER_REASONS.has(result.triggerReason);
  }

  if (
    result.reason === "partial_validation"
    && mode === HYBRID_DRAFT_CONFIRMATION.ADD_FOUND_ONLY
  ) {
    return CONFIRMABLE_TRIGGER_REASONS.has(result.triggerReason);
  }

  return false;
}

function freezeProposal(items) {
  return Object.freeze({
    kind: "proposal",
    proposal: Object.freeze({
      items: Object.freeze(items.map((item) => Object.freeze({
        productId: item.productId,
        quantity: item.quantity
      })))
    })
  });
}

function canonicalAcceptedRows(validation) {
  if (!Array.isArray(validation?.acceptedRows)) return null;

  const items = [];
  for (const row of validation.acceptedRows) {
    if (
      !row
      || typeof row !== "object"
      || Array.isArray(row)
      || typeof row.productId !== "string"
      || row.productId.trim() !== row.productId
      || row.productId === ""
      || !Number.isSafeInteger(row.quantity)
      || row.quantity < 1
      || row.quantity > 99
    ) {
      return null;
    }
    items.push({
      productId: row.productId,
      quantity: row.quantity
    });
  }

  return items;
}

function exactDraftItems(result) {
  const draftItems = result?.draftProposal?.items;
  if (!Array.isArray(draftItems) || draftItems.length === 0) return null;

  const accepted = canonicalAcceptedRows(result.validation);
  if (accepted === null || accepted.length !== draftItems.length) return null;

  const acceptedById = new Map(
    accepted.map((item) => [item.productId, item.quantity])
  );

  for (const item of draftItems) {
    if (
      !item
      || typeof item !== "object"
      || Array.isArray(item)
      || Object.keys(item).some(
        (key) => key !== "productId" && key !== "quantity"
      )
      || acceptedById.get(item.productId) !== item.quantity
    ) {
      return null;
    }
  }

  return accepted;
}

export function confirmHybridBasketDraft(result, mode) {
  if (
    !result
    || typeof result !== "object"
    || Array.isArray(result)
    || result.kind !== "clarification"
  ) {
    return Object.freeze({
      kind: "error",
      code: "not_confirmable"
    });
  }

  if (
    result.reason === "confirmation_required"
    && mode === HYBRID_DRAFT_CONFIRMATION.CONFIRM_ALL
  ) {
    if (!canConfirmHybridBasketDraft(result, mode)) {
      return Object.freeze({
        kind: "error",
        code: "confirmation_mode_not_allowed"
      });
    }
    const items = exactDraftItems(result);
    if (items === null || result.validation?.status !== "accepted") {
      return Object.freeze({
        kind: "error",
        code: "invalid_confirmation_draft"
      });
    }

    return Object.freeze({
      ...freezeProposal(items),
      catalogSnapshot: result.catalogSnapshot ?? null
    });
  }

  if (
    result.reason === "partial_validation"
    && mode === HYBRID_DRAFT_CONFIRMATION.ADD_FOUND_ONLY
  ) {
    if (!canConfirmHybridBasketDraft(result, mode)) {
      return Object.freeze({
        kind: "error",
        code: "confirmation_mode_not_allowed"
      });
    }

    const items = canonicalAcceptedRows(result.validation);
    if (
      result.validation?.status !== "partial"
      || items === null
      || items.length === 0
    ) {
      return Object.freeze({
        kind: "error",
        code: "invalid_partial_draft"
      });
    }

    return Object.freeze({
      ...freezeProposal(items),
      catalogSnapshot: result.catalogSnapshot ?? null
    });
  }

  return Object.freeze({
    kind: "error",
    code: "confirmation_mode_not_allowed"
  });
}
