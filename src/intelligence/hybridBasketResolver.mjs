import {
  PROPOSAL_STATUS,
  validateBasketProposal
} from "../core/ai-basket-proposal.mjs";
import { planLocalSegments } from "./localIntentPlanner.mjs";
import { planBudgetBasket } from "./budgetBasketPlanner.mjs";
import {
  resolveLocalAssistantDialogue,
  stripAssistantGreetingPrefix
} from "./localAssistantDialogue.mjs";
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

export const MAX_HYBRID_CATALOG_ITEMS = 200;
const LOCAL_INTENT_TRIGGER_REASONS = new Set([
  "semantic_intent",
  "unresolved_segment",
  "ambiguous_segment",
  "unit_quantity_ambiguous"
]);
// The AI endpoint (browser port and Edge function) accepts at most 50 hints.
export const MAX_AI_CATALOG_HINTS = 50;
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

function hintStems(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((token) => token.length >= 3)
    .map((token) => token.slice(0, Math.max(3, Math.min(5, token.length - 1))));
}

// Deterministic subset for the AI request: products whose name or alias
// stems appear in the text come first, then the rest in catalogue order.
export function selectAiCatalogHints(text, catalogSnapshot) {
  if (catalogSnapshot.length <= MAX_AI_CATALOG_HINTS) return catalogSnapshot;

  const textStems = hintStems(text);
  const mentions = (product) => [product.name, ...(product.aliases ?? [])]
    .some((term) => hintStems(term).some((stem) => (
      textStems.some((candidate) => candidate.startsWith(stem) || stem.startsWith(candidate))
    )));

  const matched = catalogSnapshot.filter(mentions);
  const rest = catalogSnapshot.filter((product) => !matched.includes(product));
  return Object.freeze([...matched, ...rest].slice(0, MAX_AI_CATALOG_HINTS));
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
  const assistantReply = resolveLocalAssistantDialogue(text);

  if (assistantReply) {
    return typedResult(HYBRID_BASKET_RESULT.CLARIFICATION, {
      source: HYBRID_BASKET_SOURCE.LOCAL,
      reason: "conversation",
      triggerReason: "smalltalk",
      assistantReply
    });
  }

  const shoppingText = stripAssistantGreetingPrefix(text);
  const localDecision = parseLocalBasketText(shoppingText, catalogSnapshot);

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

  // "Корзина на 600 рублей": a deterministic local draft from the dated
  // snapshot price hints. Confirm-first, prices never invented — the
  // planner only proposes catalogue ids that fit the stated budget.
  if (options.priceHints instanceof Map) {
    const budget = planBudgetBasket(
      shoppingText,
      catalogSnapshot,
      options.priceHints,
      (segment) => parseLocalBasketText(segment, catalogSnapshot)
    );
    if (budget) {
      const budgetValidation = validateFinalProposal(
        budget.proposal,
        catalogSnapshot
      );
      if (budgetValidation.status === PROPOSAL_STATUS.ACCEPTED) {
        return typedResult(HYBRID_BASKET_RESULT.CLARIFICATION, {
          source: HYBRID_BASKET_SOURCE.LOCAL,
          reason: "confirmation_required",
          triggerReason: "budget_request",
          draftProposal: budget.proposal,
          validation: budgetValidation,
          budget: Object.freeze({
            budgetMinor: budget.budgetMinor,
            estimateMinor: budget.estimateMinor,
            overBudget: budget.overBudget,
            style: budget.style
          })
        });
      }
    }
  }

  // Mixed and meal phrases are planned locally, segment by segment:
  // instant, free and deterministic. Drafts always need the user's
  // confirmation. Phrases with unknown products keep the existing
  // live-catalogue → AI route; the local draft is only a fallback when
  // that route cannot answer.
  const planned = LOCAL_INTENT_TRIGGER_REASONS.has(triggerReason)
    ? planLocalSegments(
        shoppingText,
        catalogSnapshot,
        (segment) => parseLocalBasketText(segment, catalogSnapshot)
      )
    : null;
  const localDraft = () => {
    if (
      !planned
      || planned.needsAi
      || (
        planned.proposal.items.length === 0
        && planned.ambiguous.length === 0
      )
    ) {
      return null;
    }

    const validation = planned.proposal.items.length > 0
      ? validateFinalProposal(planned.proposal, catalogSnapshot)
      : null;
    if (validation && validation.status !== PROPOSAL_STATUS.ACCEPTED) return null;

    return typedResult(HYBRID_BASKET_RESULT.CLARIFICATION, {
      source: HYBRID_BASKET_SOURCE.LOCAL,
      reason: "confirmation_required",
      triggerReason: planned.ambiguous.length > 0
        ? "ambiguous_segment"
        : planned.unresolvedTerms.length > 0
          ? "unresolved_segment"
          : planned.intents.length > 0
            ? "semantic_intent"
            : planned.packNotes.length > 0
              ? "unit_quantity_ambiguous"
              : "unresolved_segment",
      ...(validation
        ? { draftProposal: planned.proposal, validation }
        : {}),
      unresolvedTerms: planned.unresolvedTerms,
      ambiguousChoices: planned.ambiguous,
      packNotes: planned.packNotes
    });
  };

  if (planned && !planned.needsAi && planned.unresolvedTerms.length === 0) {
    const instant = localDraft();
    if (instant) return instant;
  }

  const requestAiProposal = options.requestAiProposal;

  if (typeof requestAiProposal !== "function") {
    return typedResult(HYBRID_BASKET_RESULT.UNAVAILABLE, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: "ai_unconfigured",
      triggerReason
    });
  }

  // When the AI route cannot answer, offer what was found locally
  // ("молоко" from "молоко и йогурт") instead of failing the whole phrase.
  const orLocalDraft = (failure) => localDraft() ?? failure;

  let providerResult;
  try {
    providerResult = await requestAiProposal(
      shoppingText,
      selectAiCatalogHints(shoppingText, catalogSnapshot)
    );
  } catch {
    return orLocalDraft(typedResult(HYBRID_BASKET_RESULT.ERROR, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: "ai_request_failed",
      triggerReason
    }));
  }

  const normalizedProviderResult = normalizeProviderResult(providerResult);
  if (normalizedProviderResult === null) {
    return orLocalDraft(typedResult(HYBRID_BASKET_RESULT.ERROR, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: "malformed_ai_result",
      triggerReason
    }));
  }

  if (normalizedProviderResult.kind === "unavailable") {
    return orLocalDraft(typedResult(HYBRID_BASKET_RESULT.UNAVAILABLE, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: normalizedProviderResult.code ?? "ai_unavailable",
      triggerReason
    }));
  }

  if (normalizedProviderResult.kind === "error") {
    return orLocalDraft(typedResult(HYBRID_BASKET_RESULT.ERROR, {
      source: HYBRID_BASKET_SOURCE.AI,
      code: normalizedProviderResult.code ?? "ai_error",
      triggerReason
    }));
  }

  // The provider can suggest useful items for a broad intent, but an explicit
  // product phrase that the local catalogue could not identify must never be
  // replaced by a related known ID. Preserve deterministic local matches and
  // surface the unresolved words for confirmation instead.
  if (planned?.unresolvedTerms?.length > 0) {
    const localResult = localDraft();
    if (localResult) return localResult;

    return typedResult(HYBRID_BASKET_RESULT.CLARIFICATION, {
      source: HYBRID_BASKET_SOURCE.LOCAL,
      reason: "confirmation_required",
      triggerReason: planned.ambiguous.length > 0
        ? "ambiguous_segment"
        : "unresolved_segment",
      unresolvedTerms: planned.unresolvedTerms,
      ...(planned.ambiguous.length > 0
        ? { ambiguousChoices: planned.ambiguous }
        : {}),
      ...(planned.packNotes.length > 0
        ? { packNotes: planned.packNotes }
        : {})
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
      validation,
      ...(planned?.unresolvedTerms?.length > 0
        ? { unresolvedTerms: planned.unresolvedTerms }
        : {}),
      ...(planned?.ambiguous?.length > 0
        ? { ambiguousChoices: planned.ambiguous }
        : {}),
      ...(planned?.packNotes?.length > 0
        ? { packNotes: planned.packNotes }
        : {})
    });
  }

  return acceptedResult(
    HYBRID_BASKET_SOURCE.AI,
    normalizedProviderResult.proposal,
    validation,
    triggerReason
  );
}
