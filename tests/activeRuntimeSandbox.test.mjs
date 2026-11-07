import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareCiRuntime, writeCiOutputs, TRUSTED_TEST_REPOSITORY,
  MUTABLE_PUBLIC_DATA_FILES} from '../tools/browser-release/prepare-ci-runtime.mjs';
import {digest, mime} from '../tools/browser-release/verify.mjs';

async function fixture(t, {active = true, coordinateEvidence = false, workflowFixtures = false} = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'checkni-ci-sandbox-tests-'));
  t.after(async () => {
    const resolved = await fs.realpath(base);
    assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('checkni-ci-sandbox-tests-'));
    await fs.rm(resolved, {recursive: true, force: true});
  });
  const root = path.join(base, 'checkout'), runnerTemp = path.join(base, 'runner');
  await fs.mkdir(root); await fs.mkdir(runnerTemp);
  const env = {CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: TRUSTED_TEST_REPOSITORY, RUNNER_TEMP: runnerTemp};
  const write = async (file, body) => {await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true}); await fs.writeFile(path.join(root, file), body);};
  for (const file of ['index.html', 'prices.html']) await write(file, '<main>fixture</main><script src="./src/app.mjs"></script>');
  if (!active) return {root, runnerTemp, env, write};
  const git = (...args) => execFileSync('git', args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe']}).toString().trim();
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  await write('src/app.mjs', 'export const version=1;\n');
  await write('src/priceCapture.mjs', 'export const capture=1;\n');
  for (const file of MUTABLE_PUBLIC_DATA_FILES) await write(`src/data/${file}`, '{"generation":"release"}\n');
  for (const file of ['package.json', 'package-lock.json', 'deployment.json', 'release/proof.json']) await write(file, '{}\n');
  for (const file of ['playwright.weekly.config.mjs', 'test/support/static-server.mjs', 'tests/retailCatalogPort.test.mjs', 'tools/example.mjs']) await write(file, '// pinned test support\n');
  await write('test/e2e/reference-v13/linux/fixture.png', Buffer.from([0, 1, 2, 255]));
  await write('artifacts/nearby-shopping/catalog-geography-joins-20261024.json', '{"verifiedJoins":[]}\n');
  if (coordinateEvidence) await write('evidence/magnit-nearby-20261107/source-manifest.json', '{"pinned":true}\n');
  if (workflowFixtures) {
    for (const name of ['okey-public-data', 'pyaterochka-public-data', 'pages-publication']) {
      await write(`.github/workflows/${name}.yml`, `name: pinned ${name}\n`);
    }
    await write('.github/workflows/unrelated.yml', 'name: not a test dependency\n');
    await write('.github/unrelated.json', '{"mustNotCopy":true}\n');
    await write('tests/publicationFixture.test.mjs', `import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
for (const name of ['okey-public-data', 'pyaterochka-public-data', 'pages-publication']) {
  assert.equal(await readFile(new URL('../.github/workflows/'+name+'.yml', import.meta.url), 'utf8'), 'name: pinned '+name+'\\n');
}
`);
  }
  await write('evidence/unrelated.json', '{"excluded":true}\n');
  git('add', '.'); git('commit', '-m', 'fixture runtime and tests');
  const commit = git('rev-parse', 'HEAD');
  const files = ['index.html', 'prices.html', 'src/app.mjs', 'src/priceCapture.mjs', ...MUTABLE_PUBLIC_DATA_FILES.map(file => `src/data/${file}`)];
  const entries = [];
  for (const file of files) {const bytes = await fs.readFile(path.join(root, file)); entries.push({file, sha256: digest(bytes), bytes: bytes.length, mime: mime(file)});}
  const descriptor = {schemaVersion: 1, sourceCommit: commit, entries};
  const id = digest(JSON.stringify(descriptor)), manifest = {...descriptor, releaseId: id};
  for (const file of files) await write(`releases/${id}/${file}`, await fs.readFile(path.join(root, file)));
  await write(`releases/${id}/manifest.json`, JSON.stringify(manifest));
  const verification = {schemaVersion: 1, releaseId: id, repository: TRUSTED_TEST_REPOSITORY, testCommit: commit};
  await write(`release/verification/${id}.json`, JSON.stringify(verification));
  for (const file of ['index.html', 'prices.html']) {
    const original = await fs.readFile(path.join(root, file), 'utf8');
    await write(file, original.replace('./src/', `./releases/${id}/src/`));
  }
  await write('src/app.mjs', '// legacy visitor runtime\n');
  await write('tests/retailCatalogPort.test.mjs', '// legacy root test\n');
  for (const file of MUTABLE_PUBLIC_DATA_FILES) await write(`src/data/${file}`, '{"generation":"public-current"}\n');
  await write('src/data/not-allowlisted.json', '{"mustNotCopy":true}');
  return {root, runnerTemp, env, write, git, commit, id, verification, manifest};
}

test('source branches keep their checkout and the helper requires explicit hosted CI context', async t => {
  const f = await fixture(t, {active: false});
  assert.deepEqual(await prepareCiRuntime({...f, ciOnly: true}), {mode: 'source-checkout', root: await fs.realpath(f.root), releaseId: null});
  for (const options of [{ciOnly: false}, {env: {...f.env, CI: ''}}, {env: {...f.env, GITHUB_ACTIONS: ''}},
    {env: {...f.env, GITHUB_REPOSITORY: 'untrusted/repo'}}, {env: {...f.env, RUNNER_TEMP: f.root}}]) {
    await assert.rejects(prepareCiRuntime({...f, ciOnly: true, ...options}), /ci_only|unsafe_ci/u);
  }
  assert.deepEqual(await fs.readdir(f.runnerTemp), []);
});

test('active sandbox uses exact release bytes and pinned tests while retaining only allowlisted mutable observations', async t => {
  const f = await fixture(t), before = f.git('status', '--porcelain');
  const result = await prepareCiRuntime({...f, ciOnly: true});
  assert.equal(result.mode, 'verified-active-runtime');
  assert.equal(result.releaseId, f.id); assert.equal(result.testCommit, f.commit);
  assert.equal(path.dirname(result.root), await fs.realpath(f.runnerTemp));
  assert.equal(await fs.readFile(path.join(result.root, 'src/app.mjs'), 'utf8'), 'export const version=1;\n');
  assert.equal(await fs.readFile(path.join(result.root, 'tests/retailCatalogPort.test.mjs'), 'utf8'), '// pinned test support\n');
  assert.equal(await fs.readFile(path.join(result.root, 'index.html'), 'utf8'), '<main>fixture</main><script src="./src/app.mjs"></script>');
  assert.deepEqual(await fs.readFile(path.join(result.root, 'test/e2e/reference-v13/linux/fixture.png')), Buffer.from([0, 1, 2, 255]));
  for (const file of MUTABLE_PUBLIC_DATA_FILES) assert.equal(JSON.parse(await fs.readFile(path.join(result.root, 'src/data', file), 'utf8')).generation, 'public-current');
  for (const absent of ['src/data/not-allowlisted.json', '.git', 'releases']) await assert.rejects(fs.stat(path.join(result.root, absent)), {code: 'ENOENT'});
  assert.ok(await fs.stat(path.join(result.root, 'deployment.json')));
  assert.ok(await fs.stat(path.join(result.root, 'release/proof.json')));
  assert.equal(await fs.readFile(path.join(result.root, 'artifacts/nearby-shopping/catalog-geography-joins-20261024.json'), 'utf8'), '{"verifiedJoins":[]}\n');
  assert.equal(f.git('status', '--porcelain'), before);
  assert.equal(result.mutableData.length, 13);
});

test('coordinate evidence is pinned to the tested commit without exporting unrelated evidence', async t => {
  const f = await fixture(t, {coordinateEvidence: true});
  await f.write('evidence/magnit-nearby-20261107/source-manifest.json', '{"pinned":false}\n');
  const result = await prepareCiRuntime({...f, ciOnly: true});
  assert.equal(await fs.readFile(path.join(result.root, 'evidence/magnit-nearby-20261107/source-manifest.json'), 'utf8'), '{"pinned":true}\n');
  await assert.rejects(fs.stat(path.join(result.root, 'evidence/unrelated.json')), {code: 'ENOENT'});
});

test('publication contract tests can read only pinned workflow fixtures inside the active sandbox', async t => {
  const f = await fixture(t, {workflowFixtures: true});
  for (const name of ['okey-public-data', 'pyaterochka-public-data', 'pages-publication']) {
    await f.write(`.github/workflows/${name}.yml`, `name: changed live ${name}\n`);
  }
  const before = f.git('status', '--porcelain');
  const result = await prepareCiRuntime({...f, ciOnly: true});
  const {NODE_TEST_CONTEXT, ...childEnv} = process.env;
  const testResult = execFileSync(process.execPath, ['--test', 'tests/publicationFixture.test.mjs'],
    {cwd: result.root, encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'pipe']});
  assert.match(testResult, /# pass 1/u);
  assert.match(testResult, /# fail 0/u);
  for (const file of ['.github/workflows/unrelated.yml', '.github/unrelated.json']) {
    await assert.rejects(fs.stat(path.join(result.root, file)), {code: 'ENOENT'});
  }
  assert.equal(f.git('status', '--porcelain'), before);
  assert.equal(await fs.readFile(path.join(f.root, '.github/workflows/pages-publication.yml'), 'utf8'),
    'name: changed live pages-publication\n');
});

test('a linked workflow fixture is rejected before any sandbox extraction', async t => {
  const f = await fixture(t, {workflowFixtures: true});
  const object = execFileSync('git', ['hash-object', '-w', '--stdin'], {cwd: f.root, input: '../../../outside'}).toString().trim();
  f.git('update-index', '--add', '--cacheinfo', `120000,${object},.github/workflows/pages-publication.yml`);
  f.git('commit', '-m', 'bad workflow fixture link');
  await f.write(`release/verification/${f.id}.json`, JSON.stringify({...f.verification, testCommit: f.git('rev-parse', 'HEAD')}));
  await assert.rejects(prepareCiRuntime({...f, ciOnly: true}), /unsafe_test_support_tree/u);
  assert.deepEqual(await fs.readdir(f.runnerTemp), []);
});

test('invalid descriptors and mismatched activation or release content fail before sandbox creation', async t => {
  const f = await fixture(t), file = `release/verification/${f.id}.json`;
  for (const patch of [{testCommit: '--upload-pack=bad'}, {testCommit: '../escape'}, {releaseId: 'b'.repeat(64)}, {repository: 'other/repo'}]) {
    await f.write(file, JSON.stringify({...f.verification, ...patch}));
    await assert.rejects(prepareCiRuntime({...f, ciOnly: true}), /invalid_ci_verification_descriptor/u);
  }
  await f.write(file, JSON.stringify(f.verification));
  await f.write(`releases/${f.id}/src/app.mjs`, 'tampered');
  await assert.rejects(prepareCiRuntime({...f, ciOnly: true}), /release_content_mismatch/u);
  assert.deepEqual(await fs.readdir(f.runnerTemp), []);
});

test('a newer test commit cannot silently change any runtime blob', async t => {
  const f = await fixture(t);
  await f.write('src/app.mjs', 'export const version=2;\n');
  f.git('add', 'src/app.mjs'); f.git('commit', '-m', 'runtime changed');
  await f.write(`release/verification/${f.id}.json`, JSON.stringify({...f.verification, testCommit: f.git('rev-parse', 'HEAD')}));
  await assert.rejects(prepareCiRuntime({...f, ciOnly: true}), /test_commit_runtime_mismatch:src\/app.mjs/u);
  assert.deepEqual(await fs.readdir(f.runnerTemp), []);
});

test('a test-only followup commit is allowed when every runtime blob still matches', async t => {
  const f = await fixture(t);
  await f.write('tests/retailCatalogPort.test.mjs', '// updated assertions for the same runtime\n');
  f.git('add', 'tests/retailCatalogPort.test.mjs'); f.git('commit', '-m', 'test-only followup');
  const testCommit = f.git('rev-parse', 'HEAD');
  assert.notEqual(testCommit, f.manifest.sourceCommit);
  await f.write(`release/verification/${f.id}.json`, JSON.stringify({...f.verification, testCommit}));
  const result = await prepareCiRuntime({...f, ciOnly: true});
  assert.equal(result.testCommit, testCommit);
  assert.equal(await fs.readFile(path.join(result.root, 'tests/retailCatalogPort.test.mjs'), 'utf8'), '// updated assertions for the same runtime\n');
});

test('test archive symlinks are rejected before extraction', async t => {
  const f = await fixture(t);
  const object = execFileSync('git', ['hash-object', '-w', '--stdin'], {cwd: f.root, input: '../../outside'}).toString().trim();
  f.git('update-index', '--add', '--cacheinfo', `120000,${object},test/escape`);
  f.git('commit', '-m', 'bad test link');
  await f.write(`release/verification/${f.id}.json`, JSON.stringify({...f.verification, testCommit: f.git('rev-parse', 'HEAD')}));
  await assert.rejects(prepareCiRuntime({...f, ciOnly: true}), /unsafe_test_support_tree/u);
  assert.deepEqual(await fs.readdir(f.runnerTemp), []);
});

test('GitHub outputs must be regular files inside RUNNER_TEMP and cannot inject extra lines', async t => {
  const f = await fixture(t, {active: false});
  const file = path.join(f.runnerTemp, 'output'); await fs.writeFile(file, '');
  await writeCiOutputs({root: f.root, mode: 'source-checkout'}, {file, runnerTemp: f.runnerTemp});
  assert.match(await fs.readFile(file, 'utf8'), /workspace=.+checkout/u);
  const outside = path.join(f.root, 'output'); await fs.writeFile(outside, '');
  await assert.rejects(writeCiOutputs({root: f.root, mode: 'source-checkout'}, {file: outside, runnerTemp: f.runnerTemp}), /unsafe_github_output/u);
  await assert.rejects(writeCiOutputs({root: 'path\nextra=bad', mode: 'source-checkout'}, {file, runnerTemp: f.runnerTemp}), /unsafe_github_output/u);
  assert.equal(await fs.readFile(outside, 'utf8'), '');
});
