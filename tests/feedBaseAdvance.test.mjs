import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyFeedBaseAdvance, advanceReviewedFeedBase} from '../tools/browser-release/advance-feed-base.mjs';
import {FEED_FILES} from '../tools/browser-release/publication-guard.mjs';

const ORIGIN = 'https://github.com/ZebraRectifier/checkni-g5-preview.git';
const statusFile = 'src/data/okeyPublishedRefresh.json';
async function repository(t) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'checkni-feed-base-'));
  assert.equal(path.dirname(root), parent);
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const git = (args, input) => execFileSync('git', args, {cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe']}).trim();
  git(['init', '--initial-branch=main']); git(['config', 'user.name', 'Offline fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'core.autocrlf', 'false']);
  git(['remote', 'add', 'origin', ORIGIN]);
  const write = async (file, body = '{}\n') => { await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true}); await fs.writeFile(path.join(root, file), body); };
  const runtime = ['src/app.mjs', 'index.html', 'deployment.json', 'release/verification/fixed.json',
    'releases/fixed/src/app.mjs', '.github/workflows/pyaterochka-public-data.yml', 'tests/gate.test.mjs', 'package-lock.json'];
  for (const file of [...Object.values(FEED_FILES).flat(), ...runtime]) await write(file);
  const commit = () => { git(['add', '.']); git(['commit', '-m', 'offline fixture']); return git(['rev-parse', 'HEAD']); };
  const baseCommit = commit();
  const verify = candidateCommit => verifyFeedBaseAdvance({root, baseCommit, candidateCommit, git});
  const checkedBase = () => git(['checkout', '--detach', baseCommit]);
  return {root, git, write, commit, baseCommit, verify, checkedBase, runtime};
}

test('checked Pyaterochka can advance over multiple OKEY updates without losing checkpoint data or changing runtime bytes', async t => {
  const repo = await repository(t), blobs = repo.runtime.map(file => repo.git(['rev-parse', `HEAD:${file}`]));
  await repo.write(statusFile, '{"attempt":"first"}\n'); repo.commit();
  await repo.write(FEED_FILES.okey[0], '{"observations":[]}\n'); const candidateCommit = repo.commit();
  repo.checkedBase();
  await repo.write('_pyat_state/src/data/pyaterochkaPublishedRefresh.json', '{"reservation":"preserved"}\n');
  const calls = [], result = advanceReviewedFeedBase({...repo, git: args => {
    calls.push(args);
    if (args[0] === 'ls-remote') return `${candidateCommit}\trefs/heads/main`;
    if (args[0] === 'fetch') return '';
    return repo.git(args);
  }});
  assert.deepEqual(result, {baseCommit: repo.baseCommit, candidateCommit, commits: 2, currentMainVerified: true});
  assert.deepEqual(calls.find(args => args[0] === 'fetch'), ['fetch', '--no-tags', '--depth=65', 'origin', candidateCommit]);
  assert.equal(repo.git(['rev-parse', 'HEAD']), candidateCommit);
  assert.deepEqual(repo.runtime.map(file => repo.git(['rev-parse', `HEAD:${file}`])), blobs);
  assert.equal(await fs.readFile(path.join(repo.root, '_pyat_state/src/data/pyaterochkaPublishedRefresh.json'), 'utf8'), '{"reservation":"preserved"}\n');
});

test('unchanged main is rechecked without fetching or merging', async t => {
  const repo = await repository(t);
  const result = advanceReviewedFeedBase({...repo, git: args => {
    assert.ok(!['fetch', 'merge'].includes(args[0]));
    return args[0] === 'ls-remote' ? `${repo.baseCommit}\trefs/heads/main` : repo.git(args);
  }});
  assert.equal(result.commits, 0);
  assert.equal(result.currentMainVerified, true);
});

test('runtime, release, workflow, dependency, tests and own-feed advances remain unreviewed', async t => {
  const probe = await repository(t);
  for (const file of [...probe.runtime, ...FEED_FILES.pyaterochka]) {
    const repo = await repository(t);
    await repo.write(file, '{"changed":true}\n'); const candidate = repo.commit(); repo.checkedBase();
    assert.throws(() => repo.verify(candidate), /feed_base_unreviewed_change/, file);
    assert.equal(repo.git(['rev-parse', 'HEAD']), repo.baseCommit);
  }
});

test('a runtime modification followed by a revert cannot be hidden by a data-only final diff', async t => {
  const repo = await repository(t);
  await repo.write('src/app.mjs', 'unreviewed\n'); repo.commit();
  await repo.write('src/app.mjs'); await repo.write(statusFile, '{"new":true}\n'); const candidate = repo.commit();
  assert.equal(repo.git(['diff', '--name-only', repo.baseCommit, candidate]), statusFile);
  repo.checkedBase(); assert.throws(() => repo.verify(candidate), /feed_base_unreviewed_change/);
});

test('deletions, renames, executable entries and symlinks are rejected', async t => {
  for (const kind of ['delete', 'rename', 'executable', 'symlink']) {
    const repo = await repository(t);
    if (kind === 'delete') await fs.unlink(path.join(repo.root, statusFile));
    if (kind === 'rename') await fs.rename(path.join(repo.root, statusFile), path.join(repo.root, 'outside.json'));
    let candidate;
    if (kind === 'executable' || kind === 'symlink') {
      const blob = repo.git(['hash-object', '-w', '--stdin'], kind === 'symlink' ? '../../index.html' : '{"changed":true}');
      repo.git(['update-index', '--cacheinfo', `${kind === 'symlink' ? '120000' : '100755'},${blob},${statusFile}`]);
      // Build the non-regular commit without materializing a symlink on Windows.
      candidate = repo.git(['commit-tree', repo.git(['write-tree']), '-p', repo.baseCommit, '-m', 'non-regular fixture']);
      repo.git(['read-tree', repo.baseCommit]);
    } else candidate = repo.commit();
    repo.checkedBase(); assert.throws(() => repo.verify(candidate), /feed_base_unreviewed_change|feed_base_not_regular/, kind);
  }
});

test('dirty tracked files, unrelated history and merges cannot replace the checked base', async t => {
  const repo = await repository(t);
  await repo.write(statusFile, '{"first":true}\n'); const candidate = repo.commit(); repo.checkedBase();
  await repo.write('src/app.mjs', 'local change'); assert.throws(() => repo.verify(candidate), /dirty_checkout/);
  repo.git(['restore', 'src/app.mjs']);
  await repo.write(FEED_FILES.okey[0], '{"side":true}\n'); const side = repo.commit();
  assert.throws(() => verifyFeedBaseAdvance({...repo, baseCommit: side, candidateCommit: candidate}), /not_linear_descendant/);
  repo.git(['merge', '--no-ff', '--no-edit', candidate]); const merge = repo.git(['rev-parse', 'HEAD']); repo.checkedBase();
  assert.throws(() => repo.verify(merge), /not_linear_descendant/);
});

test('main racing before or after fast-forward does not produce a successful acceptance', async t => {
  for (const afterMerge of [false, true]) {
    const repo = await repository(t);
    await repo.write(statusFile, '{"first":true}\n'); const candidate = repo.commit(); repo.checkedBase();
    let checks = 0;
    assert.throws(() => advanceReviewedFeedBase({...repo, git: args => {
      if (args[0] === 'ls-remote') return `${++checks >= (afterMerge ? 3 : 2) ? 'f'.repeat(40) : candidate}\trefs/heads/main`;
      if (args[0] === 'fetch') return '';
      return repo.git(args);
    }}), /feed_base_main_advanced/);
    assert.equal(repo.git(['rev-parse', 'HEAD']), afterMerge ? candidate : repo.baseCommit);
  }
});

test('foreign origins, invalid input and overly long history fail before advancing', async t => {
  for (const baseCommit of ['main', 'a'.repeat(39), 'a'.repeat(40) + '\n']) {
    assert.throws(() => advanceReviewedFeedBase({baseCommit, git: () => assert.fail('No Git for invalid input')}), /invalid_input/);
  }
  assert.throws(() => verifyFeedBaseAdvance({baseCommit: 'a'.repeat(40), candidateCommit: 'b'.repeat(40), feed: 'okey', git: () => assert.fail('Unsupported checkpoint')}), /invalid_input/);
  const repo = await repository(t);
  repo.git(['remote', 'set-url', 'origin', 'https://github.com/fork/checkni-g5-preview.git']);
  assert.throws(() => repo.verify(repo.baseCommit), /untrusted_repository/);
  assert.throws(() => verifyFeedBaseAdvance({baseCommit: 'a'.repeat(40), candidateCommit: 'b'.repeat(40), git: args => {
    if (args[0] === 'remote') return ORIGIN;
    if (args[0] === 'rev-parse') return 'a'.repeat(40);
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-list') return Array(65).fill(`${'b'.repeat(40)} ${'a'.repeat(40)}`).join('\n');
    assert.fail('No further reads');
  }}), /history_unavailable/);
});

test('Pyaterochka uses checked advances at all boundaries while retaining exact-main and checkpoint guards', async () => {
  const workflow = await fs.readFile(new URL('../.github/workflows/pyaterochka-public-data.yml', import.meta.url), 'utf8');
  assert.equal((workflow.match(/run: node tools\/browser-release\/advance-feed-base.mjs/g) || []).length, 3);
  assert.ok(workflow.indexOf('npx playwright test') < workflow.indexOf('Accept only another feed'));
  assert.ok(workflow.indexOf('Accept only another feed') < workflow.indexOf('Reserve one attempt'));
  assert.ok(workflow.indexOf('Recheck the reviewed base before navigation') < workflow.indexOf('Collect one ordinary'));
  assert.ok(workflow.indexOf('Recheck the reviewed base before publishing') < workflow.indexOf('Publish only the two feed'));
  assert.match(workflow, /if: steps.collection_base.outcome == 'success'/);
  assert.match(workflow, /steps.result_checkpoint.outcome == 'success' && steps.publication_base.outcome == 'success'/);
  assert.equal((workflow.match(/test "\$\(git ls-remote origin refs\/heads\/main \| cut -f1\)" = "\$PYAT_MAIN_BASE"/g) || []).length, 3);
  assert.match(workflow, /steps.reserve.outputs.source_allowed == 'true' && steps.reservation_checkpoint.outputs.acknowledged == 'true'/);
  assert.match(workflow, /PAGES_BASE_COMMIT="\$PYAT_MAIN_BASE" PAGES_FEED=pyaterochka node tools\/browser-release\/publication-guard.mjs --data-delta/);
});
