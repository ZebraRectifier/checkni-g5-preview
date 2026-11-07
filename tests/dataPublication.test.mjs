import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyPublicationCheckout, FEED_FILES} from '../tools/browser-release/publication-guard.mjs';

const ORIGIN = 'https://github.com/ZebraRectifier/checkni-g5-preview.git';
async function repository(t) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'checkni-publication-'));
  assert.equal(path.dirname(root), parent);
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const git = (args, input) => execFileSync('git', args, {cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe']}).trim();
  git(['init', '--initial-branch=main']); git(['config', 'user.name', 'Offline fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'core.autocrlf', 'false']);
  git(['remote', 'add', 'origin', ORIGIN]);
  const write = async (file, body = '{}\n') => { await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true}); await fs.writeFile(path.join(root, file), body); };
  for (const file of [...Object.values(FEED_FILES).flat(), 'index.html', 'prices.html', 'deployment.json', 'releases/fixed/src/app.mjs']) await write(file);
  git(['add', '.']); git(['commit', '-m', 'reviewed source fixture']);
  const baseCommit = git(['rev-parse', 'HEAD']);
  return {root, git, write, baseCommit, commit: () => { git(['add', '.']); git(['commit', '-m', 'data observation fixture']); return git(['rev-parse', 'HEAD']); }};
}
const readWithRemote = (repo, current) => args => args[0] === 'ls-remote' ? `${current}\trefs/heads/main` : repo.git(args);

test('an exact data-only child preserves all runtime bytes and permits only the current main commit', async t => {
  const repo = await repository(t), before = repo.git(['rev-parse', 'HEAD:index.html']);
  await repo.write(FEED_FILES.pyaterochka[0], '{"observation":"new source measurement"}\n');
  const commit = repo.commit(), options = {...repo, commit, feed: 'pyaterochka', requireData: true, git: readWithRemote(repo, commit)};
  assert.deepEqual(verifyPublicationCheckout(options), {commit, feed: 'pyaterochka', baseCommit: repo.baseCommit, currentMainVerified: true});
  assert.equal(repo.git(['rev-parse', 'HEAD:index.html']), before);
  assert.throws(() => verifyPublicationCheckout({...options, git: readWithRemote(repo, repo.baseCommit)}), /main_advanced/);
  assert.throws(() => verifyPublicationCheckout({...options, commit: repo.baseCommit}), /checkout_mismatch/);
});

test('a feed cannot deploy another feed, entrypoint, release, metadata, deletion or renamed path', async t => {
  for (const file of ['index.html', 'prices.html', 'deployment.json', 'releases/fixed/src/app.mjs', FEED_FILES.okey[0]]) {
    const repo = await repository(t); await repo.write(file, 'changed\n'); const commit = repo.commit();
    assert.throws(() => verifyPublicationCheckout({...repo, commit, feed: 'pyaterochka', git: readWithRemote(repo, commit)}), /not_data_only/);
  }
  const repo = await repository(t); await fs.unlink(path.join(repo.root, FEED_FILES.pyaterochka[0])); const commit = repo.commit();
  assert.throws(() => verifyPublicationCheckout({...repo, commit, feed: 'pyaterochka', git: readWithRemote(repo, commit)}), /not_data_only/);
});

test('data publication refuses multiple commits, symlink blobs and partial or unknown input contracts', async t => {
  const repo = await repository(t);
  await repo.write(FEED_FILES.pyaterochka[0], 'first\n'); repo.commit();
  await repo.write(FEED_FILES.pyaterochka[0], 'second\n'); const commit = repo.commit();
  assert.throws(() => verifyPublicationCheckout({...repo, commit, feed: 'pyaterochka', git: readWithRemote(repo, commit)}), /not_single_data_commit/);
  const linked = await repository(t), target = FEED_FILES.pyaterochka[0];
  const blob = linked.git(['hash-object', '-w', '--stdin'], '../../index.html');
  linked.git(['update-index', '--cacheinfo', `120000,${blob},${target}`]);
  linked.git(['commit', '-m', 'symlink fixture without filesystem link']); const linkedCommit = linked.git(['rev-parse', 'HEAD']);
  assert.throws(() => verifyPublicationCheckout({...linked, commit: linkedCommit, feed: 'pyaterochka', git: readWithRemote(linked, linkedCommit)}), /not_data_only|data_not_regular/);
  for (const invalid of [{feed: 'other', baseCommit: commit}, {feed: 'okey'}, {baseCommit: commit}, {feed: 'okey', baseCommit: 'refs/heads/main'}, {requireData: true}]) {
    assert.throws(() => verifyPublicationCheckout({commit, ...invalid, git: () => assert.fail('Reject before Git')}), /invalid_feed_publication/);
  }
});

test('foreign origins, non-SHA refs and noisy git errors cannot reach publication', () => {
  const commit = 'a'.repeat(40);
  for (const invalid of ['main', 'refs/pull/12/head', '../outside', 'a'.repeat(39), `${commit}\n`]) {
    assert.throws(() => verifyPublicationCheckout({commit: invalid, git: () => assert.fail('No Git')}), /invalid_publication_commit/);
  }
  for (const origin of ['https://github.com/fork/checkni-g5-preview.git', 'https://user:secret@github.com/ZebraRectifier/checkni-g5-preview.git', ORIGIN + '?token=secret']) {
    assert.throws(() => verifyPublicationCheckout({commit, git: () => origin}), /untrusted_publication_repository/);
  }
  assert.throws(() => verifyPublicationCheckout({commit, git: () => { throw Error('secret bearer and private URL'); }}), error => error.message === 'publication_git_unavailable');
});

test('source preview verification is separate from production-head acceptance', async t => {
  const repo = await repository(t), commit = repo.baseCommit;
  const result = verifyPublicationCheckout({root: repo.root, commit, baseCommit: '', feed: '', requireCurrentMain: false,
    git: args => { assert.notEqual(args[0], 'ls-remote'); return repo.git(args); }});
  assert.equal(result.currentMainVerified, false);
  assert.equal(verifyPublicationCheckout({root: repo.root, commit, git: readWithRemote(repo, commit)}).currentMainVerified, true);
});

test('both feeds have one data-only handoff and no incomplete Pages deployment path', async () => {
  for (const [name, feed] of [['okey-public-data', 'okey'], ['pyaterochka-public-data', 'pyaterochka']]) {
    const workflow = await fs.readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    assert.doesNotMatch(workflow, /actions\/(?:deploy-pages|upload-pages-artifact|configure-pages)|cp .*_site|mkdir .*_site/);
    assert.match(workflow, /uses: \.\/\.github\/workflows\/pages-publication\.yml/);
    assert.match(workflow, /site_commit: \$\{\{ needs\.publish\.outputs\.site_commit \}\}/);
    assert.match(workflow, /base_commit: \$\{\{ needs\.publish\.outputs\.base_commit \}\}/);
    assert.match(workflow, new RegExp(`feed: ${feed}`));
    assert.match(workflow, /publication-guard\.mjs --data-delta/);
    assert.match(workflow, /Require (?:fresh prices|a verified current automated source result)/);
    for (const line of workflow.split('\n').filter(line => line.trim().startsWith('git add '))) {
      for (const file of line.trim().slice('git add '.length).split(' ')) assert.ok(FEED_FILES[feed].includes(file));
    }
    const sourceJob = workflow.slice(workflow.indexOf('  publish:'), workflow.indexOf('  pages:'));
    assert.doesNotMatch(sourceJob, /pages: write|id-token: write|environment:/);
  }
  const pyat = await fs.readFile(new URL('../.github/workflows/pyaterochka-public-data.yml', import.meta.url), 'utf8');
  assert.ok(pyat.indexOf('prepare-ci-runtime.mjs --ci-only') < pyat.indexOf('Verify actual checkout'));
  assert.ok(pyat.indexOf('npx playwright test') < pyat.indexOf('Reserve one attempt'));
  assert.match(pyat, /timeout-minutes: 30/);
});

test('the shared publisher packages releases, validates activation and rechecks current main after the deployment queue', async () => {
  const workflow = await fs.readFile(new URL('../.github/workflows/pages-publication.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /group: pages-.*'production'/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /git archive .* HEAD -- .* src releases release artifacts/);
  assert.match(workflow, /if \(!await activationState\('_site'\)\) throw Error\('active_release_required'\)/);
  assert.equal((workflow.match(/inputs\.site_commit \|\| github\.event\.pull_request\.head\.sha \|\| github\.sha/g) || []).length, 2);
  assert.equal((workflow.match(/publication-guard\.mjs --current/g) || []).length, 2);
  const deploy = workflow.slice(workflow.indexOf('  deploy:'));
  assert.ok(deploy.indexOf('--current') < deploy.indexOf('uses: actions/deploy-pages'));
  assert.match(deploy, /ref: \$\{\{ needs\.build\.outputs\.site_commit \}\}/);
  assert.match(workflow, /repository: ZebraRectifier\/checkni-g5-preview/);
});
