import {
  createBasketStore
} from "./state/basketStore.mjs";
import {
  clearLocalUserEvidence,
  loadLocalUserEvidence,
  saveLocalUserEvidence
} from "./observations/localUserEvidenceStore.mjs";
import {
  loadYandexProductMappings,
  saveYandexProductMapping
} from "./observations/localYandexProductMappingStore.mjs";
import {
  requestYandexPublicPrices
} from "./ports/yandexPublicPricesPort.mjs";
import {
  RETAILER_IDENTITIES,
  getRetailerIdentity
} from "./data/retailerRegistry.mjs";
import {
  USER_EVIDENCE_KIND,
  USER_EVIDENCE_PRICE_CONDITION,
  USER_EVIDENCE_TYPE,
  validateUserEvidenceObservation
} from "./observations/userEvidence.mjs";

export const MAX_CAPTURE_PRICE_MINOR = 10_000_000;

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function identityText(value) {
  return cleanText(value, 240)
    ?.toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е") ?? null;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function suggestRetailerIdFromStoreName(value) {
  const normalized = identityText(value);
  if (!normalized) return null;

  const candidates = RETAILER_IDENTITIES
    .flatMap((retailer) => (
      [retailer.name, ...(retailer.aliases ?? [])]
        .map((label) => ({
          retailerId: retailer.id,
          label: identityText(label)
        }))
    ))
    .filter((item) => item.label)
    .sort((left, right) => right.label.length - left.label.length);

  return candidates.find((candidate) => (
    normalized === candidate.label
    || normalized.startsWith(candidate.label + " ")
    || normalized.startsWith(candidate.label + " ·")
    || normalized.startsWith(candidate.label + ",")
  ))?.retailerId ?? null;
}

export function parseRubPriceToMinor(value) {
  if (typeof value !== "string") return null;

  const normalized = value
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(",", ".")
    .trim();

  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(normalized)) return null;

  const [rublesText, kopeksText = ""] = normalized.split(".");
  const rubles = Number(rublesText);
  const kopeks = Number((kopeksText + "00").slice(0, 2));

  if (!Number.isSafeInteger(rubles) || !Number.isSafeInteger(kopeks)) {
    return null;
  }

  const minor = rubles * 100 + kopeks;
  if (
    !Number.isSafeInteger(minor)
    || minor <= 0
    || minor > MAX_CAPTURE_PRICE_MINOR
  ) {
    return null;
  }

  return minor;
}

export function parseYandexOrganizationIdentity(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new TypeError("Yandex organization URL is invalid");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TypeError("Yandex organization URL is invalid");
  }

  if (
    url.protocol !== "https:"
    || !["yandex.ru", "www.yandex.ru", "yandex.com", "www.yandex.com"].includes(
      url.hostname
    )
    || url.username
    || url.password
  ) {
    throw new TypeError("Yandex organization URL is invalid");
  }

  const match = /^\/maps\/org\/(?:(?:[^/]+)\/)?(\d+)(?:\/menu)?\/?$/.exec(
    url.pathname
  );
  if (!match) {
    throw new TypeError("Yandex organization URL is invalid");
  }

  return Object.freeze({
    organizationId: match[1],
    storeId: `yandex-org-${match[1]}`
  });
}

function isGenericRetailerStoreLabel(storeName, localityName) {
  const store = identityText(storeName);
  const locality = identityText(localityName);
  const retailerId = suggestRetailerIdFromStoreName(storeName);
  const retailer = retailerId ? getRetailerIdentity(retailerId) : null;
  if (!store || !retailer) return false;

  const labels = [retailer.name, ...(retailer.aliases ?? [])]
    .map(identityText)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const label of labels) {
    if (store === label) return true;
    if (!store.startsWith(label)) continue;

    const remainder = store
      .slice(label.length)
      .replace(/^[\s·,;:()\-–—]+|[\s·,;:()\-–—]+$/gu, "")
      .trim();

    if (!remainder) return true;
    if (locality && remainder === locality) return true;
  }

  return false;
}

export function deriveCommunityStoreContext({
  regionName,
  localityName,
  storeName,
  yandexOrganizationUrl = ""
}) {
  const region = cleanText(regionName, 240);
  const locality = cleanText(localityName, 240);
  const store = cleanText(storeName, 240);

  const regionIdentity = identityText(regionName);
  const localityIdentity = identityText(localityName);
  const storeIdentity = identityText(storeName);

  if (
    !region
    || !locality
    || !store
    || !regionIdentity
    || !localityIdentity
    || !storeIdentity
  ) {
    throw new TypeError("region, city and concrete store are required");
  }

  const regionId = `community-region-${fnv1a(regionIdentity)}`;
  const localityId = `community-locality-${fnv1a(
    regionIdentity + "|" + localityIdentity
  )}`;
  const yandexIdentity = parseYandexOrganizationIdentity(
    yandexOrganizationUrl
  );

  if (
    !yandexIdentity
    && isGenericRetailerStoreLabel(store, locality)
  ) {
    throw new TypeError(
      "concrete store branch or address is required"
    );
  }

  const storeId = yandexIdentity?.storeId ?? `community-store-${fnv1a(
    regionIdentity + "|" + localityIdentity + "|" + storeIdentity
  )}`;

  return Object.freeze({
    countryCode: "RU",
    regionId,
    regionName: region,
    localityId,
    localityName: locality,
    locationId: storeId,
    locationLabel: [store, locality, region].join(" · ").slice(0, 300),
    storeId,
    storeName: store
  });
}

function barcodeFromCanonicalId(productId) {
  const match = /^gtin-(\d{14})$/.exec(productId);
  return match?.[1] ?? null;
}

function normalizedCondition(value) {
  return Object.values(USER_EVIDENCE_PRICE_CONDITION).includes(value)
    ? value
    : null;
}

export function deriveYandexRetailerCityContext({
  regionName,
  localityName,
  retailerId
}) {
  const region = cleanText(regionName, 240);
  const locality = cleanText(localityName, 240);
  const retailer = getRetailerIdentity(cleanText(retailerId, 80));

  const regionIdentity = identityText(regionName);
  const localityIdentity = identityText(localityName);

  if (
    !region
    || !locality
    || !retailer
    || !regionIdentity
    || !localityIdentity
  ) {
    throw new TypeError("region, city and retailer are required");
  }

  const regionId = `community-region-${fnv1a(regionIdentity)}`;
  const localityId = `community-locality-${fnv1a(
    regionIdentity + "|" + localityIdentity
  )}`;

  return Object.freeze({
    countryCode: "RU",
    regionId,
    regionName: region,
    localityId,
    localityName: locality,
    retailerId: retailer.id,
    locationId: `yandex-retailer:${retailer.id}:city:${localityId}`,
    locationLabel: `${retailer.name} · ${locality}`
  });
}

export function buildYandexProductMapping({
  sourceProduct,
  canonicalProduct,
  regionName,
  localityName,
  retailerId,
  yandexOrganizationUrl,
  contextConfirmed,
  mappedAt
}) {
  const identity = parseYandexOrganizationIdentity(
    yandexOrganizationUrl
  );
  if (!identity) {
    throw new TypeError("Yandex organization URL is required");
  }
  if (
    !sourceProduct
    || typeof sourceProduct.sourceProductId !== "string"
    || typeof sourceProduct.name !== "string"
    || !canonicalProduct
    || typeof canonicalProduct.id !== "string"
    || typeof canonicalProduct.name !== "string"
  ) {
    throw new TypeError("Yandex product mapping identity is invalid");
  }

  const sourceProductId = cleanText(sourceProduct.sourceProductId, 180);
  const sourceProductName = cleanText(sourceProduct.name, 240);
  const canonicalProductId = cleanText(canonicalProduct.id, 180);
  const mappedAtIso = new Date(mappedAt).toISOString();

  if (
    contextConfirmed !== true
    || !sourceProductId
    || !sourceProductName
    || !canonicalProductId
    || !Number.isFinite(Date.parse(mappedAtIso))
  ) {
    throw new TypeError("Yandex product mapping is invalid");
  }

  const context = deriveYandexRetailerCityContext({
    regionName,
    localityName,
    retailerId
  });

  return Object.freeze({
    organizationId: identity.organizationId,
    sourceProductId,
    sourceProductName,
    canonicalProductId,
    context,
    contextConfirmedAt: mappedAtIso,
    mappedAt: mappedAtIso
  });
}

function formatMinorRub(priceMinor) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB"
  }).format(priceMinor / 100);
}

export function buildUserPriceEvidence({
  product,
  priceText,
  regionName,
  localityName,
  storeName,
  yandexOrganizationUrl = "",
  priceCondition,
  conditionNote = "",
  nowIso,
  evidenceId
}) {
  if (
    !product
    || typeof product.id !== "string"
    || typeof product.name !== "string"
  ) {
    throw new TypeError("basket product identity is invalid");
  }

  const priceMinor = parseRubPriceToMinor(priceText);
  if (priceMinor == null) {
    throw new TypeError("price is invalid");
  }

  const observedAt = new Date(nowIso).toISOString();
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new TypeError("observation time is invalid");
  }

  const condition = normalizedCondition(priceCondition);
  if (!condition || condition === USER_EVIDENCE_PRICE_CONDITION.UNKNOWN) {
    throw new TypeError("price condition must be explicit");
  }

  const note = cleanText(conditionNote, 500);
  if (
    (
      condition === USER_EVIDENCE_PRICE_CONDITION.LOYALTY
      || condition === USER_EVIDENCE_PRICE_CONDITION.PROMO
    )
    && !note
  ) {
    throw new TypeError("promo or loyalty price requires a note");
  }

  const id = cleanText(evidenceId, 240);
  if (!id) throw new TypeError("evidence id is invalid");

  const context = deriveCommunityStoreContext({
    regionName,
    localityName,
    storeName,
    yandexOrganizationUrl
  });
  const barcode = barcodeFromCanonicalId(product.id);

  const input = {
    kind: USER_EVIDENCE_KIND,
    evidenceId: id,
    evidenceType: USER_EVIDENCE_TYPE.MANUAL_PRICE_CONFIRMATION,
    proofRef: `confirmation:${id}`,
    consent: {
      granted: true,
      capturedAt: observedAt
    },
    observedAt,
    product: {
      canonicalProductId: product.id,
      ...(barcode ? { barcode } : {}),
      name: product.name
    },
    priceMinor,
    currency: "RUB",
    granularity: "exact-store",
    context,
    priceCondition: condition,
    ...(note ? { conditionNote: note } : {}),
    availability: "unknown"
  };

  const validated = validateUserEvidenceObservation(input);
  if (validated.kind !== "accepted") {
    throw new TypeError(
      "price evidence failed validation: " + validated.reason
    );
  }

  return Object.freeze(input);
}

function newEvidenceId(productId) {
  const random = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `local-price:${Date.now()}:${random}:${productId}`.slice(0, 240);
}

function ageLabel(observedAt) {
  const ageMinutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(observedAt)) / 60000)
  );
  if (ageMinutes < 1) return "только что";
  if (ageMinutes < 60) return `${ageMinutes} мин назад`;
  const hours = Math.floor(ageMinutes / 60);
  return `${hours} ч назад`;
}

function renderSavedEvidence(container) {
  const rows = loadLocalUserEvidence();
  const groups = new Map();

  for (const row of rows) {
    const key = row.observation.context.storeId;
    const group = groups.get(key) ?? {
      storeName: row.observation.context.storeName,
      localityName: row.observation.context.localityName,
      observedAt: row.observation.observedAt,
      count: 0
    };
    group.count += 1;
    if (row.observation.observedAt > group.observedAt) {
      group.observedAt = row.observation.observedAt;
    }
    groups.set(key, group);
  }

  container.replaceChildren();

  if (groups.size === 0) {
    const empty = document.createElement("p");
    empty.className = "saved-empty";
    empty.textContent = "Свежих подтверждений пока нет.";
    container.append(empty);
    return;
  }

  for (const group of groups.values()) {
    const card = document.createElement("div");
    card.className = "saved-store";

    const title = document.createElement("strong");
    title.textContent = group.storeName;

    const meta = document.createElement("span");
    meta.textContent = [
      group.localityName,
      `${group.count} цен`,
      ageLabel(group.observedAt)
    ].filter(Boolean).join(" · ");

    card.append(title, meta);
    container.append(card);
  }
}

function boot() {
  const basket = createBasketStore();
  const items = basket.getSnapshot();

  const form = document.querySelector("#price-capture-form");
  const list = document.querySelector("#price-items");
  const status = document.querySelector("#capture-status");
  const empty = document.querySelector("#price-empty");
  const compare = document.querySelector("#compare-real-prices");
  const saved = document.querySelector("#saved-evidence");
  const clear = document.querySelector("#clear-evidence");
  const condition = document.querySelector("#price-condition");
  const noteWrap = document.querySelector("#condition-note-wrap");
  const note = document.querySelector("#condition-note");
  const submit = document.querySelector("#save-prices");
  const yandexLoad = document.querySelector("#load-yandex-prices");
  const yandexStatus = document.querySelector("#yandex-status");
  const yandexPanel = document.querySelector("#yandex-prices-panel");
  const yandexList = document.querySelector("#yandex-price-items");
  const retailerSelect = document.querySelector("#yandex-retailer");
  const yandexContextConfirmed = document.querySelector(
    "#yandex-context-confirmed"
  );
  const regionInput = form?.querySelector('[name="region"]');
  const cityInput = form?.querySelector('[name="city"]');
  const yandexUrlInput = form?.querySelector('[name="yandexUrl"]');
  const storeInput = form?.querySelector('[name="store"]');

  if (!form || !list || !status || !empty || !compare || !saved) return;

  renderSavedEvidence(saved);

  let yandexRequestVersion = 0;
  let loadedYandexContextKey = null;

  const readYandexContextFormValues = () => {
    const data = new FormData(form);
    return Object.freeze({
      regionName: String(data.get("region") ?? ""),
      localityName: String(data.get("city") ?? ""),
      storeName: String(data.get("store") ?? ""),
      retailerId: String(data.get("yandexRetailer") ?? ""),
      yandexOrganizationUrl: String(data.get("yandexUrl") ?? ""),
      contextConfirmed: data.get("yandexContextConfirmed") === "on"
    });
  };

  const yandexContextKey = (values) => JSON.stringify([
    values.regionName.normalize("NFKC").trim(),
    values.localityName.normalize("NFKC").trim(),
    values.retailerId.trim(),
    values.yandexOrganizationUrl.trim()
  ]);

  const invalidateLoadedYandexContext = () => {
    yandexRequestVersion += 1;

    if (
      loadedYandexContextKey
      && loadedYandexContextKey !== yandexContextKey(
        readYandexContextFormValues()
      )
    ) {
      loadedYandexContextKey = null;
      if (yandexPanel) yandexPanel.hidden = true;
      yandexList?.replaceChildren();
      if (yandexStatus) {
        yandexStatus.textContent =
          "Параметры сети, города или карточки изменились. Загрузите цены из Яндекса заново.";
      }
    }

    if (yandexLoad) yandexLoad.disabled = false;
  };

  for (const field of [
    regionInput,
    cityInput,
    yandexUrlInput,
    retailerSelect
  ]) {
    field?.addEventListener("input", invalidateLoadedYandexContext);
    field?.addEventListener("change", invalidateLoadedYandexContext);
  }

  if (retailerSelect) {
    const retailers = RETAILER_IDENTITIES
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
    for (const retailer of retailers) {
      const option = document.createElement("option");
      option.value = retailer.id;
      option.textContent = retailer.name;
      retailerSelect.append(option);
    }

    const syncRetailerSuggestion = () => {
      if (retailerSelect.value) return;
      const suggested = suggestRetailerIdFromStoreName(
        storeInput?.value ?? ""
      );
      if (suggested) retailerSelect.value = suggested;
    };

    storeInput?.addEventListener("input", syncRetailerSuggestion);
    storeInput?.addEventListener("change", syncRetailerSuggestion);
    syncRetailerSuggestion();
  }

  if (items.length === 0) {
    form.hidden = true;
    empty.hidden = false;
    compare.hidden = true;
    return;
  }

  const inputs = new Map();

  for (const item of items) {
    const row = document.createElement("label");
    row.className = "price-row";

    const copy = document.createElement("span");
    copy.className = "price-row-copy";

    const name = document.createElement("strong");
    name.textContent = item.name;

    const unit = document.createElement("small");
    unit.textContent = `${item.unit} · в корзине ×${item.quantity}`;

    copy.append(name, unit);

    const field = document.createElement("span");
    field.className = "price-input-wrap";

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.placeholder = "0,00";
    input.setAttribute(
      "aria-label",
      `Цена за одну упаковку: ${item.name}`
    );

    const currency = document.createElement("span");
    currency.textContent = "₽";

    field.append(input, currency);
    row.append(copy, field);
    list.append(row);
    inputs.set(item.id, input);
  }

  const syncConditionNote = () => {
    const needsNote = (
      condition?.value === USER_EVIDENCE_PRICE_CONDITION.LOYALTY
      || condition?.value === USER_EVIDENCE_PRICE_CONDITION.PROMO
    );
    if (noteWrap) noteWrap.hidden = !needsNote;
    if (!needsNote && note) note.value = "";
  };

  condition?.addEventListener("change", syncConditionNote);
  syncConditionNote();

  clear?.addEventListener("click", () => {
    clearLocalUserEvidence();
    renderSavedEvidence(saved);
    status.textContent = "Локальные подтверждения очищены.";
  });

  const renderYandexProducts = (response, formValues) => {
    if (!yandexPanel || !yandexList) return;

    const existing = new Map(
      loadYandexProductMappings()
        .filter((mapping) => (
          mapping.organizationId === response.organizationId
        ))
        .map((mapping) => [
          mapping.sourceProductId,
          mapping
        ])
    );

    yandexList.replaceChildren();

    for (const product of response.products.slice(0, 20)) {
      const row = document.createElement("div");
      row.className = "yandex-price-row";

      const copy = document.createElement("span");
      copy.className = "yandex-price-copy";

      const name = document.createElement("strong");
      name.textContent = product.name;

      const price = document.createElement("small");
      price.textContent = [
        formatMinorRub(product.priceMinor),
        "Яндекс Карты",
        "наличие неизвестно"
      ].join(" · ");

      copy.append(name, price);

      const controls = document.createElement("span");
      controls.className = "yandex-map-controls";

      const select = document.createElement("select");
      select.setAttribute(
        "aria-label",
        `Связать ${product.name} с товаром корзины`
      );

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Связать с товаром…";
      select.append(emptyOption);

      for (const item of items) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.name} · ${item.unit}`;
        select.append(option);
      }

      const previous = existing.get(product.sourceProductId);
      if (
        previous
        && items.some((item) => (
          item.id === previous.canonicalProductId
        ))
      ) {
        select.value = previous.canonicalProductId;
      }

      const save = document.createElement("button");
      save.type = "button";
      save.className = "secondary yandex-map-button";
      save.textContent = previous ? "Обновить связь" : "Связать";

      const rowStatus = document.createElement("small");
      rowStatus.className = "mapping-status";
      rowStatus.textContent = previous
        ? "Связь сохранена"
        : "";

      save.addEventListener("click", () => {
        const canonicalProduct = items.find(
          (item) => item.id === select.value
        );

        if (!canonicalProduct) {
          rowStatus.textContent = "Выберите товар из корзины";
          return;
        }

        const currentContext = readYandexContextFormValues();
        if (
          yandexContextKey(currentContext) !== yandexContextKey(formValues)
        ) {
          rowStatus.textContent =
            "Параметры изменились. Загрузите цены из Яндекса заново.";
          return;
        }
        if (!currentContext.contextConfirmed) {
          rowStatus.textContent =
            "Подтвердите сеть и город для этой карточки Яндекс Карт";
          yandexContextConfirmed?.focus();
          return;
        }

        try {
          const mapping = buildYandexProductMapping({
            sourceProduct: product,
            canonicalProduct,
            regionName: currentContext.regionName,
            localityName: currentContext.localityName,
            retailerId: currentContext.retailerId,
            yandexOrganizationUrl: currentContext.yandexOrganizationUrl,
            contextConfirmed: true,
            mappedAt: new Date().toISOString()
          });
          const savedMapping = saveYandexProductMapping(mapping);

          if (savedMapping.kind !== "accepted") {
            rowStatus.textContent =
              "Не удалось сохранить связь на этом устройстве";
            return;
          }

          save.textContent = "Связано";
          rowStatus.textContent =
            "Готово · связь действует ограниченное время и затем потребует подтверждения";
          compare.hidden = false;
        } catch {
          rowStatus.textContent = "Не удалось сохранить связь";
        }
      });

      controls.append(select, save, rowStatus);
      row.append(copy, controls);
      yandexList.append(row);
    }

    yandexPanel.hidden = false;
  };

  yandexLoad?.addEventListener("click", async () => {
    if (!yandexStatus || !yandexPanel || !yandexList) return;

    const formValues = readYandexContextFormValues();
    const requestId = ++yandexRequestVersion;
    loadedYandexContextKey = null;

    try {
      if (!parseYandexOrganizationIdentity(
        formValues.yandexOrganizationUrl
      )) {
        throw new TypeError("Yandex organization URL is required");
      }
      deriveCommunityStoreContext({
        regionName: formValues.regionName,
        localityName: formValues.localityName,
        storeName: formValues.storeName,
        yandexOrganizationUrl: formValues.yandexOrganizationUrl
      });
      deriveYandexRetailerCityContext({
        regionName: formValues.regionName,
        localityName: formValues.localityName,
        retailerId: formValues.retailerId
      });
    } catch {
      yandexStatus.textContent =
        "Укажите регион, город, сеть и корректную ссылку Яндекс Карт.";
      return;
    }

    yandexLoad.disabled = true;
    yandexStatus.textContent = "Проверяю публичные цены в Яндекс Картах…";
    yandexPanel.hidden = true;
    yandexList.replaceChildren();

    try {
      const response = await requestYandexPublicPrices(
        formValues.yandexOrganizationUrl
      );

      if (requestId !== yandexRequestVersion) return;

      if (response.kind === "prices") {
        loadedYandexContextKey = yandexContextKey(formValues);
        renderYandexProducts(response, formValues);
        yandexStatus.textContent =
          `Нашёл публичных цен: ${response.products.length}. Свяжите нужные с товарами корзины один раз.`;
      } else if (response.kind === "empty") {
        yandexStatus.textContent =
          "В этой карточке Яндекс Карт публичных цен не найдено. Можно ввести цену вручную ниже.";
      } else if (response.kind === "blocked") {
        yandexStatus.textContent =
          "Яндекс временно не дал прочитать цены. Ручной ввод продолжает работать.";
      } else {
        yandexStatus.textContent =
          "Автоподхват сейчас недоступен. Ручной ввод продолжает работать.";
      }
    } catch {
      if (requestId === yandexRequestVersion) {
        yandexStatus.textContent =
          "Автоподхват сейчас недоступен. Ручной ввод продолжает работать.";
      }
    } finally {
      if (requestId === yandexRequestVersion) {
        yandexLoad.disabled = false;
      }
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const regionName = String(data.get("region") ?? "");
    const localityName = String(data.get("city") ?? "");
    const storeName = String(data.get("store") ?? "");
    const yandexOrganizationUrl = String(data.get("yandexUrl") ?? "");
    const priceCondition = String(data.get("condition") ?? "");
    const conditionNote = String(data.get("conditionNote") ?? "");
    const consent = data.get("consent") === "on";

    if (!consent) {
      status.textContent =
        "Подтвердите, что цены вы видите сами и разрешаете сохранить их на этом устройстве.";
      return;
    }

    const nowIso = new Date().toISOString();
    let accepted = 0;
    let unavailable = 0;
    let invalid = 0;

    for (const item of items) {
      const priceText = inputs.get(item.id)?.value.trim() ?? "";
      if (!priceText) continue;

      try {
        const evidence = buildUserPriceEvidence({
          product: item,
          priceText,
          regionName,
          localityName,
          storeName,
          yandexOrganizationUrl,
          priceCondition,
          conditionNote,
          nowIso,
          evidenceId: newEvidenceId(item.id)
        });

        const result = saveLocalUserEvidence(evidence);
        if (result.kind === "accepted") {
          accepted += 1;
          inputs.get(item.id).value = "";
        } else if (result.kind === "unavailable") {
          unavailable += 1;
        } else {
          invalid += 1;
        }
      } catch {
        invalid += 1;
      }
    }

    if (accepted === 0) {
      status.textContent = unavailable > 0
        ? "Браузер не дал сохранить цены. Корзина продолжает работать без них."
        : "Не удалось сохранить цену. Проверьте регион, город, магазин и формат цены.";
      return;
    }

    status.textContent = [
      `Сохранено: ${accepted}`,
      invalid ? `не принято: ${invalid}` : null,
      "наличие не предполагается"
    ].filter(Boolean).join(" · ");

    compare.hidden = false;
    renderSavedEvidence(saved);
  });
}

if (typeof document !== "undefined") {
  boot();
}
