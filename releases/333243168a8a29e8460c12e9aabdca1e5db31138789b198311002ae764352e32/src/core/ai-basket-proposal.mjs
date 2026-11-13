import { MOCK_CATALOG } from '../data/mockCatalog.mjs';
import { normalizeBasket } from './basket-core.mjs';

const PROPOSAL_STATUS = Object.freeze({
  ACCEPTED: 'accepted',
  PARTIAL: 'partial',
  REJECTED: 'rejected',
});

const PROPOSAL_REASON = Object.freeze({
  MALFORMED_PAYLOAD: 'malformed_payload',
  EXTRA_PAYLOAD_FIELDS: 'extra_payload_fields',
  EMPTY_PROPOSAL: 'empty_proposal',
  TOO_MANY_ROWS: 'too_many_rows',
  MALFORMED_ROW: 'malformed_row',
  EXTRA_ROW_FIELDS: 'extra_row_fields',
  INVALID_PRODUCT_ID: 'invalid_product_id',
  UNKNOWN_PRODUCT_ID: 'unknown_product_id',
  INVALID_QUANTITY: 'invalid_quantity',
  DUPLICATE_QUANTITY_EXCEEDS_LIMIT: 'duplicate_quantity_exceeds_limit',
  DUPLICATES_MERGED: 'duplicates_merged',
});

const MAX_PROPOSAL_ROWS = 50;
const MAX_PROPOSAL_QUANTITY = 99;
const ALLOWED_PAYLOAD_FIELDS = new Set(['items']);
const ALLOWED_ROW_FIELDS = new Set(['productId', 'quantity']);

function validateBasketProposal(payload, options = {}) {
  const catalog = options.catalog ?? MOCK_CATALOG;
  const catalogById = normalizeCatalog(catalog);

  if (!isRecord(payload)) {
    return rejectedPayload(PROPOSAL_REASON.MALFORMED_PAYLOAD);
  }

  const payloadFields = Object.keys(payload);
  const extraPayloadFields = payloadFields
    .filter((field) => !ALLOWED_PAYLOAD_FIELDS.has(field))
    .sort(compareText);

  if (extraPayloadFields.length > 0) {
    return rejectedPayload(PROPOSAL_REASON.EXTRA_PAYLOAD_FIELDS, {
      fields: extraPayloadFields,
    });
  }

  if (!Array.isArray(payload.items)) {
    return rejectedPayload(PROPOSAL_REASON.MALFORMED_PAYLOAD);
  }

  if (payload.items.length === 0) {
    return rejectedPayload(PROPOSAL_REASON.EMPTY_PROPOSAL);
  }

  if (payload.items.length > MAX_PROPOSAL_ROWS) {
    return rejectedPayload(PROPOSAL_REASON.TOO_MANY_ROWS, {
      rowCount: payload.items.length,
      maxRows: MAX_PROPOSAL_ROWS,
    });
  }

  const groups = new Map();
  const unresolvedRows = [];
  const rejectedRows = [];

  payload.items.forEach((row, index) => {
    if (!isRecord(row)) {
      rejectedRows.push({
        index,
        productId: null,
        reason: PROPOSAL_REASON.MALFORMED_ROW,
      });
      return;
    }

    const extraFields = Object.keys(row)
      .filter((field) => !ALLOWED_ROW_FIELDS.has(field))
      .sort(compareText);

    if (extraFields.length > 0) {
      rejectedRows.push({
        index,
        productId: safeProductId(row.productId),
        reason: PROPOSAL_REASON.EXTRA_ROW_FIELDS,
        fields: extraFields,
      });
      return;
    }

    const productId = safeProductId(row.productId);
    if (productId == null) {
      rejectedRows.push({
        index,
        productId: null,
        reason: PROPOSAL_REASON.INVALID_PRODUCT_ID,
      });
      return;
    }

    if (!isValidProposalQuantity(row.quantity)) {
      rejectedRows.push({
        index,
        productId,
        reason: PROPOSAL_REASON.INVALID_QUANTITY,
      });
      return;
    }

    const product = catalogById.get(productId);
    if (!product) {
      unresolvedRows.push({
        index,
        productId,
        quantity: row.quantity,
        reason: PROPOSAL_REASON.UNKNOWN_PRODUCT_ID,
      });
      return;
    }

    const group = groups.get(productId) ?? {
      product,
      rows: [],
    };
    group.rows.push({
      index,
      quantity: row.quantity,
    });
    groups.set(productId, group);
  });

  const acceptedRows = [];
  const notices = [];
  const basketItems = [];

  for (const productId of Array.from(groups.keys()).sort(compareText)) {
    const group = groups.get(productId);
    const totalQuantity = group.rows.reduce(
      (sum, row) => sum + row.quantity,
      0,
    );

    if (
      !Number.isSafeInteger(totalQuantity)
      || totalQuantity > MAX_PROPOSAL_QUANTITY
    ) {
      for (const row of group.rows) {
        rejectedRows.push({
          index: row.index,
          productId,
          reason: PROPOSAL_REASON.DUPLICATE_QUANTITY_EXCEEDS_LIMIT,
        });
      }
      continue;
    }

    const sourceIndexes = group.rows
      .map((row) => row.index)
      .sort((a, b) => a - b);

    acceptedRows.push({
      productId,
      quantity: totalQuantity,
      sourceIndexes,
    });

    if (sourceIndexes.length > 1) {
      notices.push({
        productId,
        reason: PROPOSAL_REASON.DUPLICATES_MERGED,
        sourceIndexes,
        quantity: totalQuantity,
      });
    }

    basketItems.push({
      product: { ...group.product },
      quantity: totalQuantity,
    });
  }

  rejectedRows.sort((a, b) => a.index - b.index);
  unresolvedRows.sort((a, b) => a.index - b.index);

  const basket = basketItems.length === 0
    ? []
    : normalizeBasket(basketItems);

  const hasProblems = rejectedRows.length > 0 || unresolvedRows.length > 0;
  const status = basket.length === 0
    ? PROPOSAL_STATUS.REJECTED
    : hasProblems
      ? PROPOSAL_STATUS.PARTIAL
      : PROPOSAL_STATUS.ACCEPTED;

  return {
    status,
    basket,
    acceptedRows,
    unresolvedRows,
    rejectedRows,
    notices,
    payloadIssues: [],
  };
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new TypeError('catalog must contain at least one product');
  }

  const byId = new Map();

  for (const product of catalog) {
    if (!isRecord(product)) {
      throw new TypeError('catalog product must be an object');
    }

    const id = requireCanonicalString(product.id, 'catalog product id');
    const name = requireCanonicalString(product.name, 'catalog product name');
    const unit = requireCanonicalString(product.unit, 'catalog product unit');

    if (byId.has(id)) {
      throw new TypeError('duplicate catalog product id: ' + id);
    }

    byId.set(id, Object.freeze({ id, name, unit }));
  }

  return byId;
}

function rejectedPayload(reason, details = {}) {
  return {
    status: PROPOSAL_STATUS.REJECTED,
    basket: [],
    acceptedRows: [],
    unresolvedRows: [],
    rejectedRows: [],
    notices: [],
    payloadIssues: [{ reason, ...details }],
  };
}

function safeProductId(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
  ) {
    return null;
  }

  return value;
}

function isValidProposalQuantity(value) {
  return Number.isSafeInteger(value)
    && value >= 1
    && value <= MAX_PROPOSAL_QUANTITY;
}

function requireCanonicalString(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
  ) {
    throw new TypeError(label + ' must be a canonical non-empty string');
  }

  return value;
}

function isRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export {
  MAX_PROPOSAL_QUANTITY,
  MAX_PROPOSAL_ROWS,
  PROPOSAL_REASON,
  PROPOSAL_STATUS,
  validateBasketProposal,
};
