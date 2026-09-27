export const MAX_ALIAS_BUNDLE_RECORDS = 500;
export const MAX_ALIAS_BUNDLE_ALIASES_PER_RECORD = 16;
export const MAX_ALIAS_BUNDLE_ALIAS_LENGTH = 80;
export const MAX_ALIAS_BUNDLE_SOURCE_LENGTH = 40;

const ALIAS_RECORD_KEYS = Object.freeze([
  "aliases",
  "productId",
  "source"
]);

function exactKeys(value) {
  return Object.keys(value).sort();
}

function sameKeys(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizeAlias(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSource(value) {
  const source = String(value ?? "").trim();
  if (
    !source
    || source.length > MAX_ALIAS_BUNDLE_SOURCE_LENGTH
    || !/^[a-z0-9][a-z0-9._-]*$/i.test(source)
  ) {
    throw new TypeError("catalog alias source is invalid");
  }
  return source;
}

function normalizeRecord(record) {
  if (
    record === null
    || typeof record !== "object"
    || Array.isArray(record)
    || !sameKeys(exactKeys(record), ALIAS_RECORD_KEYS)
    || typeof record.productId !== "string"
    || record.productId.trim() !== record.productId
    || record.productId === ""
    || !Array.isArray(record.aliases)
  ) {
    throw new TypeError("catalog alias record is invalid");
  }

  const aliases = [...new Set(
    record.aliases
      .filter((alias) => typeof alias === "string")
      .map(normalizeAlias)
      .filter(Boolean)
      .filter((alias) => alias.length <= MAX_ALIAS_BUNDLE_ALIAS_LENGTH)
  )]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_ALIAS_BUNDLE_ALIASES_PER_RECORD);

  if (aliases.length === 0) {
    throw new TypeError("catalog alias record has no usable aliases");
  }

  return Object.freeze({
    productId: record.productId,
    aliases: Object.freeze(aliases),
    source: normalizeSource(record.source)
  });
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new TypeError("catalog alias bundle requires a non-empty catalog");
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
      throw new TypeError("catalog alias bundle catalog is invalid");
    }
    seen.add(product.id);
    return product;
  });
}

export function attachCatalogAliases(catalog, records) {
  const normalizedCatalog = normalizeCatalog(catalog);

  if (!Array.isArray(records)) {
    throw new TypeError("catalog alias bundle records must be an array");
  }
  if (records.length > MAX_ALIAS_BUNDLE_RECORDS) {
    throw new RangeError("catalog alias bundle is too large");
  }

  const currentIds = new Set(normalizedCatalog.map((product) => product.id));
  const aliasSourcesByProduct = new Map();

  for (const rawRecord of records) {
    const record = normalizeRecord(rawRecord);

    if (!currentIds.has(record.productId)) {
      continue;
    }

    const aliasSources = aliasSourcesByProduct.get(record.productId) ?? new Map();
    for (const alias of record.aliases) {
      const sources = aliasSources.get(alias) ?? new Set();
      sources.add(record.source);
      aliasSources.set(alias, sources);
    }
    aliasSourcesByProduct.set(record.productId, aliasSources);
  }

  return Object.freeze(normalizedCatalog.map((product) => {
    const combined = new Map();

    if (Array.isArray(product.aliases)) {
      for (const rawAlias of product.aliases) {
        if (typeof rawAlias !== "string") continue;
        const alias = normalizeAlias(rawAlias);
        if (!alias) continue;
        const sources = combined.get(alias) ?? new Set();
        sources.add("catalog");
        combined.set(alias, sources);
      }
    }

    for (const [alias, sources] of aliasSourcesByProduct.get(product.id) ?? []) {
      const bucket = combined.get(alias) ?? new Set();
      for (const source of sources) bucket.add(source);
      combined.set(alias, bucket);
    }

    const aliases = [...combined.keys()]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, MAX_ALIAS_BUNDLE_ALIASES_PER_RECORD);

    const aliasProvenance = aliases.map((alias) => Object.freeze({
      alias,
      sources: Object.freeze([...combined.get(alias)].sort())
    }));

    return Object.freeze({
      ...product,
      ...(aliases.length > 0
        ? {
            aliases: Object.freeze(aliases),
            aliasProvenance: Object.freeze(aliasProvenance)
          }
        : {})
    });
  }));
}
