// Local intent planner: turns meal / occasion phrases into a draft basket
// without any server or paid AI. It never adds anything by itself — the
// resolver returns its result as a clarification that the user confirms.
// It only proposes canonical catalogue ids and never touches prices.

const INTENTS = Object.freeze([
  { id: "breakfast", pattern: /завтрак/, items: ["eggs-c1-10", "milk-25-900", "bread-wheat-400", "butter-825-180", "cheese-semi-hard-200", "oat-flakes-400"] },
  { id: "borscht", pattern: /борщ/, items: ["beets-1kg", "cabbage-1kg", "potatoes-1kg", "carrots-1kg", "onions-1kg", "pork-1kg", "sour-cream-20-300"] },
  { id: "shchi", pattern: /(?:^|[^а-я])щи(?:$|[^а-я])/, items: ["cabbage-1kg", "potatoes-1kg", "carrots-1kg", "onions-1kg", "pork-1kg", "sour-cream-20-300"] },
  { id: "soup", pattern: /суп/, items: ["whole-chicken-1kg", "potatoes-1kg", "carrots-1kg", "onions-1kg", "pasta-450"] },
  { id: "pancakes", pattern: /блин|оладь/, items: ["milk-25-900", "eggs-c1-10", "flour-2kg", "sugar-1kg", "sunflower-oil-1l", "sour-cream-20-300"] },
  { id: "syrniki", pattern: /сырник/, items: ["cottage-cheese-5-200", "eggs-c1-10", "flour-2kg", "sugar-1kg", "sour-cream-20-300"] },
  { id: "omelet", pattern: /омлет|яичниц/, items: ["eggs-c1-10", "milk-25-900", "tomatoes-600", "cheese-semi-hard-200"] },
  { id: "olivier", pattern: /оливье/, items: ["potatoes-1kg", "carrots-1kg", "eggs-c1-10", "doctor-sausage-400", "green-peas-400", "cucumbers-1kg", "mayonnaise-400"] },
  { id: "pilaf", pattern: /плов/, items: ["rice-900", "pork-1kg", "carrots-1kg", "onions-1kg", "sunflower-oil-1l"] },
  { id: "navy-pasta", pattern: /по[-\s]?флотски/, items: ["pasta-450", "ground-beef-400", "onions-1kg"] },
  { id: "salad", pattern: /салат/, items: ["tomatoes-600", "cucumbers-1kg", "bell-pepper-1kg", "onions-1kg", "sunflower-oil-1l"] },
  { id: "charlotte", pattern: /шарлотк|пирог/, items: ["apples-1kg", "eggs-c1-10", "flour-2kg", "sugar-1kg"] },
  { id: "dinner", pattern: /ужин|обед/, items: ["chicken-fillet-600", "potatoes-1kg", "buckwheat-800", "cucumbers-1kg", "tomatoes-600"] },
  { id: "tea-time", pattern: /к\s+(?:чаю|кофе)|перекус|сладк/, items: ["oat-cookies-300", "milk-chocolate-90", "black-tea-25", "bananas-1kg"] },
  { id: "fruit", pattern: /фрукт/, items: ["apples-1kg", "bananas-1kg", "oranges-1kg", "mandarins-1kg", "pears-1kg"] },
  { id: "vegetables", pattern: /овощ/, items: ["potatoes-1kg", "carrots-1kg", "onions-1kg", "cucumbers-1kg", "tomatoes-600"] },
  { id: "household", pattern: /уборк|для\s+дома|хозяйств|бытов/, items: ["dish-soap-500", "paper-towels-2", "toilet-paper-4"] },
  { id: "week", pattern: /на\s+неделю|базов|самое\s+нужное|необходим/, items: ["milk-25-900", "eggs-c1-10", "bread-wheat-400", "potatoes-1kg", "chicken-fillet-600", "buckwheat-800", "pasta-450", "apples-1kg"] }
]);

export const LOCAL_INTENT_IDS = Object.freeze(INTENTS.map((intent) => intent.id));

function normalize(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns { intents, proposal } or null when no known intent is present.
export function planLocalIntentBasket(text, catalogSnapshot) {
  const normalized = normalize(text);
  if (!normalized || !Array.isArray(catalogSnapshot)) return null;

  const known = new Set(catalogSnapshot.map((product) => product.id));
  const matched = INTENTS.filter((intent) => intent.pattern.test(normalized));
  if (matched.length === 0) return null;

  const ids = [];
  for (const intent of matched) {
    for (const id of intent.items) {
      if (known.has(id) && !ids.includes(id)) ids.push(id);
    }
  }
  if (ids.length === 0) return null;

  return Object.freeze({
    intents: Object.freeze(matched.map((intent) => intent.id)),
    proposal: Object.freeze({
      items: Object.freeze(ids.map((productId) => Object.freeze({
        productId,
        quantity: 1
      })))
    })
  });
}

const FILLER_WORDS = /^(?:купи(?:ть)?|возьми|взять|нужн[оаы]?|надо|хочу|добавь|ещ[её]|пожалуйста|мне|и|плюс|ну)\s+/;

function splitPhrase(text) {
  return normalize(text)
    .replace(/[;\n]+/g, ",")
    .replace(/\s+(?:и|плюс|а также)\s+/g, ",")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function cleanTerm(segment) {
  let term = segment;
  for (let i = 0; i < 3; i += 1) term = term.replace(FILLER_WORDS, "");
  return term.replace(/[.!?]+$/g, "").trim() || segment;
}

// Segment-by-segment local planning for mixed phrases:
// "молоко и что-нибудь к чаю", "молоко и йогурт", "масло".
// parseSegment is the local basket parser bound to the same catalogue.
export function planLocalSegments(text, catalogSnapshot, parseSegment) {
  const segments = splitPhrase(text);
  if (segments.length === 0 || typeof parseSegment !== "function") return null;

  const quantities = new Map();
  const add = (productId, quantity) => {
    quantities.set(productId, Math.min(99, (quantities.get(productId) ?? 0) + quantity));
  };

  const intents = [];
  const unresolvedTerms = [];
  const ambiguous = [];
  const packNotes = [];
  const byId = new Map(catalogSnapshot.map((product) => [product.id, product]));

  for (const segment of segments) {
    const parsed = parseSegment(segment);

    if (parsed?.kind === "local") {
      for (const item of parsed.proposal.items) add(item.productId, item.quantity);
      continue;
    }

    const planned = planLocalIntentBasket(segment, catalogSnapshot);
    if (planned) {
      intents.push(...planned.intents);
      for (const item of planned.proposal.items) add(item.productId, item.quantity);
      continue;
    }

    if (
      parsed?.kind === "fallback"
      && parsed.reason === "ambiguous_segment"
      && Array.isArray(parsed.candidateIds)
    ) {
      const candidates = parsed.candidateIds.filter((id) => byId.has(id));
      if (candidates.length > 0) {
        // Several catalogue identities match the same human term. Keep the
        // alternatives for the UI, but never smuggle the first one into a
        // draft basket: catalogue order is not user intent.
        ambiguous.push(Object.freeze({
          term: cleanTerm(segment),
          options: Object.freeze(candidates.map((id) => byId.get(id).name))
        }));
        continue;
      }
    }

    if (parsed?.kind === "fallback" && parsed.reason === "unit_quantity_ambiguous") {
      // "три яйца", "10 яиц": the product is sold as a pack — add one pack
      // and tell the user instead of guessing a count.
      const withoutCount = segment
        .replace(/(?:^|\s)(?:\d{1,3}|десят(?:ок|ка)|одн[аоу]?|один|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|дюжин[ау])(?=\s|$)/g, " ")
        .replace(/\s+(?:шт|штук[аи]?)\.?(?=\s|$)/g, " ")
        .trim();
      const reparsed = withoutCount ? parseSegment(withoutCount) : null;
      const only = reparsed?.kind === "local" && reparsed.proposal.items.length === 1
        ? reparsed.proposal.items[0]
        : null;
      if (only && byId.has(only.productId)) {
        add(only.productId, 1);
        const product = byId.get(only.productId);
        packNotes.push(Object.freeze({
          term: cleanTerm(segment),
          productName: product.name,
          unit: product.unit
        }));
        continue;
      }
    }

    if (parsed?.kind === "fallback" && parsed.reason === "semantic_intent") {
      // Unknown meal/occasion ("что-нибудь вкусное") — only AI can help.
      return Object.freeze({ needsAi: true });
    }

    if (parsed?.kind === "fallback" && parsed.reason !== "unresolved_segment") {
      // Quantities, corrections, store names etc. keep the original handling.
      return Object.freeze({ needsAi: true });
    }

    unresolvedTerms.push(cleanTerm(segment));
  }

  return Object.freeze({
    needsAi: false,
    intents: Object.freeze(intents),
    unresolvedTerms: Object.freeze(unresolvedTerms),
    ambiguous: Object.freeze(ambiguous),
    packNotes: Object.freeze(packNotes),
    proposal: Object.freeze({
      items: Object.freeze([...quantities].map(([productId, quantity]) => Object.freeze({
        productId,
        quantity
      })))
    })
  });
}
