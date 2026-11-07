import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {activationState, verifyLocal, digest} from './verify.mjs';

export const TRUSTED_TEST_REPOSITORY = 'ZebraRectifier/checkni-g5-preview';
const TRUSTED_FETCH_URL = 'https://github.com/ZebraRectifier/checkni-g5-preview.git';
const SHA = /^[a-f0-9]{40}$/u;
const MAX_BYTES = 128 * 1024 * 1024;
const SUPPORT_PATHS = ['test', 'tests', 'tools', 'package.json', 'package-lock.json',
  'playwright.weekly.config.mjs', 'deployment.json', 'release',
  // Publication-contract tests read these as fixtures from the same pinned
  // test commit. Never substitute the current checkout's workflows.
  '.github/workflows/okey-public-data.yml', '.github/workflows/pyaterochka-public-data.yml',
  '.github/workflows/pages-publication.yml',
  'artifacts/nearby-shopping/catalog-geography-joins-20261024.json',
  'evidence/magnit-nearby-20261107'];
export const MUTABLE_PUBLIC_DATA_FILES = Object.freeze([
  'nearbyGroceryStores.json',
  ...['saint-petersburg', 'kazan', 'yekaterinburg', 'novosibirsk', 'nizhny-novgorod'].map(city => `nearby-regions/${city}.json`),
  'pyaterochkaPublishedPromotions.json', 'okeyOfficialPromotions.json', 'okeyOfficialRefresh.json',
  'okeyPublishedPromotions.json', 'okeyPublishedRefresh.json', 'okeyDeliveryHistory.json', 'okeyDeliveryRefresh.json'
]);
const inside = (parent, child) => child !== parent && child.startsWith(parent + path.sep);
const safeRelative = value => typeof value === 'string' && !value.includes('\\') && !value.includes(':')
  && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..');
const git = (root, args, input) => execFileSync('git', args, {cwd: root, input,
  maxBuffer: MAX_BYTES, stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, GIT_TERMINAL_PROMPT: '0'}});

async function regularFile(root, relative) {
  if (!safeRelative(relative)) throw Error('unsafe_ci_path');
  const segments = relative.split('/');
  let current = root;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || (i < segments.length - 1 ? !info.isDirectory() : !info.isFile())) {
      throw Error('linked_or_special_ci_input');
    }
  }
  if (!inside(root, await fs.realpath(current))) throw Error('ci_input_outside_root');
  return current;
}

export function verifyTestCommitRuntime(root, commit, manifest) {
  if (!SHA.test(commit)) throw Error('invalid_test_commit');
  if (manifest.entries.reduce((total, entry) => total + entry.bytes, 0) > MAX_BYTES / 2) throw Error('ci_runtime_too_large');
  const buffer = git(root, ['cat-file', '--batch'], manifest.entries.map(entry => `${commit}:${entry.file}`).join('\n') + '\n');
  let offset = 0;
  for (const entry of manifest.entries) {
    const end = buffer.indexOf(10, offset);
    const header = buffer.subarray(offset, end).toString('utf8');
    const match = /^[a-f0-9]{40} blob (\d+)$/u.exec(header);
    if (end < offset || !match) throw Error('test_commit_missing_runtime:' + entry.file);
    const size = Number(match[1]), bytes = buffer.subarray(end + 1, end + 1 + size);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw Error('test_commit_runtime_mismatch:' + entry.file);
    offset = end + size + 2;
  }
  if (offset !== buffer.length) throw Error('invalid_git_blob_batch');
}

function supportTree(root, commit) {
  const raw = git(root, ['ls-tree', '-r', '-z', commit, '--', ...SUPPORT_PATHS]).toString('utf8');
  const entries = raw.split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(record);
    const name = match?.[3];
    if (!match || !safeRelative(name) || !SUPPORT_PATHS.some(prefix => name === prefix || name.startsWith(prefix + '/'))) {
      throw Error('unsafe_test_support_tree');
    }
    return {file: name, oid: match[2]};
  });
  for (const required of ['package.json', 'package-lock.json', 'playwright.weekly.config.mjs',
    'test/support/static-server.mjs', 'tests/retailCatalogPort.test.mjs']) {
    if (!entries.some(entry => entry.file === required)) throw Error('missing_test_support:' + required);
  }
  return entries;
}

/** Build a disposable test view. Never modify the publishing checkout. */
export async function prepareCiRuntime({root = '.', env = process.env, ciOnly = false} = {}) {
  if (!ciOnly || env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true' || !env.RUNNER_TEMP
      || env.GITHUB_REPOSITORY?.toLowerCase() !== TRUSTED_TEST_REPOSITORY.toLowerCase()) throw Error('ci_only_required');
  const checkout = await fs.realpath(root), runnerTemp = await fs.realpath(env.RUNNER_TEMP);
  if (checkout === runnerTemp || inside(checkout, runnerTemp) || inside(runnerTemp, checkout)) throw Error('unsafe_ci_temp_root');
  const active = await activationState(checkout);
  if (!active) return {mode: 'source-checkout', root: checkout, releaseId: null};
  const manifest = await verifyLocal(checkout, active);
  const descriptorPath = await regularFile(checkout, `release/verification/${active}.json`);
  const descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
  if (descriptor.schemaVersion !== 1 || descriptor.releaseId !== active || !SHA.test(descriptor.testCommit ?? '')
      || descriptor.repository !== TRUSTED_TEST_REPOSITORY) throw Error('invalid_ci_verification_descriptor');
  const commit = descriptor.testCommit;
  try { git(checkout, ['cat-file', '-e', `${commit}^{commit}`]); }
  catch { git(checkout, ['fetch', '--no-tags', '--depth=1', TRUSTED_FETCH_URL, commit]); }
  if (git(checkout, ['rev-parse', '--verify', `${commit}^{commit}`]).toString('utf8').trim() !== commit) throw Error('test_commit_not_exact');
  verifyTestCommitRuntime(checkout, commit, manifest);
  const support = supportTree(checkout, commit); // Reject links/special entries before extraction.
  const mutable = [];
  for (const name of MUTABLE_PUBLIC_DATA_FILES) {
    const file = await regularFile(checkout, `src/data/${name}`), bytes = await fs.readFile(file);
    if (bytes.length > 20 * 1024 * 1024) throw Error('mutable_data_too_large');
    JSON.parse(bytes.toString('utf8'));
    mutable.push({name, bytes, sha256: digest(bytes)});
  }

  const destination = await fs.mkdtemp(path.join(runnerTemp, 'checkni-active-runtime-'));
  const resolved = await fs.realpath(destination);
  if (path.dirname(resolved) !== runnerTemp || !path.basename(resolved).startsWith('checkni-active-runtime-')) throw Error('unsafe_ci_destination');
  try {
    // New, narrowly named evidence packets are optional for retained releases.
    // Archive only paths that exist in the pinned test commit, never live files.
    const archivePaths = SUPPORT_PATHS.filter(prefix => support.some(entry => entry.file === prefix || entry.file.startsWith(prefix + '/')));
    const archive = git(checkout, ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=tar', commit, '--', ...archivePaths]);
    execFileSync('tar', ['-xf', '-', '-C', resolved], {input: archive, maxBuffer: MAX_BYTES, stdio: ['pipe', 'pipe', 'pipe']});
    for (const entry of support) {
      const bytes = await fs.readFile(await regularFile(resolved, entry.file));
      const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (oid !== entry.oid) throw Error('test_archive_content_mismatch:' + entry.file);
    }
    for (const entry of manifest.entries) {
      const source = await regularFile(checkout, `releases/${active}/${entry.file}`);
      const target = path.resolve(resolved, entry.file);
      if (!inside(resolved, target)) throw Error('unsafe_ci_runtime_target');
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.copyFile(source, target);
      const copied = await fs.readFile(target);
      if (copied.length !== entry.bytes || digest(copied) !== entry.sha256) throw Error('ci_copy_changed_runtime');
    }
    // Only this named observation set can differ from the immutable runtime.
    // Code, styles, images and preview entrypoints remain byte-for-byte exact.
    for (const {name, bytes} of mutable) {
      const target = path.join(resolved, 'src', 'data', name);
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.writeFile(target, bytes);
    }
    await verifyLocal(checkout, active);
    if (await activationState(checkout) !== active) throw Error('activation_changed_during_ci_prepare');
    const result = {mode: 'verified-active-runtime', root: resolved, releaseId: active, testCommit: commit,
      runtimeFiles: manifest.entries.length, mutableData: mutable.map(({name, sha256}) => ({name, sha256}))};
    await fs.writeFile(path.join(resolved, 'ci-runtime-evidence.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  } catch (error) {
    // Only the uniquely created and already resolved temporary directory.
    if (path.dirname(resolved) === runnerTemp && path.basename(resolved).startsWith('checkni-active-runtime-')) {
      await fs.rm(resolved, {recursive: true, force: true});
    }
    throw error;
  }
}

export async function writeCiOutputs(result, {file = process.env.GITHUB_OUTPUT, runnerTemp = process.env.RUNNER_TEMP} = {}) {
  if (!file) return;
  const temp = await fs.realpath(runnerTemp), output = await fs.realpath(file);
  if (!inside(temp, output) || (await fs.lstat(file)).isSymbolicLink() || !(await fs.stat(output)).isFile()
      || /[\r\n]/u.test(result.root) || !['source-checkout', 'verified-active-runtime'].includes(result.mode)) {
    throw Error('unsafe_github_output');
  }
  await fs.appendFile(output, `workspace=${result.root}${os.EOL}mode=${result.mode}${os.EOL}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--ci-only')) throw Error('unsupported_ci_argument');
    const result = await prepareCiRuntime({ciOnly: process.argv.includes('--ci-only')});
    // GitHub outputs are paths generated above, never descriptor-controlled.
    await writeCiOutputs(result);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
