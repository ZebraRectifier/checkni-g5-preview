import { getSensorSource } from "../sensors/sourceRegistry.mjs";

export const COMPARISON_FOCUS = Object.freeze({
  WINNER: "winner",
  PRICE_GAP: "price-gap",
  COVERAGE: "coverage",
  FRESHNESS: "freshness",
  AVAILABILITY: "availability"
});

const TOP_FIELDS = new Set(["focus", "candidateIds", "researchSourceIds"]);
const MAX_CANDIDATE_REFS = 4;
const MAX_RESEARCH_SOURCES = 5;

function rejected(reason) {
  return Object.freeze({ kind: "rejected", reason });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueCanonicalStrings(value, max) {
  if (!Array.isArray(value) || value.length > max) return null;
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (
      typeof item !== "string"
      || item.length === 0
      || item.trim() !== item
      || seen.has(item)
    ) {
      return null;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function validateComparisonIntelligenceProposal(context, proposal) {
  if (!isRecord(context) || context.kind !== "comparison-intelligence-context") {
    return rejected("invalid_context");
  }

  if (
    !isRecord(proposal)
    || Object.keys(proposal).some((key) => !TOP_FIELDS.has(key))
    || !Object.values(COMPARISON_FOCUS).includes(proposal.focus)
  ) {
    return rejected("invalid_shape");
  }

  const candidateIds = uniqueCanonicalStrings(proposal.candidateIds, MAX_CANDIDATE_REFS);
  const researchSourceIds = uniqueCanonicalStrings(
    proposal.researchSourceIds,
    MAX_RESEARCH_SOURCES
  );

  if (!candidateIds || !researchSourceIds) {
    return rejected("invalid_references");
  }

  const byCandidateId = new Map(
    context.candidates.map((candidate) => [candidate.candidateId, candidate])
  );

  if (candidateIds.some((candidateId) => !byCandidateId.has(candidateId))) {
    return rejected("unknown_candidate");
  }

  for (const sourceId of researchSourceIds) {
    const source = getSensorSource(sourceId);
    if (!source || source.capabilities.publicPageResearch !== true) {
      return rejected("source_not_researchable");
    }
  }

  if (proposal.focus === COMPARISON_FOCUS.WINNER) {
    if (
      context.truth.winnerCandidateId == null
      || candidateIds.length !== 1
      || candidateIds[0] !== context.truth.winnerCandidateId
    ) {
      return rejected("winner_reference_mismatch");
    }
  }

  if (proposal.focus === COMPARISON_FOCUS.PRICE_GAP) {
    if (
      context.truth.winnerCandidateId == null
      || context.truth.savingsMinor == null
      || candidateIds.length < 2
      || !candidateIds.includes(context.truth.winnerCandidateId)
      || candidateIds.some((candidateId) => !byCandidateId.get(candidateId).completePriceCoverage)
    ) {
      return rejected("price_gap_not_supported");
    }
  }

  if (proposal.focus === COMPARISON_FOCUS.COVERAGE) {
    if (
      candidateIds.length === 0
      || candidateIds.every((candidateId) => byCandidateId.get(candidateId).completePriceCoverage)
    ) {
      return rejected("coverage_focus_not_supported");
    }
  }

  if (proposal.focus === COMPARISON_FOCUS.FRESHNESS) {
    if (candidateIds.length === 0) {
      return rejected("freshness_focus_requires_candidate");
    }
  }

  if (proposal.focus === COMPARISON_FOCUS.AVAILABILITY) {
    if (
      candidateIds.length === 0
      || candidateIds.some((candidateId) => (
        byCandidateId.get(candidateId).availability !== "unknown"
      ))
    ) {
      return rejected("availability_focus_not_supported");
    }
  }

  return Object.freeze({
    kind: "accepted",
    plan: Object.freeze({
      focus: proposal.focus,
      candidateIds: Object.freeze(candidateIds),
      researchSourceIds: Object.freeze(researchSourceIds),
      winnerCandidateId: context.truth.winnerCandidateId,
      savingsMinor: context.truth.savingsMinor
    })
  });
}

export {
  MAX_CANDIDATE_REFS,
  MAX_RESEARCH_SOURCES
};
