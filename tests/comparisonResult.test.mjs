import test from "node:test";
import assert from "node:assert/strict";
import { markAdmittedMetroCatalogOffer, CATALOG_FRESHNESS_PROOF_KEY } from "../src/observations/retailCatalogFreshnessPolicy.mjs";

import {
  buildObservedResultModel,
  buildWinnerResultModel,
  formatRubMinor
} from "../src/components/ComparisonResult.mjs";

test("formats deterministic minor units as Russian rubles without changing value", () => {
  assert.equal(formatRubMinor(36970), "369,70 ₽");
  assert.equal(formatRubMinor(1000), "10,00 ₽");
  assert.equal(formatRubMinor(0), "0,00 ₽");
  assert.equal(formatRubMinor(null), null);
  assert.equal(formatRubMinor(-1), null);
  assert.equal(formatRubMinor(Number.MAX_SAFE_INTEGER + 1), null);
});

test("saved METRO catalogue displays the original time and explicit one-hour policy without changing Core facts", () => {
  const observedAt = "2026-10-22T17:00:00.000Z"; const nowMs = Date.parse(observedAt) + 12 * 60000;
  const offer = markAdmittedMetroCatalogOffer({ sourceId: "metro-public-live", sourceName: "METRO · публичный каталог",
    sourceUrl: "https://online.metro-cc.ru/products/fixture", observedAt, sourceProductId: "241097",
    canonicalProductId: "milk-25-900", storeId: "metro-address-c5gsqz" });
  const line = { status: "priced-observation", productId: "milk-25-900", observedAt, sourceUrl: offer.sourceUrl,
    unitPriceMinor: 10600, provenance: offer.provenance };
  const candidate = observedCandidate({ sourceId: offer.sourceId, retailerId: "metro", storeId: offer.storeId,
    storeName: "METRO", lines: [line] });
  for (const kind of ["observed-total-only", "cheapest-proven", "lowest-tie", "insufficient-coverage"]) {
    const result = { kind: "observed-price-comparison", candidates: [candidate], conclusion: {
      kind, candidateId: candidate.candidateId, candidateIds: [candidate.candidateId], totalMinor: 10600, savingsMinor: null } };
    const before = structuredClone(result); const model = buildObservedResultModel(result, { nowMs });
    assert.equal(model.catalogueFreshnessLabels.length, 1);
    assert.match(model.catalogueFreshnessLabels[0], /Сохранённые цены METRO/u);
    assert.match(model.catalogueFreshnessLabels[0], /22\.10\.2026, 17:00 UTC/u);
    assert.match(model.catalogueFreshnessLabels[0], /1 час от наблюдения, до 22\.10\.2026, 18:00 UTC/u);
    assert.doesNotMatch(model.catalogueFreshnessLabels[0], /свеж|налич|24 час/iu);
    if (kind !== "insufficient-coverage") assert.equal(model.totalLabel, "106,00 ₽");
    assert.deepEqual(result, before, "presentation cannot recalculate price/winner/coverage");
  }
  for (const marker of [null, {}, { ...offer.provenance.proof[CATALOG_FRESHNESS_PROOF_KEY], storeId: "other" }]) {
    const changed = structuredClone(candidate); changed.lines[0].provenance.proof[CATALOG_FRESHNESS_PROOF_KEY] = marker;
    const model = buildObservedResultModel({ candidates: [changed], conclusion: {
      kind: "observed-total-only", candidateId: changed.candidateId, totalMinor: 10600 } }, { nowMs });
    assert.equal(model.catalogueFreshnessLabels, undefined);
  }
});

test("builds winner-first presentation from CORE result facts only", () => {
  const model = buildWinnerResultModel({
    winner: {
      storeId: "mock-beta",
      storeName: "Mock Beta",
      isMock: true,
      totalMinor: 36970,
      coverage: {
        coveredItems: 3,
        totalItems: 3,
        ratio: 1
      }
    },
    savingsMinor: 1000
  });

  assert.deepEqual(model, {
    storeId: "mock-beta",
    storeName: "Mock Beta",
    isMock: true,
    totalLabel: "369,70 ₽",
    coverageLabel: "3 из 3 позиций",
    savingsLabel: "10,00 ₽",
    actionLabel: "Показать список для этого магазина"
  });
});

test("keeps zero savings visible and does not invent savings when unknown", () => {
  const base = {
    winner: {
      storeId: "mock-beta",
      storeName: "Mock Beta",
      isMock: true,
      totalMinor: 36970,
      coverage: {
        coveredItems: 3,
        totalItems: 3,
        ratio: 1
      }
    }
  };

  assert.equal(
    buildWinnerResultModel({ ...base, savingsMinor: 0 }).savingsLabel,
    "0,00 ₽"
  );
  assert.equal(
    buildWinnerResultModel({ ...base, savingsMinor: null }).savingsLabel,
    null
  );
});

test("does not fabricate a winner presentation when CORE has no complete winner", () => {
  assert.equal(buildWinnerResultModel({ winner: null, savingsMinor: null }), null);
});


test("rejects unsafe commercial minor-unit values instead of formatting fabricated money", () => {
  assert.equal(
    buildWinnerResultModel({
      winner: {
        storeId: "mock-beta",
        storeName: "Mock Beta",
        isMock: true,
        totalMinor: Number.MAX_SAFE_INTEGER + 1,
        coverage: { coveredItems: 3, totalItems: 3, ratio: 1 }
      },
      savingsMinor: 1000
    }),
    null
  );
});


function observedCandidate(overrides = {}) {
  return {
    candidateId: "store:store-location-a",
    candidateName: "Магазин A",
    sourceId: "source-a",
    sourceName: "Источник A",
    sources: [{ sourceId: "source-a", sourceName: "Источник A" }],
    storeId: "store-a",
    storeName: "Магазин A",
    locationTruthLevel: "store",
    countryCode: "RU",
    regionId: "region-02",
    regionName: "Республика Башкортостан",
    localityId: "locality-ufa",
    localityName: "Уфа",
    availability: "unknown",
    priceCoverage: { coveredItems: 1, totalItems: 1, ratio: 1 },
    lines: [{
      observedAt: "2026-09-21T18:20:00.000Z"
    }],
    ...overrides
  };
}

test("builds cheapest-proven observed presentation only from Core conclusion", () => {
  const model = buildObservedResultModel({
    kind: "observed-price-comparison",
    candidates: [observedCandidate()],
    conclusion: {
      kind: "cheapest-proven",
      candidateId: "store:store-location-a",
      totalMinor: 10000,
      savingsMinor: 1500
    }
  });

  assert.deepEqual(model, {
    kind: "cheapest-proven",
    candidateId: "store:store-location-a",
    title: "Магазин A",
    totalLabel: "100,00 ₽",
    coverageLabel: "1 из 1 позиций",
    savingsLabel: "15,00 ₽",
    sourceLabel: "Источник A",
    geographyLabel: "Уфа · Республика Башкортостан",
    observedAtLabel: "21.09.2026, 18:20 UTC",
    truthLevelLabel: "точка магазина",
    availabilityLabel: "Наличие не подтверждено"
  });
});

test("observed presentation exposes the full observation-time range instead of only the freshest line", () => {
  const model = buildObservedResultModel({
    kind: "observed-price-comparison",
    candidates: [observedCandidate({
      priceCoverage: { coveredItems: 2, totalItems: 2, ratio: 1 },
      lines: [
        { observedAt: "2026-09-21T18:05:00.000Z" },
        { observedAt: "2026-09-21T18:20:00.000Z" }
      ]
    })],
    conclusion: {
      kind: "observed-total-only",
      candidateId: "store:store-location-a",
      totalMinor: 20000,
      savingsMinor: null
    }
  });

  assert.equal(
    model.observedAtLabel,
    "21.09.2026, 18:05 UTC — 21.09.2026, 18:20 UTC"
  );
});

test("observed tie is rendered as equal minimum without savings or cheapest wording", () => {
  const model = buildObservedResultModel({
    kind: "observed-price-comparison",
    candidates: [
      observedCandidate({
        candidateId: "store:store-location-a",
        storeName: "Магазин A",
        candidateName: "Магазин A"
      }),
      observedCandidate({
        candidateId: "store:store-location-b",
        storeId: "store-b",
        storeName: "Магазин B",
        candidateName: "Магазин B"
      })
    ],
    conclusion: {
      kind: "lowest-tie",
      reason: "equal_lowest_total",
      candidateId: null,
      candidateIds: ["store:store-location-a", "store:store-location-b"],
      totalMinor: 10000,
      savingsMinor: null
    }
  });

  assert.deepEqual(model, {
    kind: "lowest-tie",
    title: "Одинаковая минимальная сумма",
    totalLabel: "100,00 ₽",
    tiedNames: ["Магазин A", "Магазин B"],
    savingsLabel: null,
    note: "Несколько полных сопоставимых вариантов стоят одинаково. Одного варианта «дешевле» нет, поэтому экономию не показываем."
  });
});

test("observed-total-only never fabricates cheapest or savings copy", () => {
  const model = buildObservedResultModel({
    kind: "observed-price-comparison",
    candidates: [observedCandidate()],
    conclusion: {
      kind: "observed-total-only",
      candidateId: "store:store-location-a",
      totalMinor: 10000,
      savingsMinor: null
    }
  });

  assert.equal(model.kind, "observed-total-only");
  assert.equal(model.totalLabel, "100,00 ₽");
  assert.equal(model.savingsLabel, null);
});

test("observed total exposes loyalty price condition instead of presenting it as unconditional", () => {
  const model = buildObservedResultModel({
    kind: "observed-price-comparison",
    candidates: [observedCandidate({
      priceConditions: ["loyalty"]
    })],
    conclusion: {
      kind: "observed-total-only",
      candidateId: "store:store-location-a",
      totalMinor: 10000,
      savingsMinor: null
    }
  });

  assert.equal(model.priceConditionLabel, "Цена по программе лояльности");
});

test("observed Lenta result exposes only verified public navigation", () => {
  const model = buildObservedResultModel({
    kind: "observed-price-comparison",
    candidates: [observedCandidate({
      retailerId: "lenta",
      retailerName: "Лента",
      storeName: "Лента"
    })],
    conclusion: {
      kind: "observed-total-only",
      candidateId: "store:store-location-a",
      totalMinor: 10000,
      savingsMinor: null
    }
  });

  assert.deepEqual(model.navigation, {
    retailerId: "lenta",
    retailerName: "Лента",
    kind: "official-public-url",
    url: "https://lenta.com/",
    label: "Открыть Ленту",
    capabilities: {
      affiliate: false,
      basketPrefill: false,
      checkout: false,
      orderPlacement: false,
      stockTruth: false
    }
  });
});

test("conditional-price insufficiency explains why cheapest is withheld", () => {
  assert.deepEqual(
    buildObservedResultModel({
      kind: "observed-price-comparison",
      candidates: [],
      conclusion: {
        kind: "insufficient-coverage",
        reason: "conditional_price_context",
        candidateId: null,
        totalMinor: null,
        savingsMinor: null
      }
    }),
    {
      kind: "insufficient-coverage",
      title: "Недостаточно данных для «дешевле»",
      note: "Есть полные суммы, но часть цен зависит от акции или программы лояльности. CHECKNI не называет один вариант дешевле, пока условия цены не сопоставимы.",
      confirmedCandidates: []
    }
  );
});

test("insufficient observed result remains explicit and mock-free", () => {
  assert.deepEqual(
    buildObservedResultModel({
      kind: "observed-price-comparison",
      candidates: [],
      conclusion: {
        kind: "insufficient-coverage",
        reason: "no_complete_candidate",
        candidateId: null,
        totalMinor: null,
        savingsMinor: null
      }
    }),
    {
      kind: "insufficient-coverage",
      title: "Недостаточно данных для «дешевле»",
      note: "Пока нет полного реального покрытия корзины. MOCK-цены сюда не подставляем.",
      confirmedCandidates: []
    }
  );
});


test("incomplete observed result preserves verified unit prices without claiming a winner", () => {
  const model = buildObservedResultModel({
    kind: "observed-price-comparison",
    candidates: [observedCandidate({
      storeName: "METRO",
      lines: [
        {
          productId: "dobry-cola-1l",
          status: "priced-observation",
          unitPriceMinor: 14500,
          observedAt: "2026-09-28T02:00:00.000Z"
        },
        {
          productId: "dobry-lemon-lime-1l",
          status: "priced-observation",
          unitPriceMinor: 14500,
          observedAt: "2026-09-28T02:00:00.000Z"
        }
      ]
    })],
    conclusion: {
      kind: "insufficient-coverage",
      reason: "no_complete_candidate",
      candidateId: null,
      totalMinor: null,
      savingsMinor: null
    }
  });

  assert.deepEqual(model.confirmedCandidates, [{
    title: "METRO",
    prices: [
      { productId: "dobry-cola-1l", priceLabel: "145,00 ₽", observedAtLabel: "28.09.2026, 02:00 UTC" },
      { productId: "dobry-lemon-lime-1l", priceLabel: "145,00 ₽", observedAtLabel: "28.09.2026, 02:00 UTC" }
    ]
  }]);
  assert.equal(model.title, "Недостаточно данных для «дешевле»");
});

test("partial prices use exact Core basket names and preserve observation dates", () => {
  const result = { basket: [{ product: { id: "butter-825-180",
    name: "Масло сливочное Брест-Литовск 82,5%", unit: "180 г" }, quantity: 2 }],
    candidates: [observedCandidate({ lines: [
      { productId: "butter-825-180", status: "priced-observation", unitPriceMinor: 19499,
        observedAt: "2026-10-12T14:50:00Z" },
      { productId: "unmapped-id", status: "priced-observation", unitPriceMinor: 5000 },
      { productId: "missing", status: "unknown-price", unitPriceMinor: null }
    ] })], conclusion: { kind: "insufficient-coverage", reason: "no_complete_candidate" } };
  const prices = buildObservedResultModel(result).confirmedCandidates[0].prices;
  assert.equal(prices[0].productLabel, "Масло сливочное Брест-Литовск 82,5%, 180 г");
  assert.equal(prices[0].priceLabel, "194,99 ₽", "unit price is not a full basket sum");
  assert.equal(prices[0].observedAtLabel, "12.10.2026, 14:50 UTC");
  assert.equal(prices[1].productLabel, undefined, "never guess an unknown identity from source names");
  assert.equal(prices.length, 2);
});

test("mixed sales channels explain why a cheapest claim is withheld", () => {
  const model = buildObservedResultModel({
    kind: "observed-price-comparison",
    candidates: [],
    conclusion: {
      kind: "insufficient-coverage",
      reason: "mixed_sales_channel",
      candidateId: null,
      totalMinor: null,
      savingsMinor: null
    }
  });

  assert.equal(model.kind, "insufficient-coverage");
  assert.equal(
    model.note,
    "Есть полные суммы, но часть цен относится к онлайн-заказу, а часть — к покупке в магазине. CHECKNI не сравнивает их как один ценовой режим."
  );
});


test("observed total discloses its preserved sales channel", () => {
  const model = buildObservedResultModel({
    kind: "observed-price-comparison",
    candidates: [observedCandidate({ salesChannel: "store" })],
    conclusion: {
      kind: "observed-total-only",
      candidateId: "store:store-location-a",
      totalMinor: 10000,
      savingsMinor: null
    }
  });

  assert.equal(model.salesChannelLabel, "Покупка в магазине");
});

test("insufficient observed comparison ignores an accidental candidate winner", () => {
  const model = buildObservedResultModel({
    winner: {
      candidateId: "store:unverified",
      candidateName: "Непроверенный вариант",
      totalMinor: 1
    },
    candidates: [],
    conclusion: {
      kind: "insufficient-coverage",
      reason: "mixed_sales_channel",
      candidateId: null,
      totalMinor: null,
      savingsMinor: null
    }
  });

  assert.equal(model.kind, "insufficient-coverage");
  assert.equal(model.title, "Недостаточно данных для «дешевле»");
  assert.equal(model.totalLabel, undefined);
  assert.equal(model.savingsLabel, undefined);
});
