# OKEY published-source diagnostics

The published collector visits the existing Proshoper Moscow catalogue once. It does not change the paused official or delivery collectors, reset a source block, retry a failed navigation or obtain a new endpoint. The existing 30-second navigation and 15-second selector deadlines remain in place.

The next normally allowed run writes `artifacts/okey-published-diagnostics/latest.json` before invoking the production parser and before closing the browser. A final bounded JSON record is also printed with the prefix `OKEY_PUBLISHED_DIAGNOSTIC`, so ordinary job logs retain the evidence even when the workflow has no diagnostics upload step. This preparation does not add or dispatch a workflow. A browser cleanup error is recorded separately and cannot prevent the actual collection status from being saved.

The record includes the response status, exact-landing-URL boolean, public document title, catalogue heading and period text, selector/card counts, parser rejection reasons and a sample of public card fields. It contains no page HTML, scripts, body text, cookies, storage, form data, response headers or arbitrary redirect URL. Links and credential-like strings inside the allowed text fields are redacted. Unknown HTTP status is `null`.

Bounds:

- At most 200 visible cards enter the existing production parser, as before. Counts also show matching/visible cards beyond that cap; completeness is never implied.
- The diagnostic contains the first 24 cards, with an omitted-card count. It explains layout/admission failures; it is a partial, sanitized sample and cannot be imported as a price feed or prove all 200 card identities.
- Names are capped at 401 characters, heading at 512, period at 256, expiry text at 128, rubles at 64, cents at 16 and public IDs at 32. Truncation of a parser-input field fails closed instead of potentially turning truncated text into an admitted product. Truncating the diagnostic-only document title does not change admission.
- The serialized artifact is limited to 128,000 bytes. Unknown object fields and exception messages are not recorded.

Global parser reasons distinguish `source_url_mismatch`, `title_missing`, `title_not_recognised`, `observation_time_invalid`, `period_missing`, `period_not_recognised`, `catalogue_not_started`, `catalogue_expired`, `products_not_array`, `products_empty`, `no_current_valid_products` and `parser_exception`. Product rejection counts distinguish invalid ID, name, current price, expiry, expired products and duplicate accepted IDs. These codes only describe rejection. The unchanged `src/observations/okeyPublishedPromotions.mjs` remains the sole source of an admitted snapshot.

The raw capture is saved first with stage `captured`; the subsequent `parsed` record adds aggregate rejection reasons. A missing product selector records `visible_product_selector_unavailable`, a bounded-input overflow records `document_field_limit`, and browser cleanup failure adds `cleanupFailed`. No error string is used to infer a price or new period.

An existing `blocked` status skips browser launch and all source access and leaves the status/feed untouched. HTTP 403/429 or the existing challenge-text detector preserve the block. A rejected attempt does not overwrite retained prices, retimestamp an old snapshot or substitute zero for a missing price. Successful diagnostics alone do not satisfy `verify-published-refresh.mjs`; the existing current-period/new-observation freshness gate remains unchanged. Evidence is still a third-party Moscow city promotion, with unknown physical-store applicability, card conditions and stock.

Offline verification, without browser installation or source requests:

```sh
node --test tests/okeyPublishedPromotions.test.mjs
```

The existing workflow already invokes this test file. Its deterministic fixtures cover changed layout, missing/invalid periods, invalid prices/expiry, duplicate rows, challenges, a preserved existing block, exact URL/status rejection, cleanup and write failures, sample/field/byte bounds and the unchanged production snapshot. Browser launch and all I/O are injected fixtures in these tests; they are not fresh source evidence.
