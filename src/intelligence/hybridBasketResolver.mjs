import {
  PROPOSAL_STATUS,
  validateBasketProposal
} from "../core/ai-basket-proposal.mjs";
import {
  LOCAL_BASKET_DECISION,
  parseLocalBasketText
} from "./localBasketParser.mjs";

export const HYBRID_BASKET_RESULT = Object.freeze({
  PROPOSAL: "proposal",
  CLARIFICATION: "clarification",
  REJECTED: "rejected",
  UNAVAILABLE: "unavailable",
  ERROR: "error"
});

export const HYBRID_BASKET_SOURCE = Object.freeze({
  LOCAL: "local",
  AI: "ai"
});

export const MAX_HYBRID_CATALOG_ITEMS = 50;
export const MAX_HYBRID_ALIASES_PER_PRODUCT = 16;
export const MAX_HYBRID_ALIAS_LENGTH = 80;

const CONFIRMATION_REQUIRED_REASONS = new Set([
  "semantic_intent",
  "ambiguous_segment",
  "unresolved_segment",
  "context_correction",
  "identity_specification",
  "unit_quantity_ambiguous",
  "commercial_constraint",
  "quantity_out_of_range"
]);

function canonicalString(value) {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value;
}

function normalizeAliases(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .filter(canonicalString)
      .map((alias) => (
        alias
          .normalize("NFKC")
          .toLocaleLowerCase("ru-RU")
          .replaceAll("ё", "е")
          .replace(/\s+/g, " ")
          .trim()
      ))
      .filter(Boolean)
      .filter((alias) => alias.length <= MAX_HYBRID_ALIAS_LENGTH)
  )]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_HYBRID_ALIASES_PER_PRODUCT);
}

export function snapshotHybridCatalog(catalog) {
  if (
    !Array.isArray(catalog)
    || catalog.length === 0
    || catalog.length > MAX_HYBRID_CATALOG_ITEMS
  ) {
    throw new TypeError("hybrid basket catalog is invalid");
  }

  const seen = new Set();
  const snapshot = catalog.map((product) => {
    if (
      product === null
      || typeof product !== "object"
      || Array.isArray(product)
      || !canonicalString(product.id)
      || !canonicalString(product.name)
      || !canonicalString(product.unit)
      || seen.has(product.id)
    ) {
      throw new TypeError("hybrid basket catalog product is invalid");
    }

    seen.add(product.id);
    const aliases = normalizeAliases(product.aliases);

    return Object.freeze({
      id: product.id,
      name: product.name,
      unit: product.unit,
      ...(aliases.length > 0
        ? { aliases: Object.freeze(aliases) }
        : {})
    });
  });

  return Object.freeze(snapshot);
}

function acceptedResult(source, proposal, validation, triggerReason = null) {
  return Object.freeze({
    kind: HYBRID_BASKET_RESULT.PROPOSAL,
    source,
    proposal,
    validation,
    triggerReason
  });
}

function typedResult(kind, details = {}) {
  return Object.freeze({
    kind,
    ...details
  });
}

function normalizeProviderResult(value) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof value.kind !== "string"
  ) {
    return null;
  }

  if (value.kind === "proposal") {
    if (
      Object.keys(value).length !== 2
      || !Object.hasOwn(value, "proposal")
    ) {
      return null;
    }
    return Object.freeze({
      kind: "proposal",
      proposal: value.proposal
    });
  }

  if (value.kind === "unavailable" || value.kind === "error") {
    const keys = Object.keys(value);
    if (
      keys.some((key) => key !== "kind" && key !== "code")
      || (Object.hasOwn(value, "code") && !canonicalString(value.code))
    ) {
      return null;
    }

    return Object.freeze({
      kind: value.kind,
      ...(value.code ? { code: value.code } : {})
    });
  }

  return null;
}

function validateFinalProposal(proposal, catalogSnapshot) {
  return validateBasketProposal(proposal, {
    catalog: catalogSnapshot
  });
}

export async function resolveHybridBasketProposal(
  text,
  catalog,
  options = {}
) {
  const catalogSnapshot = snapshotHybridCatalog(catalog);
  const localDecision = parseLocalBasketText(text, catalogSnapshot);

  if (localDecision.kind === LOCAL_BASKET_DECISION.REJECT) {
    return typedResult(HYBRID_BASKET_RESULT.REJECTED, {
      source: HYBRID_BASKET_SOURCE.LOCAL,
      reason: localDecision.reason
    });
  }

  if (localDecision.kind === LOCAL_BASKET_DECISION.LOCAL) {
    const validation = validateFinalProposal(
      localDecision.proposal,
      catalogSnapshot
    );

    if (validation.status !== PROPOSAL_STATUS.ACCEPTED) {
      return typedResult(HYBRID_BASKET_RESULT.ERROR, {
        source: HYBRID_BASKET_SOURCE.LOCAL,
        code: "local_validation_failed"
      });
    }

    return acceptedResult(
      HYBRID_BASKET_SOURCE.LOCAL,
      localDecision.proposal,
      validation
    );
  }

  const triggerReason = localDecision.reason ?? "local_fallback";
  const requestAiProposal = options.requestAiProposal;

  if (typeof requestAiProposal !== "function") {
    return typedResult(HYBRID_BASKET_RESULT.UNAVAILABLE, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: "ai_unconfigured",
      triggerReason
    });
  }

  let providerResult;
  try {
    providerResult = await requestAiProposal(text, catalogSnapshot);
  } catch {
    return typedResult(HYBRID_BASKET_RESULT.ERROR, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: "ai_request_failed",
      triggerReason
    });
  }

  const normalizedProviderResult = normalizeProviderResult(providerResult);
  if (normalizedProviderResult === null) {
    return typedResult(HYBRID_BASKET_RESULT.ERROR, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: "malformed_ai_result",
      triggerReason
    });
  }

  if (normalizedProviderResult.kind === "unavailable") {
    return typedResult(HYBRID_BASKET_RESULT.UNAVAILABLE, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: normalizedProviderResult.code ?? "ai_unavailable",
      triggerReason
    });
  }

  if (normalizedProviderResult.kind === "error") {
    return typedResult(HYBRID_BASKET_RESULT.ERROR, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: normalizedProviderResult.code ?? "ai_error",
      triggerReason
    });
  }

  const validation = validateFinalProposal(
    normalizedProviderResult.proposal,
    catalogSnapshot
  );

  if (validation.status === PROPOSAL_STATUS.PARTIAL) {
    return typedResult(HYBRID_BASKET_RESULT.CLARIFICATION, {
      source: HYBRID_BASKET_SOURCE.AI,
      reason: "partial_validation",
      triggerReason,
      validation
    });
  }

  if (validation.status === PROPOSAL_STATUS.REJECTED) {
    return typedResult(HYBRID_BASKET_RESULT.REJECTED, {
      source: HYBRID_BASKET_SOURCE.AI,
      reason: "ai_proposal_rejected",
      triggerReason,
      validation
    });
  }

  if (CONFIRMATION_REQUIRED_REASONS.has(triggerReason)) {
    return typedResult(HYBRID_BASKET_RESULT.CLARIFICATION, {
      source: HYBRID_BASKET_SOURCE.AI,
      reason: "confirmation_required",
      triggerReason,
      draftProposal: normalizedProviderResult.proposal,
      validation
    });
  }

  return acceptedResult(
    HYBRID_BASKET_SOURCE.AI,
    normalizedProviderResult.proposal,
    validation,
    triggerReason
  );
}
