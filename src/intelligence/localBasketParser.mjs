import {
  LOCAL_BASKET_PREFLIGHT,
  preflightLocalBasketText
} from "./localBasketPreflight.mjs";

export const LOCAL_BASKET_DECISION = Object.freeze({
  LOCAL: "local",
  FALLBACK: "fallback",
  REJECT: "reject"
});

export const LOCAL_BASKET_CONFIDENCE = Object.freeze({
  HIGH: "high"
});

export const MAX_LOCAL_BASKET_TEXT_LENGTH = 300;
export const MAX_CATALOG_ALIASES_PER_PRODUCT = 16;
export const MAX_CATALOG_ALIAS_LENGTH = 80;

const QUANTITY_WORDS = Object.freeze(new Map([
  ["один", 1], ["одна", 1], ["одно", 1], ["одну", 1],
  ["два", 2], ["две", 2], ["пара", 2], ["пару", 2],
  ["три", 3], ["четыре", 4], ["пять", 5], ["шесть", 6],
  ["семь", 7], ["восемь", 8], ["девять", 9], ["десять", 10],
  ["десяток", 10], ["одиннадцать", 11], ["двенадцать", 12],
  ["тринадцать", 13], ["четырнадцать", 14], ["пятнадцать", 15],
  ["шестнадцать", 16], ["семнадцать", 17], ["восемнадцать", 18],
  ["девятнадцать", 19], ["двадцать", 20]
]));

const FILLER_WORDS = new Set([
  "добавь", "добавить", "возьми", "взять", "мне", "нужно", "надо",
  "хочу", "пожалуйста", "еще", "ещё", "и", "плюс", "давай", "купить",
  "купи", "беру", "берем", "берём", "пж", "плиз", "короче", "кароч",
  "эээ", "эм", "ну", "бля", "потом", "слушай", "смотри", "короч",
  "вообще", "типа", "ага", "братан", "бро", "дружище",
  "привет", "приветик", "здарова", "здорово"
]);

const PACKAGE_WORDS = new Set([
  "шт", "штука", "штуки", "штук", "пачка", "пачки", "пачек", "упаковка",
  "упаковки", "упаковок", "бутылка", "бутылки", "бутылок", "пакет", "пакета",
  "пакетов"
]);

const CONTAINER_PACKAGE_WORDS = new Set([
  "пачка", "пачки", "пачек", "упаковка", "упаковки", "упаковок",
  "бутылка", "бутылки", "бутылок", "пакет", "пакета", "пакетов"
]);

const SPEC_WORDS = new Set([
  "г", "гр", "кг", "мл", "л", "процент", "процента", "процентов"
]);

const IRREGULAR_STEM_EQUIVALENTS = Object.freeze(new Map([
  ["яиц", "яйц"]
]));

const RUSSIAN_ENDINGS = Object.freeze([
  "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими", "ее", "ие", "ые",
  "ое", "ая", "яя", "ый", "ий", "ой", "ей", "ам", "ям", "ах", "ях", "ов", "ев",
  "ом", "ем", "ую", "юю", "а", "я", "ы", "и", "у", "ю", "е", "о"
]);

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(value) {
  return normalizeText(value).replace(/^[^a-zа-я0-9]+|[^a-zа-я0-9]+$/gi, "");
}

function stemRussianToken(value) {
  const token = normalizeToken(value);
  if (!token || /\d/.test(token) || token.length <= 3) return token;

  for (const ending of RUSSIAN_ENDINGS) {
    if (token.endsWith(ending) && token.length - ending.length >= 3) {
      return token.slice(0, -ending.length);
    }
  }

  return token;
}

function isSpecificationToken(token) {
  return SPEC_WORDS.has(token)
    || /^\d+(?:[.,]\d+)?%$/.test(token)
    || /^[a-zа-я]*\d+[a-zа-я0-9-]*$/i.test(token);
}

function hasExplicitIdentitySpecification(value) {
  const text = normalizeText(value);
  const withoutCompactPieceQuantities = text.replace(
    /(?:^|\s)\d{1,2}\s*(?:шт|штук|штуки|штука)\.?(?=$|\s)/gi,
    " "
  );

  return /(?:^|[^a-zа-я0-9])\d+(?:[.,]\d+)?\s*(?:%|процент(?:а|ов)?|г|гр|кг|мл|л)(?=$|[^a-zа-я0-9])/i.test(text)
    || /(?:^|[^a-zа-я0-9])[a-zа-я]\s*-?\s*\d+(?=$|[^a-zа-я0-9])/i.test(text)
    || /(?:^|[^a-zа-я0-9])(?:\d+[a-zа-я][a-zа-я0-9-]*|[a-zа-я]+\d+[a-zа-я0-9-]*)(?=$|[^a-zа-я0-9])/i.test(
      withoutCompactPieceQuantities
    )
    || /(?:№|#)\s*\d+/i.test(text)
    || /(?:^|\s)\d+\s*-\s*[a-zа-я]+(?=$|\s)/i.test(text);
}

function multiPieceUnitCount(value) {
  const match = normalizeText(value).match(/^(\d{1,3})\s*шт\.?$/i);
  if (!match) return null;

  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count > 1 ? count : null;
}

function hasExplicitContainerPackageWord(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map(normalizeToken)
    .some((token) => CONTAINER_PACKAGE_WORDS.has(token));
}

function wholeCatalogUnitQuantity(segment, candidate) {
  const text = normalizeText(segment);
  const matches = [...text.matchAll(/(?:^|\s)(\d{1,2})\s*(кг|л)(?=$|\s)/gi)];
  if (matches.length !== 1) return null;

  const quantity = Number(matches[0][1]);
  const unit = matches[0][2].toLocaleLowerCase("ru-RU");
  if (
    !Number.isSafeInteger(quantity)
    || quantity < 1
    || quantity > 99
    || candidate?.unit !== `1 ${unit}`
  ) {
    return null;
  }

  const withoutMeasure = text.replace(
    /(?:^|\s)\d{1,2}\s*(?:кг|л)(?=$|\s)/i,
    " "
  );
  if (hasExplicitIdentitySpecification(withoutMeasure)) return null;

  return quantity;
}

const CYRILLIC_TO_LATIN = Object.freeze({
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch",
  ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
});

const CYRILLIC_TO_ENGLISH_KEY = Object.freeze({
  й: "q", ц: "w", у: "e", к: "r", е: "t", н: "y", г: "u", ш: "i",
  щ: "o", з: "p", х: "[", ъ: "]", ф: "a", ы: "s", в: "d", а: "f",
  п: "g", р: "h", о: "j", л: "k", д: "l", ж: ";", э: "'", я: "z",
  ч: "x", с: "c", м: "v", и: "b", т: "n", ь: "m", б: ",", ю: "."
});

function mapRussianCharacters(value, table) {
  return normalizeText(value)
    .split("")
    .map((char) => table[char] ?? char)
    .join("");
}

function transliterateRussian(value) {
  return mapRussianCharacters(value, CYRILLIC_TO_LATIN);
}

function russianTypedOnEnglishKeyboard(value) {
  return mapRussianCharacters(value, CYRILLIC_TO_ENGLISH_KEY);
}

function catalogNameStems(name) {
  return new Set(
    normalizeText(name)
      .split(/\s+/)
      .map(normalizeToken)
      .filter(Boolean)
      .filter((token) => !isSpecificationToken(token))
      .map(stemRussianToken)
      .filter(Boolean)
  );
}

function normalizeAliases(product) {
  if (!Array.isArray(product.aliases)) return [];

  return [...new Set(
    product.aliases
      .filter((alias) => typeof alias === "string")
      .map((alias) => normalizeText(alias))
      .filter(Boolean)
      .filter((alias) => alias.length <= MAX_CATALOG_ALIAS_LENGTH)
  )]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_CATALOG_ALIASES_PER_PRODUCT);
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new TypeError("local basket parser requires a non-empty catalog");
  }

  const seen = new Set();
  return catalog.map((product) => {
    if (
      product === null
      || typeof product !== "object"
      || Array.isArray(product)
      || typeof product.id !== "string"
      || product.id.trim() !== product.id
      || product.id === ""
      || typeof product.name !== "string"
      || product.name.trim() === ""
      || seen.has(product.id)
    ) {
      throw new TypeError("local basket parser catalog is invalid");
    }

    seen.add(product.id);
    const baseTermValues = [product.name, ...normalizeAliases(product)];
    const termValues = [...new Set(
      baseTermValues.flatMap((term) => [
        term,
        transliterateRussian(term),
        russianTypedOnEnglishKeyboard(term)
      ])
    )];
    const terms = termValues
      .map(catalogNameStems)
      .filter((stems) => stems.size > 0);

    return Object.freeze({
      id: product.id,
      name: product.name,
      unit: typeof product.unit === "string"
        ? normalizeText(product.unit)
        : "",
      terms: Object.freeze(terms)
    });
  });
}

function splitSegments(text) {
  return text
    .replace(/[;\n]+/g, ",")
    .replace(/\s+(?:и|плюс)\s+/g, ",")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function quantityFromToken(token) {
  if (/^\d{1,2}$/.test(token)) {
    const value = Number(token);
    return value >= 1 && value <= 99 ? value : null;
  }
  return QUANTITY_WORDS.get(token) ?? null;
}

function isBareIntegerToken(token) {
  return /^\d+$/.test(token);
}

function extractQuantity(tokens) {
  if (tokens.length === 0) {
    return { quantity: 1, tokens, explicit: false, invalidQuantity: false };
  }

  const first = quantityFromToken(tokens[0]);
  if (first !== null) {
    return {
      quantity: first,
      tokens: tokens.slice(1),
      explicit: true,
      invalidQuantity: false
    };
  }
  if (isBareIntegerToken(tokens[0])) {
    return { quantity: 1, tokens, explicit: true, invalidQuantity: true };
  }

  const last = quantityFromToken(tokens.at(-1));
  if (last !== null) {
    return {
      quantity: last,
      tokens: tokens.slice(0, -1),
      explicit: true,
      invalidQuantity: false
    };
  }
  if (isBareIntegerToken(tokens.at(-1))) {
    return { quantity: 1, tokens, explicit: true, invalidQuantity: true };
  }

  if (tokens.length >= 2 && PACKAGE_WORDS.has(tokens.at(-1))) {
    const beforePackage = quantityFromToken(tokens.at(-2));
    if (beforePackage !== null) {
      return {
        quantity: beforePackage,
        tokens: tokens.slice(0, -2),
        explicit: true,
        invalidQuantity: false
      };
    }
    if (isBareIntegerToken(tokens.at(-2))) {
      return { quantity: 1, tokens, explicit: true, invalidQuantity: true };
    }
  }

  return { quantity: 1, tokens, explicit: false, invalidQuantity: false };
}

function meaningfulStems(segment) {
  const normalizedSegment = normalizeText(segment);
  const hasNegativeQuantity = /(?:^|\s)-+\s*\d+(?:$|\s)/.test(
    normalizedSegment
  );
  const hasMalformedSignedQuantity = /(?:^|\s)[+-](?:\s*[+-])+\s*\d+(?:$|\s)/.test(
    normalizedSegment
  );

  const rawTokens = normalizedSegment
    .replace(/\d+(?:[.,]\d+)?\s*%/g, " ")
    .split(/\s+/)
    .flatMap((token) => {
      const normalizedToken = normalizeToken(token);
      const compactPiece = normalizedToken.match(
        /^(\d{1,2})(шт|штук|штуки|штука)$/i
      );
      return compactPiece
        ? [compactPiece[1], compactPiece[2]]
        : [normalizedToken];
    })
    .filter(Boolean);

  const tokensWithoutFillers = rawTokens
    .filter((token) => !FILLER_WORDS.has(token));
  const {
    quantity,
    tokens,
    explicit,
    invalidQuantity
  } = extractQuantity(tokensWithoutFillers);
  const orderedStems = tokens
    .filter((token) => !PACKAGE_WORDS.has(token))
    .filter((token) => !isSpecificationToken(token))
    .map(stemRussianToken)
    .filter(Boolean);

  return {
    quantity,
    explicitQuantity: explicit,
    invalidQuantity:
      invalidQuantity
      || hasNegativeQuantity
      || hasMalformedSignedQuantity,
    stems: [...new Set(orderedStems)],
    orderedStems
  };
}

function oneEditOrTranspositionApart(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;

  if (left.length === right.length) {
    const mismatches = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) mismatches.push(index);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    return mismatches.length === 2
      && mismatches[1] === mismatches[0] + 1
      && left[mismatches[0]] === right[mismatches[1]]
      && left[mismatches[1]] === right[mismatches[0]];
  }

  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let i = 0;
  let j = 0;
  let skipped = false;

  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j += 1;
  }

  return true;
}

function normalizeIrregularStem(stem) {
  return IRREGULAR_STEM_EQUIVALENTS.get(stem) ?? stem;
}

function stemMatchesExact(queryStem, productStem) {
  return normalizeIrregularStem(queryStem) === normalizeIrregularStem(productStem);
}

function stemMatchesSingleTokenTypo(queryStem, productStem) {
  const query = normalizeIrregularStem(queryStem);
  const product = normalizeIrregularStem(productStem);
  if (query === product) return true;
  if (query.length < 3 || product.length < 3) return false;
  return oneEditOrTranspositionApart(query, product);
}

function productMatchesExactStems(product, stems) {
  return product.terms.some((term) => (
    stems.every((stem) => [...term].some((productStem) => (
      stemMatchesExact(stem, productStem)
    )))
  ));
}

function productMatchesSingleTokenTypo(product, stem) {
  return product.terms.some((term) => (
    [...term].some((productStem) => (
      stemMatchesSingleTokenTypo(stem, productStem)
    ))
  ));
}

function productMatchesAnchoredAbbreviation(product, stems) {
  if (stems.length < 2) return false;

  return product.terms.some((term) => {
    let anchored = 0;

    const allMatched = stems.every((stem) => [...term].some((productStem) => {
      if (stemMatchesExact(stem, productStem)) {
        anchored += 1;
        return true;
      }

      return stem.length >= 3
        && productStem.startsWith(stem)
        && productStem.length - stem.length <= 3;
    }));

    return allMatched && anchored >= 1;
  });
}

function productMatchesOneTypoWithAnchor(product, stems) {
  if (stems.length < 2) return false;

  return product.terms.some((term) => {
    const productStems = [...term];
    const used = new Set();
    let exactCount = 0;
    let typoCount = 0;

    for (const queryStem of stems) {
      let matchIndex = productStems.findIndex((productStem, index) => (
        !used.has(index) && stemMatchesExact(queryStem, productStem)
      ));

      if (matchIndex >= 0) {
        used.add(matchIndex);
        exactCount += 1;
        continue;
      }

      matchIndex = productStems.findIndex((productStem, index) => (
        !used.has(index) && stemMatchesSingleTokenTypo(queryStem, productStem)
      ));

      if (matchIndex < 0) return false;
      used.add(matchIndex);
      typoCount += 1;
      if (typoCount > 1) return false;
    }

    return exactCount >= 1 && typoCount <= 1;
  });
}

function candidatesForSegment(segment, catalog) {
  const parsed = meaningfulStems(segment);
  const identitySpecification = hasExplicitIdentitySpecification(segment);

  if (parsed.stems.length === 0) {
    return { ...parsed, identitySpecification, candidates: [] };
  }

  let candidates = catalog.filter((product) => (
    productMatchesExactStems(product, parsed.stems)
  ));

  if (candidates.length === 0 && parsed.stems.length === 1) {
    candidates = catalog.filter((product) => (
      productMatchesSingleTokenTypo(product, parsed.stems[0])
    ));
  }

  if (candidates.length === 0 && parsed.stems.length >= 2) {
    candidates = catalog.filter((product) => (
      productMatchesAnchoredAbbreviation(product, parsed.stems)
    ));
  }

  if (candidates.length === 0 && parsed.stems.length >= 2) {
    candidates = catalog.filter((product) => (
      productMatchesOneTypoWithAnchor(product, parsed.stems)
    ));
  }

  return { ...parsed, identitySpecification, candidates };
}

function parseUniqueWhitespaceList(text, catalog) {
  if (/[;,\n]/.test(text) || /\d/.test(text)) return null;

  const tokens = normalizeText(text).split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 10) return null;

  const solutions = [];
  const walk = (index, parts) => {
    if (solutions.length > 4) return;
    if (index === tokens.length) {
      if (parts.length >= 2) solutions.push(parts);
      return;
    }

    const maxEnd = Math.min(tokens.length, index + 4);
    for (let end = index + 1; end <= maxEnd; end += 1) {
      const phrase = tokens.slice(index, end).join(" ");
      const match = candidatesForSegment(phrase, catalog);
      if (
        match.identitySpecification
        || match.invalidQuantity
        || match.explicitQuantity
        || match.candidates.length !== 1
        || hasAmbiguousUnitQuantity(phrase, match)
      ) {
        continue;
      }

      walk(end, [...parts, match.candidates[0].id]);
    }
  };

  walk(0, []);

  const unique = new Map();
  for (const ids of solutions) unique.set(ids.join("\u0000"), ids);
  if (unique.size !== 1) return null;

  const [ids] = unique.values();
  const totals = new Map();
  for (const productId of ids) {
    const quantity = (totals.get(productId) ?? 0) + 1;
    if (quantity > 99) return null;
    totals.set(productId, quantity);
  }
  return totals;
}

function hasAmbiguousUnitQuantity(segment, match) {
  if (
    match.explicitQuantity !== true
    || match.candidates.length !== 1
    || hasExplicitContainerPackageWord(segment)
  ) {
    return false;
  }

  return multiPieceUnitCount(match.candidates[0].unit) !== null;
}

const CORRECTION_SIGNAL = /(?:^|[\s,])(?:нет|стоп|хотя|убери|отмена|только)(?:$|[\s,])|(?:^|[\s,])не\s+надо(?:$|[\s,])/i;

function singleCorrectionTarget(text, catalog) {
  const match = candidatesForSegment(text, catalog);

  if (match.invalidQuantity || match.identitySpecification) {
    return Object.freeze({ kind: "invalid" });
  }

  if (match.stems.length === 0 && match.explicitQuantity) {
    return Object.freeze({
      kind: "quantity_only",
      quantity: match.quantity
    });
  }

  if (match.candidates.length !== 1) {
    return Object.freeze({ kind: "unresolved" });
  }

  if (hasAmbiguousUnitQuantity(text, match)) {
    return Object.freeze({ kind: "invalid" });
  }

  return Object.freeze({
    kind: "item",
    productId: match.candidates[0].id,
    quantity: match.quantity,
    explicitQuantity: match.explicitQuantity
  });
}

function onlyProductId(totals) {
  if (totals.size !== 1) return null;
  return totals.keys().next().value ?? null;
}

function setExistingTarget(totals, target) {
  if (target.kind === "quantity_only") {
    const productId = onlyProductId(totals);
    if (!productId) return false;
    totals.set(productId, target.quantity);
    return true;
  }

  if (target.kind !== "item" || !totals.has(target.productId)) {
    return false;
  }

  totals.set(target.productId, target.quantity);
  return true;
}

function addOrdinaryCorrectionClause(clause, catalog, totals) {
  const segments = splitSegments(clause);
  if (segments.length === 0) return false;

  for (const segment of segments) {
    const match = candidatesForSegment(segment, catalog);
    if (
      match.invalidQuantity
      || match.identitySpecification
      || match.candidates.length !== 1
      || hasAmbiguousUnitQuantity(segment, match)
    ) {
      return false;
    }

    const productId = match.candidates[0].id;
    const nextQuantity = (totals.get(productId) ?? 0) + match.quantity;
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity > 99) {
      return false;
    }
    totals.set(productId, nextQuantity);
  }

  return true;
}

function parseInlineCorrections(text, catalog) {
  if (!CORRECTION_SIGNAL.test(text)) return null;

  const clauses = text
    .split(/\s*,\s*/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  if (clauses.length < 2) {
    return Object.freeze({
      kind: "fallback",
      reason: "context_correction"
    });
  }

  const totals = new Map();
  let pendingStop = false;
  let sawCorrection = false;

  for (const rawClause of clauses) {
    let clause = rawClause.replace(/^и\s+/, "").trim();
    if (!clause) continue;

    if (clause === "стоп") {
      if (!onlyProductId(totals) || pendingStop) {
        return Object.freeze({
          kind: "fallback",
          reason: "context_correction"
        });
      }
      pendingStop = true;
      sawCorrection = true;
      continue;
    }

    let match = clause.match(/^(?:нет\s+лучше|потом\s+нет)\s+(.+)$/);
    if (match) {
      if (!onlyProductId(totals)) {
        return Object.freeze({
          kind: "fallback",
          reason: "context_correction"
        });
      }

      const target = singleCorrectionTarget(match[1], catalog);
      if (target.kind !== "item") {
        return Object.freeze({
          kind: "fallback",
          reason: "context_correction"
        });
      }

      totals.clear();
      totals.set(target.productId, target.quantity);
      pendingStop = false;
      sawCorrection = true;
      continue;
    }

    match = clause.match(/^нет\s+(.+)$/);
    if (match) {
      const target = singleCorrectionTarget(match[1], catalog);
      if (!setExistingTarget(totals, target)) {
        return Object.freeze({
          kind: "fallback",
          reason: "context_correction"
        });
      }
      pendingStop = false;
      sawCorrection = true;
      continue;
    }

    match = clause.match(/^хотя\s+(.+)$/);
    if (match) {
      const target = singleCorrectionTarget(match[1], catalog);
      if (!setExistingTarget(totals, target)) {
        return Object.freeze({
          kind: "fallback",
          reason: "context_correction"
        });
      }
      pendingStop = false;
      sawCorrection = true;
      continue;
    }

    match = clause.match(/^(.+?)\s+(?:не\s+надо|убери|отмена)$/);
    if (match) {
      const target = singleCorrectionTarget(match[1], catalog);
      if (target.kind !== "item" || !totals.has(target.productId)) {
        return Object.freeze({
          kind: "fallback",
          reason: "context_correction"
        });
      }
      totals.delete(target.productId);
      pendingStop = false;
      sawCorrection = true;
      continue;
    }

    match = clause.match(/^(.+?)\s+только\s+(.+)$/);
    if (match) {
      const target = singleCorrectionTarget(
        `${match[1]} ${match[2]}`,
        catalog
      );
      if (!setExistingTarget(totals, target)) {
        return Object.freeze({
          kind: "fallback",
          reason: "context_correction"
        });
      }
      pendingStop = false;
      sawCorrection = true;
      continue;
    }

    if (pendingStop) {
      const target = singleCorrectionTarget(clause, catalog);
      const currentId = onlyProductId(totals);
      if (
        target.kind !== "item"
        || !currentId
        || target.productId !== currentId
      ) {
        return Object.freeze({
          kind: "fallback",
          reason: "context_correction"
        });
      }
      totals.set(target.productId, target.quantity);
      pendingStop = false;
      sawCorrection = true;
      continue;
    }

    if (!addOrdinaryCorrectionClause(clause, catalog, totals)) {
      return Object.freeze({
        kind: "fallback",
        reason: "context_correction"
      });
    }
  }

  if (!sawCorrection || pendingStop || totals.size === 0) {
    return Object.freeze({
      kind: "fallback",
      reason: "context_correction"
    });
  }

  return Object.freeze({
    kind: "resolved",
    totals
  });
}

function proposalFromTotals(totals) {
  const items = [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([productId, quantity]) => Object.freeze({ productId, quantity }));

  return Object.freeze({
    kind: LOCAL_BASKET_DECISION.LOCAL,
    confidence: LOCAL_BASKET_CONFIDENCE.HIGH,
    proposal: Object.freeze({ items: Object.freeze(items) })
  });
}

function fallback(reason, details = {}) {
  return Object.freeze({
    kind: LOCAL_BASKET_DECISION.FALLBACK,
    reason,
    ...details
  });
}

function reject(reason) {
  return Object.freeze({
    kind: LOCAL_BASKET_DECISION.REJECT,
    reason
  });
}

export function parseLocalBasketText(text, catalog) {
  const normalized = normalizeText(
    String(text ?? "").replace(/[;\r\n]+/g, ",")
  );
  if (!normalized) return reject("empty");
  if (normalized.length > MAX_LOCAL_BASKET_TEXT_LENGTH) return reject("too_long");

  const preflight = preflightLocalBasketText(normalized);
  if (preflight.kind === LOCAL_BASKET_PREFLIGHT.REJECT) {
    return reject(preflight.reason);
  }
  if (preflight.kind === LOCAL_BASKET_PREFLIGHT.FALLBACK) {
    return fallback(preflight.reason);
  }

  const normalizedCatalog = normalizeCatalog(catalog);

  const correction = parseInlineCorrections(normalized, normalizedCatalog);
  if (correction?.kind === "fallback") {
    return fallback(correction.reason);
  }
  if (correction?.kind === "resolved") {
    return proposalFromTotals(correction.totals);
  }

  const segments = splitSegments(normalized);
  if (segments.length === 0) return reject("empty");

  const totals = new Map();

  for (const [segmentIndex, segment] of segments.entries()) {
    const match = candidatesForSegment(segment, normalizedCatalog);
    const candidate = match.candidates.length === 1
      ? match.candidates[0]
      : null;
    const measuredQuantity = candidate
      ? wholeCatalogUnitQuantity(segment, candidate)
      : null;

    if (match.identitySpecification && measuredQuantity === null) {
      return fallback("identity_specification", { segmentIndex });
    }

    if (match.invalidQuantity) {
      return fallback("quantity_out_of_range", { segmentIndex });
    }

    if (match.candidates.length === 0) {
      if (segments.length === 1 && segmentIndex === 0) {
        const whitespaceTotals = parseUniqueWhitespaceList(
          segment,
          normalizedCatalog
        );
        if (whitespaceTotals) return proposalFromTotals(whitespaceTotals);
      }
      return fallback("unresolved_segment", { segmentIndex });
    }
    if (match.candidates.length > 1) {
      return fallback("ambiguous_segment", {
        segmentIndex,
        candidateIds: Object.freeze(match.candidates.map((item) => item.id).sort())
      });
    }

    if (hasAmbiguousUnitQuantity(segment, match)) {
      return fallback("unit_quantity_ambiguous", { segmentIndex });
    }

    const productId = candidate.id;
    const quantity = measuredQuantity ?? match.quantity;
    const nextQuantity = (totals.get(productId) ?? 0) + quantity;
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity > 99) {
      return fallback("quantity_out_of_range", { segmentIndex });
    }
    totals.set(productId, nextQuantity);
  }

  return proposalFromTotals(totals);
}

export {
  normalizeText,
  stemRussianToken
};
