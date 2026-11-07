import path from 'node:path';
import {appendFile, realpath, stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FEED_FILES} from './publication-guard.mjs';

const SHA = /^[a-f0-9]{40}$/u;
const REPOSITORY = 'https://github.com/ZebraRectifier/checkni-g5-preview.git';
const need = (value, code) => { if (!value) throw Error(code); };
const gitFor = root => args => execFileSync('git', args, {cwd: root, encoding: 'utf8',
  timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
const safeRun = git => args => { try { return git(args).trim(); } catch { throw Error('feed_base_git_unavailable'); } };
const trustedOrigin = run => need([REPOSITORY, REPOSITORY.slice(0, -4)]
  .includes(run(['remote', 'get-url', 'origin'])), 'feed_base_untrusted_repository');

// An independent Pyaterochka checkpoint may survive another feed's update.
// Never accept changes to its own feed, runtime, entrypoints, gates or releases.
// Check every intervening commit, not only the final diff (a code revert is not
// evidence that the unreviewed intervening code was safe).
export function verifyFeedBaseAdvance({root = '.', baseCommit, candidateCommit,
  feed = 'pyaterochka', git = gitFor(root)} = {}) {
  need(feed === 'pyaterochka' && SHA.test(baseCommit ?? '') && SHA.test(candidateCommit ?? ''), 'feed_base_invalid_input');
  const run = safeRun(git);
  trustedOrigin(run);
  need(run(['rev-parse', 'HEAD']) === baseCommit, 'feed_base_checkout_mismatch');
  need(run(['status', '--porcelain', '--untracked-files=no']) === '', 'feed_base_dirty_checkout');
  if (baseCommit === candidateCommit) return {baseCommit, candidateCommit, commits: 0};
  const history = run(['rev-list', '--reverse', '--parents', '--max-count=65', `${baseCommit}..${candidateCommit}`]).split('\n');
  need(history.length > 0 && history.length <= 64, 'feed_base_history_unavailable');
  let previous = baseCommit;
  for (const row of history) {
    const [commit, parent, extra] = row.split(' ');
    need(SHA.test(commit ?? '') && parent === previous && !extra, 'feed_base_not_linear_descendant');
    const changes = run(['diff-tree', '--no-commit-id', '--name-status', '-r', '--no-renames', previous, commit, '--']);
    need(changes.length > 0, 'feed_base_empty_commit');
    for (const line of changes.split('\n')) {
      const [status, file, extraField] = line.split('\t');
      need(['A', 'M'].includes(status) && !extraField && FEED_FILES.okey.includes(file), 'feed_base_unreviewed_change');
      for (const ref of status === 'M' ? [previous, commit] : [commit]) {
        const entry = run(['ls-tree', ref, '--', file]);
        need(new RegExp(`^100644 blob [a-f0-9]{40}\\t${file.replaceAll('.', '\\.')}$`, 'u').test(entry), 'feed_base_not_regular');
      }
    }
    previous = commit;
  }
  need(previous === candidateCommit, 'feed_base_history_unavailable');
  return {baseCommit, candidateCommit, commits: history.length};
}

export function advanceReviewedFeedBase({root = '.', baseCommit, git = gitFor(root)} = {}) {
  need(SHA.test(baseCommit ?? ''), 'feed_base_invalid_input');
  const run = safeRun(git);
  trustedOrigin(run);
  const remoteHead = () => {
    const value = run(['ls-remote', '--exit-code', REPOSITORY, 'refs/heads/main']);
    need(/^[a-f0-9]{40}\trefs\/heads\/main$/u.test(value), 'feed_base_invalid_remote');
    return value.slice(0, 40);
  };
  const candidateCommit = remoteHead();
  // A fixed trusted origin and an exact SHA; never evaluate a caller-supplied ref.
  if (candidateCommit !== baseCommit) run(['fetch', '--no-tags', '--depth=65', 'origin', candidateCommit]);
  const verified = verifyFeedBaseAdvance({root, baseCommit, candidateCommit, git});
  need(remoteHead() === candidateCommit, 'feed_base_main_advanced');
  if (candidateCommit !== baseCommit) run(['merge', '--ff-only', '--no-edit', candidateCommit]);
  need(run(['rev-parse', 'HEAD']) === candidateCommit, 'feed_base_checkout_mismatch');
  need(remoteHead() === candidateCommit, 'feed_base_main_advanced');
  return {...verified, currentMainVerified: true};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 2 && process.env.GITHUB_ACTIONS === 'true'
      && process.env.GITHUB_REPOSITORY === 'ZebraRectifier/checkni-g5-preview'
      && process.env.GITHUB_REF === 'refs/heads/main'
      && ['push', 'schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME), 'feed_base_untrusted_event');
    need(process.env.RUNNER_TEMP && process.env.GITHUB_ENV, 'feed_base_environment_unavailable');
    const temp = await realpath(process.env.RUNNER_TEMP), envFile = await realpath(process.env.GITHUB_ENV);
    const relative = path.relative(temp, envFile);
    need(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      && (await stat(envFile)).isFile(), 'feed_base_environment_unavailable');
    const result = advanceReviewedFeedBase({baseCommit: process.env.PYAT_MAIN_BASE});
    await appendFile(envFile, `PYAT_MAIN_BASE=${result.candidateCommit}\n`);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const code = /^feed_base_[a-z_]+$/u.test(error.message) ? error.message : 'feed_base_environment_unavailable';
    process.stderr.write(`Feed base refused: ${code}\n`); process.exitCode = 1;
  }
}
