import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SHA = /^[a-f0-9]{40}$/u;
const REPOSITORY = 'https://github.com/ZebraRectifier/checkni-g5-preview.git';
export const FEED_FILES = Object.freeze({
  okey: Object.freeze(['okeyDeliveryHistory', 'okeyDeliveryRefresh', 'okeyOfficialPromotions',
    'okeyOfficialRefresh', 'okeyPublishedPromotions', 'okeyPublishedRefresh'].map(name => `src/data/${name}.json`)),
  pyaterochka: Object.freeze(['src/data/pyaterochkaPublishedPromotions.json', 'src/data/pyaterochkaPublishedRefresh.json'])
});
const need = (value, code) => { if (!value) throw Error(code); };

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    need(['--checkout', '--current', '--data-delta'].includes(mode) && process.argv.length === 3, 'invalid_publication_mode');
    const result = verifyPublicationCheckout({commit: process.env.PAGES_COMMIT,
      baseCommit: process.env.PAGES_BASE_COMMIT || '', feed: process.env.PAGES_FEED || '',
      requireCurrentMain: mode === '--current', requireData: mode === '--data-delta'});
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    // Only the helper's finite codes are emitted; never Git stderr or URLs.
    process.stderr.write(`Pages publication refused: ${error.message}\n`); process.exitCode = 1;
  }
}
