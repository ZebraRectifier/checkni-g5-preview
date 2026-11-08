import {
  MAX_CATALOG_SEARCH_QUERY_LENGTH,
  createCatalogProduct
} from "../catalog/productDiscovery.mjs";
import { getRetailerIdentity } from "../data/retailerRegistry.mjs";

export const CATALOG_SEARCH_RESULT_KIND = "catalog-search-result";
export const CATALOG_PROVIDER_STATUS = Object.freeze({
  OK: "ok",
  PARTIAL: "partial",
  ERROR: "error"
});
export const MAX_CATALOG_PROVIDER_ROWS = 200;

const CONTEXT_FIELDS = new Set([
  "countryCode",
  "regionId",
  "localityId",
  "retailerIds"
]);

function canonicalId(value, label) {
  if (
    typeof value !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new TypeError(label + " must be canonical kebab-case");
  }
  return value;
}

function cleanString(value, max = 180) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function normalizeContext(context) {
  if (context == null) return Object.freeze({});
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("catalog search context must be an object");
  }
  if (!Object.keys(context).every((key) => CONTEXT_FIELDS.has(key))) {
    throw new TypeError("catalog search context contains unsupported fields");
  }

  const countryCode = cleanString(context.countryCode, 2);
  const regionId = cleanString(context.regionId, 180);
  const localityId = cleanString(context.localityId, 180);

  if (
    context.countryCode != null
    && (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode))
  ) {
    throw new TypeError("catalog search countryCode is invalid");
  }
  if (context.regionId != null && !regionId) {
    throw new TypeError("catalog search regionId is invalid");
  }
  if (context.localityId != null && !localityId) {
    throw new TypeError("catalog search localityId is invalid");
  }

  let retailerIds = [];
  if (context.retailerIds != null) {
    if (!Array.isArray(context.retailerIds)) {
      throw new TypeError("catalog search retailerIds must be an array");
    }
    retailerIds = Array.from(new Set(context.retailerIds.map((value) => (
      canonicalId(value, "catalog search retailerId")
    )))).sort();

    for (const retailerId of retailerIds) {
      if (!getRetailerIdentity(retailerId)) {
        throw new TypeError("catalog search retailerId is unknown");
      }
    }
  }

  if ((regionId || localityId) && !countryCode) {
    throw new TypeError("catalog search geography requires countryCode");
  }
  if (localityId && !regionId) {
    throw new TypeError("catalog search locality requires regionId");
  }

  return Object.freeze({
    ...(countryCode ? { countryCode: countryCode.toUpperCase() } : {}),
    ...(regionId ? { regionId } : {}),
    ...(localityId ? { localityId } : {}),
    ...(retailerIds.length > 0 ? { retailerIds: Object.freeze(retailerIds) } : {})
  });
}

function normalizeQuery(query) {
  if (
    typeof query !== "string"
    || query.length > MAX_CATALOG_SEARCH_QUERY_LENGTH
  ) {
    return null;
  }
  const normalized = query.trim();
  return normalized || "";
}

function freezeProviderResult(value) {
  return Object.freeze(value);
}

function productKey(product) {
  return [
    product.sourceId ?? "",
    product.retailerId ?? "",
    product.sourceProductId
  ].join("|");
}

function canonicalConflict(left, right) {
  return (
    typeof left.canonicalProductId === "string"
    && typeof right.canonicalProductId === "string"
    && left.canonicalProductId !== right.canonicalProductId
  );
}

function canonicalIdentityMetadataConflict(left, right) {
  if (
    typeof left.canonicalProductId !== "string"
    || left.canonicalProductId !== right.canonicalProductId
    || !left.canonicalIdentity
    || !right.canonicalIdentity
  ) {
    return false;
  }

  return (
    left.canonicalIdentity.id !== right.canonicalIdentity.id
    || left.canonicalIdentity.name !== right.canonicalIdentity.name
    || left.canonicalIdentity.unit !== right.canonicalIdentity.unit
  );
}

function sourcePackageConflict(left, right) {
  return (
    typeof left.unit === "string"
    && typeof right.unit === "string"
    && left.unit !== right.unit
  );
}

function chooseDuplicate(existing, incoming) {
  if (canonicalConflict(existing.product, incoming.product)) {
    return Object.freeze({
      kind: "conflict",
      reason: "conflicting_canonical_mapping"
    });
  }
  if (canonicalIdentityMetadataConflict(existing.product, incoming.product)) {
    return Object.freeze({
      kind: "conflict",
      reason: "conflicting_canonical_identity_metadata"
    });
  }
  if (sourcePackageConflict(existing.product, incoming.product)) {
    return Object.freeze({
      kind: "conflict",
      reason: "conflicting_source_package_metadata"
    });
  }

  if (
    incoming.product.comparisonEligible === true
    && existing.product.comparisonEligible !== true
  ) {
    return Object.freeze({ kind: "selected", entry: incoming });
  }

  return Object.freeze({ kind: "selected", entry: existing });
}

export function defineCatalogSearchProvider({ id, search }) {
  const providerId = canonicalId(id, "catalog search provider id");
  if (typeof search !== "function") {
    throw new TypeError("catalog search provider requires search function");
  }

  return Object.freeze({
    id: providerId,
    search
  });
}

function emptyResult(query, context, providers = []) {
  return Object.freeze({
    kind: CATALOG_SEARCH_RESULT_KIND,
    query,
    context,
    entries: Object.freeze([]),
    products: Object.freeze([]),
    providers: Object.freeze(providers),
    conflicts: Object.freeze([])
  });
}

export function createCatalogSearchPort(providers = []) {
  if (!Array.isArray(providers)) {
    throw new TypeError("catalog search providers must be an array");
  }

  const providerIds = new Set();
  const normalizedProviders = providers.map((provider) => {
    if (
      !provider
      || typeof provider.id !== "string"
      || typeof provider.search !== "function"
    ) {
      throw new TypeError("catalog search provider is invalid");
    }
    canonicalId(provider.id, "catalog search provider id");
    if (providerIds.has(provider.id)) {
      throw new TypeError("duplicate catalog search provider id: " + provider.id);
    }
    providerIds.add(provider.id);
    return provider;
  });

  return Object.freeze({
    providerIds: Object.freeze(normalizedProviders.map((provider) => provider.id)),

    async search(query, context = {}) {
      const normalizedQuery = normalizeQuery(query);
      if (normalizedQuery == null) {
        throw new TypeError("catalog search query is invalid");
      }

      const normalizedContext = normalizeContext(context);
      if (!normalizedQuery || normalizedProviders.length === 0) {
        return emptyResult(normalizedQuery, normalizedContext);
      }

      const settled = await Promise.allSettled(
        normalizedProviders.map((provider) => (
          provider.search(normalizedQuery, normalizedContext)
        ))
      );

      const providerResults = [];
      const deduped = new Map();
      const conflicts = new Map();

      for (let index = 0; index < normalizedProviders.length; index += 1) {
        const provider = normalizedProviders[index];
        const result = settled[index];

        if (result.status === "rejected") {
          providerResults.push(freezeProviderResult({
            providerId: provider.id,
            status: CATALOG_PROVIDER_STATUS.ERROR,
            accepted: 0,
            rejected: 0,
            reason: "provider_error"
          }));
          continue;
        }

        if (!Array.isArray(result.value)) {
          providerResults.push(freezeProviderResult({
            providerId: provider.id,
            status: CATALOG_PROVIDER_STATUS.ERROR,
            accepted: 0,
            rejected: 0,
            reason: "malformed_provider_response"
          }));
          continue;
        }

        if (result.value.length > MAX_CATALOG_PROVIDER_ROWS) {
          providerResults.push(freezeProviderResult({
            providerId: provider.id,
            status: CATALOG_PROVIDER_STATUS.ERROR,
            accepted: 0,
            rejected: result.value.length,
            reason: "provider_response_too_large"
          }));
          continue;
        }

        let accepted = 0;
        let rejected = 0;

        for (const rawProduct of result.value) {
          const normalized = createCatalogProduct(rawProduct);
          if (normalized.kind !== "accepted") {
            rejected += 1;
            continue;
          }

          accepted += 1;
          const entry = Object.freeze({
            providerId: provider.id,
            product: normalized.product
          });
          const key = productKey(normalized.product);

          if (conflicts.has(key)) {
            const currentConflict = conflicts.get(key);
            conflicts.set(key, Object.freeze({
              ...currentConflict,
              providerIds: Object.freeze(
                Array.from(new Set([
                  ...currentConflict.providerIds,
                  provider.id
                ])).sort()
              )
            }));
            continue;
          }

          const existing = deduped.get(key);
          if (!existing) {
            deduped.set(key, entry);
            continue;
          }

          const decision = chooseDuplicate(existing, entry);
          if (decision.kind === "conflict") {
            deduped.delete(key);
            conflicts.set(key, Object.freeze({
              key,
              providerIds: Object.freeze(
                Array.from(new Set([
                  existing.providerId,
                  entry.providerId
                ])).sort()
              ),
              reason: decision.reason
            }));
            continue;
          }

          deduped.set(key, decision.entry);
        }

        providerResults.push(freezeProviderResult({
          providerId: provider.id,
          status: rejected > 0
            ? CATALOG_PROVIDER_STATUS.PARTIAL
            : CATALOG_PROVIDER_STATUS.OK,
          accepted,
          rejected
        }));
      }

      const entries = Array.from(deduped.values()).sort((left, right) => (
        left.providerId.localeCompare(right.providerId, "en")
        || left.product.name.localeCompare(right.product.name, "ru")
        || productKey(left.product).localeCompare(productKey(right.product), "en")
      ));

      return Object.freeze({
        kind: CATALOG_SEARCH_RESULT_KIND,
        query: normalizedQuery,
        context: normalizedContext,
        entries: Object.freeze(entries),
        products: Object.freeze(entries.map((entry) => entry.product)),
        providers: Object.freeze(providerResults),
        conflicts: Object.freeze(Array.from(conflicts.values()).sort(
          (left, right) => left.key.localeCompare(right.key, "en")
        ))
      });
    }
  });
}

// No external catalog provider is trusted/enabled by default.
// The runtime must explicitly inject proven providers.
export const catalogSearchPort = createCatalogSearchPort([]);
