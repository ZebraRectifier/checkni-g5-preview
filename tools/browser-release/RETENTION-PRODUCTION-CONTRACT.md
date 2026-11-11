# Production integration contract — not implemented

The compact-proof CI is an isolated static snapshot and MUST NOT be integrated directly into Pages.

A production implementation must use a snapshot captured at the exact main SHA and fail closed when any of the following cannot be established:
1. active ID from activationState after verifying exact root entrypoints;
2. live ID from both ordinary Pages root HTML entrypoints, verified equal and referencing a locally present verified manifest. Network errors, cache inconsistency, or mixed IDs abort;
3. previous distinct successfully deployed ID, from a complete, paginated Pages deployment and deployment-status history, looking up the root of the actual deployed commit, not merely the current main or a receipt. If a prior distinct ID cannot be authenticated, abort;
4. each release ID in a complete, paginated set of all open PRs: inspect each PR head root entrypoints and added release tree paths, and retain IDs present in the exact main snapshot. PR trees not in main cannot be published until merged; the staging commit must add its ID to the next artifact. Unknown PR access, truncated pagination, deleted branches or ambiguous state abort;
5. every concrete release path from a binary-safe full tracked-file scan outside release trees, including source, tests, workflows and public data. Dynamic or escaped refs need an explicit reviewed registry. External links cannot be enumerated.

Before artifact generation and again after the deploy queue and immediately before calling deploy-pages, re-fetch all above mutable facts and compare a canonical snapshot (main, each open PR ID/head SHA/base/state, live entrypoints, deployment status/history and explicit refs). Any difference aborts and requires a new build. A check immediately before deployment cannot guarantee the live CDN will not be updated externally afterward; enforce one deployment owner and workflow concurrency, revalidate on deployment, and retain a grace window for propagation. Cache and independently served CDN points can disagree, so a single HTTP read is not proof of all clients.

The compact builder must build from Git without deleting any source/history, verify exact tracked file set, all retained manifests/hashes/MIME declarations, root activation and .nojekyll, public secrets, preserved unversioned assets and stable rollback. It must test negative cases: unavailable API, omitted or changed PR, stale root, unknown/ambiguous history, pagination, source moved, empty/partial assets, wrong hash, both tar process errors and dirty checkout. Test real deployment and MIME only in an isolated preview, verify every CDN file and rollback by reintroducing a deliberately omitted tree before any production application. Success of synthetic #287 does not prove this.

Dropping a release from the artifact may immediately break its old public URLs and long-lived tabs/CDN cached HTML; neither Git nor PR scanning can identify external users. Preserve legacy URLs for a reviewed grace interval or treat this as an explicit product tradeoff. All versions remain in Git, but restoring a dropped URL requires a new artifact deployment and propagation. A failed deployment must not remove or overwrite the prior deployment.

PR #287 does not implement the above state discovery, snapshot locks, historical proof or production deployment. Do not merge it as a production solution.
