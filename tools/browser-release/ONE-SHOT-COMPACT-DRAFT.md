# Proposed one-time Pages artifact reduction

DRAFT ONLY. This PR must not be merged until independent review, exact-head CI, retained CDN file checks, and a tested rollback.

The inventory is fixed to a specific observed Pages state and open-PR snapshot. Existing active root, observed live root, previous distinct published root, and known main trees referenced by open activation PRs must be retained. Open staging PRs not in main are not published; a new staging merge invalidates the reviewed main. A new or updated open PR, changed live root or any other snapshot inconsistency stops publication; the snapshot must be refreshed and reviewed before retry.

After a successful compact deployment, old immutable release URLs outside the selected set may stop working, including in external bookmarks, old tabs or stale HTML. Git history and release trees remain untouched. Recovery of a removed URL requires republishing a new artifact containing that tree and waiting for CDN verification. This is a one-time measure; routine future updates require a separate reviewed policy.
