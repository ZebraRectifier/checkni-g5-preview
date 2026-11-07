import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SHA = /^[a-f0-9]{40}$/u;
const REPOSITORY_NAME = 'ZebraRectifier/checkni-g5-preview';
const REPOSITORY = 'https://github.com/ZebraRectifier/checkni-g5-preview.git';
export const FEED_FILES = Object.freeze({
  okey: Object.freeze(['okeyDeliveryHistory', 'okeyDeliveryRefresh', 'okeyOfficialPromotions',
    'okeyOfficialRefresh', 'okeyPublishedPromotions', 'okeyPublishedRefresh'].map(name => `src/data/${name}.json`)),
  pyaterochka: Object.freeze(['src/data/pyaterochkaPublishedPromotions.json', 'src/data/pyaterochkaPublishedRefresh.json'])
});
const need = (value, code) => { if (!value) throw Error(code); };

// deploy-pages uses GITHUB_SHA as pages_build_version, not the checked-out HEAD.
// A new feed commit therefore needs its own event, never a reusable call carrying
// the collector's older event SHA. Recheck this before packaging and deployment.
export function verifyPublicationEvent({commit, eventSha, eventName, repository, ref} = {}) {
  need(repository === REPOSITORY_NAME && ref === 'refs/heads/main'
    && ['push', 'workflow_dispatch'].includes(eventName), 'untrusted_publication_event');
  need(SHA.test(commit ?? '') && eventSha === commit, 'publication_event_commit_mismatch');
  return {commit, eventCommitVerified: true};
}

// The publisher always packages an exact trusted checkout. A feed may advance
// its reviewed base by one data-only commit; it cannot deploy another branch,
// repository, runtime, release manifest, HTML entrypoint, or stale main head.
export function verifyPublicationCheckout({root = '.', commit, baseCommit = '', feed = '',
  requireCurrentMain = true, requireData = false, git} = {}) {
  need(SHA.test(commit ?? ''), 'invalid_publication_commit');
  need(typeof requireCurrentMain === 'boolean', 'invalid_publication_mode');
  need((feed === '' && baseCommit === '' && !requireData)
    || (Object.hasOwn(FEED_FILES, feed) && SHA.test(baseCommit)), 'invalid_feed_publication');
  git ??= args => execFileSync('git', args, {cwd: root, encoding: 'utf8', timeout: 15000,
    maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  const run = args => { try { return git(args).trim(); } catch { throw Error('publication_git_unavailable'); } };
  need([REPOSITORY, REPOSITORY.slice(0, -4)].includes(run(['remote', 'get-url', 'origin'])), 'untrusted_publication_repository');
  need(run(['rev-parse', 'HEAD']) === commit, 'publication_checkout_mismatch');
  if (feed) {
    if (commit !== baseCommit) need(run(['rev-list', '--parents', '-n', '1', commit]) === `${commit} ${baseCommit}`, 'publication_not_single_data_commit');
    const changes = run(['diff', '--name-status', '--no-renames', baseCommit, commit, '--']);
    for (const line of changes ? changes.split('\n') : []) {
      const [status, file, extra] = line.split('\t');
      need(['A', 'M'].includes(status) && !extra && FEED_FILES[feed].includes(file), 'publication_not_data_only');
      const entry = run(['ls-tree', commit, '--', file]);
      need(new RegExp(`^100644 blob [a-f0-9]{40}\\t${file.replaceAll('.', '\\.')}$`, 'u').test(entry), 'publication_data_not_regular');
    }
  }
  if (requireCurrentMain) need(run(['ls-remote', '--exit-code', REPOSITORY, 'refs/heads/main']) === `${commit}\trefs/heads/main`, 'publication_main_advanced');
  return {commit, ...(feed ? {feed, baseCommit} : {}), currentMainVerified: requireCurrentMain};
}

export async function dispatchFeedPublication({token, fetchImpl = globalThis.fetch,
  repository, ref, eventName, ...checkout} = {}) {
  need(repository === REPOSITORY_NAME && ref === 'refs/heads/main'
    && ['push', 'schedule', 'workflow_dispatch'].includes(eventName), 'untrusted_publication_dispatch');
  need(typeof token === 'string' && token.length > 0 && typeof fetchImpl === 'function', 'publication_dispatch_unconfigured');
  const verified = verifyPublicationCheckout({...checkout, requireCurrentMain: true, requireData: true});
  need(verified.commit !== verified.baseCommit, 'publication_dispatch_requires_data_commit');
  const endpoint = `https://api.github.com/repos/${REPOSITORY_NAME}/actions/workflows/pages-publication.yml/dispatches`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'},
      body: JSON.stringify({ref: 'main', inputs: {site_commit: verified.commit,
        base_commit: verified.baseCommit, feed: verified.feed}})
    });
  } catch { throw Error('publication_dispatch_unavailable'); }
  need(response?.status === 204, 'publication_dispatch_rejected');
  // A queued workflow is not proof that the published site changed.
  return {...verified, queued: true, published: false,
    workflowUrl: `https://github.com/${REPOSITORY_NAME}/actions/workflows/pages-publication.yml`};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    need(['--checkout', '--current', '--data-delta', '--deployment', '--dispatch'].includes(mode) && process.argv.length === 3, 'invalid_publication_mode');
    const checkout = {commit: process.env.PAGES_COMMIT,
      baseCommit: process.env.PAGES_BASE_COMMIT || '', feed: process.env.PAGES_FEED || '',
      requireCurrentMain: ['--current', '--deployment'].includes(mode), requireData: mode === '--data-delta'};
    const event = {eventSha: process.env.GITHUB_SHA, eventName: process.env.GITHUB_EVENT_NAME,
      repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF};
    if (mode === '--deployment') verifyPublicationEvent({...event, commit: checkout.commit});
    const result = mode === '--dispatch'
      ? await dispatchFeedPublication({...checkout, ...event, token: process.env.PAGES_DISPATCH_TOKEN})
      : verifyPublicationCheckout(checkout);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    // Only the helper's finite codes are emitted; never Git stderr or URLs.
    process.stderr.write(`Pages publication refused: ${error.message}\n`); process.exitCode = 1;
  }
}
