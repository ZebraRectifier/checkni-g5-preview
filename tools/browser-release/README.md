# Immutable candidate gate

This verifier does not build, activate or publish releases. Root source remains unchanged during staging.

`node tools/browser-release/verify.mjs` checks the actual local `releases/<sha256>/` bytes, descriptor identity, MIME declarations, required entrypoints and exact file set. `RELEASE_BASE_SHA` selects changed subtrees; activated root entrypoints are always included. `RELEASE_ID` optionally selects one exact candidate. With no base or ID, existing release directories are checked. An absent candidate prints `NO_RELEASE_CANDIDATE_NOT_A_VERIFIED_RELEASE`; the browser acceptance is explicitly skipped, while unit negatives still run.

`npx playwright test --config playwright.immutable-release.config.mjs` serves the same checked-out subtree and verifies its HTTP bytes/types and actual preview at desktop/mobile widths. Root modules must not be requested; mutable directory JSON must stay at root. A synthetic previously reviewed retail identity verifies manual add/reload without paid AI or external retailer calls. This is wiring evidence, not real prices, stock, physical Android or live-provider acceptance.

When root pages activate a release, both must exactly match the release tool's generated entrypoints for the same ID. Partial activation, mixed IDs and modified paths fail. The browser additionally opens both real root entrypoints. Local testing supports `RELEASE_ROOT` pointing at a separate staged evidence directory and `RELEASE_BROWSER_CHANNEL` for an already installed browser.

Manifest contract matches the current private release tool, including `text/plain` for `.txt`. An older staged descriptor that declared license text as `application/octet-stream` requires a new staging/hash; never rewrite an immutable subtree in place. HTTP checks here use a local server; remote CDN propagation verification is still required before activation.
