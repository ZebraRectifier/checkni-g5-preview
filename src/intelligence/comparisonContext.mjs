const MAX_CONTEXT_BASKET_ITEMS = 50;
const MAX_CONTEXT_CANDIDATES = 32;
const MAX_CONTEXT_LINES_PER_CANDIDATE = 50;

function fail(message) {
  throw new TypeError(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalString(value, label, max = 240) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || value.length > max
  ) {
    fail(label + " must be a canonical non-empty string");
  }
  return value;
}

function optionalCanonicalString(value, label, max = 240) {
  if (value == null) return null;
  return canonicalString(value, label, max);
}

function safeMoney(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(label + " must be a non-negative safe integer");
  }
  return value;
}

function safeTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    fail(label + " must be an ISO timestamp");
  }
  return new Date(Date.parse(value)).toISOString();
}

function safeHttpsUrl(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== "string") fail(label + " must be an https URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(label + " must be an https URL");
  }
  if (url.protocol !== "https:") fail(label + " must be an https URL");
  return url.href;
}

function normalizeCoverage(value, label) {
  if (!isRecord(value)) fail(label + " is required");
  const coveredItems = value.coveredItems;
  const totalItems = value.totalItems;
  if (
    !Number.isSafeInteger(coveredItems)
    || !Number.isSafeInteger(totalItems)
    || totalItems < 1
    || coveredItems < 0
    || coveredItems > totalItems
  ) {
    fail(label + " is invalid");
  }

  return Object.freeze({
    coveredItems,
    totalItems,
    ratio: coveredItems / totalItems
  });
}

function normalizeBasketItem(item) {
  if (!isRecord(item) || !isRecord(item.product)) {
    fail("comparison basket item is invalid");
  }
  if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) {
    fail("comparison basket quantity is invalid");
  }

  return Object.freeze({
    productId: canonicalString(item.product.id, "basket product id", 180),
    name: canonicalString(item.product.name, "basket product name"),
    unit: canonicalString(item.product.unit, "basket product unit", 80),
    quantity: item.quantity
  });
}

function normalizeLine(line, basketProductIds) {
  if (!isRecord(line)) fail("comparison line is invalid");
  const productId = canonicalString(line.productId, "line product id", 180);
  if (!basketProductIds.has(productId)) {
    fail("comparison line references product outside basket");
  }

  const status = canonicalString(line.status, "line status", 80);
  const priced = status === "priced-observation";

  return Object.freeze({
    productId,
    quantity: line.quantity,
    unit: canonicalString(line.unit, "line unit", 80),
    status,
    unitPriceMinor: priced
      ? safeMoney(line.unitPriceMinor, "line unit price")
      : safeMoney(line.unitPriceMinor, "line unit price", { nullable: true }),
    lineTotalMinor: priced
      ? safeMoney(line.lineTotalMinor, "line total")
      : safeMoney(line.lineTotalMinor, "line total", { nullable: true }),
    availability: canonicalString(line.availability, "line availability", 40),
    observedAt: safeTimestamp(line.observedAt, "line observedAt", { nullable: !priced }),
    sourceUrl: safeHttpsUrl(line.sourceUrl, "line sourceUrl", { nullable: !priced })
  });
}

function normalizeCandidate(candidate, basketProductIds) {
  if (!isRecord(candidate)) fail("comparison candidate is invalid");
  if (!Array.isArray(candidate.lines) || candidate.lines.length > MAX_CONTEXT_LINES_PER_CANDIDATE) {
    fail("comparison candidate lines are invalid");
  }

  const priceCoverage = normalizeCoverage(candidate.priceCoverage, "candidate priceCoverage");
  const completePriceCoverage = candidate.completePriceCoverage === true;
  if (completePriceCoverage !== (priceCoverage.coveredItems === priceCoverage.totalItems)) {
    fail("candidate completePriceCoverage conflicts with coverage");
  }

  return Object.freeze({
    candidateId: canonicalString(candidate.candidateId, "candidate id", 320),
    candidateName: canonicalString(candidate.candidateName, "candidate name"),
    sourceId: canonicalString(candidate.sourceId, "candidate source id", 160),
    sourceName: canonicalString(candidate.sourceName, "candidate source name", 160),
    storeId: optionalCanonicalString(candidate.storeId, "candidate store id", 160),
    storeName: optionalCanonicalString(candidate.storeName, "candidate store name"),
    locationLabel: optionalCanonicalString(candidate.locationLabel, "candidate location label"),
    granularity: canonicalString(candidate.granularity, "candidate granularity", 80),
    availability: canonicalString(candidate.availability, "candidate availability", 40),
    priceCoverage,
    completePriceCoverage,
    knownSubtotalMinor: safeMoney(candidate.knownSubtotalMinor, "candidate known subtotal"),
    totalMinor: safeMoney(candidate.totalMinor, "candidate total", { nullable: true }),
    lines: Object.freeze(candidate.lines.map((line) => normalizeLine(line, basketProductIds)))
  });
}

export function buildComparisonContext(comparison) {
  if (!isRecord(comparison) || comparison.kind !== "observed-price-comparison") {
    fail("observed-price comparison is required");
  }

  if (
    !Array.isArray(comparison.basket)
    || comparison.basket.length < 1
    || comparison.basket.length > MAX_CONTEXT_BASKET_ITEMS
  ) {
    fail("comparison basket is invalid");
  }

  if (
    !Array.isArray(comparison.candidates)
    || comparison.candidates.length > MAX_CONTEXT_CANDIDATES
  ) {
    fail("comparison candidates are invalid");
  }

  const basket = Object.freeze(comparison.basket.map(normalizeBasketItem));
  const basketProductIds = new Set(basket.map((item) => item.productId));
  const candidates = Object.freeze(
    comparison.candidates.map((candidate) => normalizeCandidate(candidate, basketProductIds))
  );

  const ids = new Set();
  for (const candidate of candidates) {
    if (ids.has(candidate.candidateId)) fail("duplicate candidate id");
    ids.add(candidate.candidateId);
  }

  const winnerCandidateId = comparison.winner == null
    ? null
    : canonicalString(comparison.winner.candidateId, "winner candidate id", 320);

  if (winnerCandidateId !== null && !ids.has(winnerCandidateId)) {
    fail("winner is not present in candidates");
  }

  const completeCandidates = candidates.filter((candidate) => candidate.completePriceCoverage);
  if (winnerCandidateId !== null) {
    const winner = candidates.find((candidate) => candidate.candidateId === winnerCandidateId);
    if (!winner.completePriceCoverage || winner.totalMinor == null) {
      fail("winner must have complete price coverage");
    }
    const cheapest = [...completeCandidates].sort((a, b) => (
      a.totalMinor - b.totalMinor || a.candidateId.localeCompare(b.candidateId)
    ))[0];
    if (!cheapest || cheapest.candidateId !== winnerCandidateId) {
      fail("winner conflicts with deterministic candidate totals");
    }
  }

  const savingsMinor = safeMoney(comparison.savingsMinor, "comparison savings", { nullable: true });

  return Object.freeze({
    kind: "comparison-intelligence-context",
    mode: "observed-price",
    truth: Object.freeze({
      winnerCandidateId,
      savingsMinor,
      completeCandidateCount: completeCandidates.length,
      availabilitySemantics: "unknown-unless-separately-proven",
      priceSemantics: "observed-price"
    }),
    basket,
    candidates
  });
}

export {
  MAX_CONTEXT_BASKET_ITEMS,
  MAX_CONTEXT_CANDIDATES,
  MAX_CONTEXT_LINES_PER_CANDIDATE
};
