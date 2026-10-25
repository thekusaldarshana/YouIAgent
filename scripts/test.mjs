// @ts-check
import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = ['harness', 'web', 'shared', 'setup', 'test', 'scripts'];
const SOURCE_FILES = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'tsconfig.client.json', 'setup.mjs'];

async function walk(/** @type {string} */ directory, /** @type {(path: string) => boolean} */ keep) {
  /** @type {string[]} */
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walk(path, keep));
    else if (keep(path)) found.push(path);
  }
  return found;
}

async function newestSourceTime() {
  const files = [
    ...SOURCE_FILES.map((name) => join(root, name)),
    ...(await Promise.all(SOURCE_DIRS.map((dir) => walk(join(root, dir), () => true)))).flat(),
  ];
  let newest = 0;
  for (const file of files) newest = Math.max(newest, (await stat(file).catch(() => null))?.mtimeMs ?? 0);
  return newest;
}

const stamp = await stat(join(root, 'dist', '.build-stamp')).catch(() => null);
if (!stamp) {
  console.error('test: dist/ is missing. Run `npm run build` first; tests run against the compiled output.');
  process.exit(1);
}
if (await newestSourceTime() > stamp.mtimeMs) {
  console.error('test: dist/ is older than the sources. Run `npm run build` so the tests exercise current code.');
  process.exit(1);
}

const tests = (await walk(join(root, 'dist'), (path) => path.endsWith('.test.js'))).sort();
if (!tests.length) {
  console.error('test: no compiled tests found in dist/.');
  process.exit(1);
}
console.log(`test: ${tests.length} compiled test files`);

const browserBundle = join(root, 'dist', 'web', 'public', 'app.js');
const syntax = spawnSync(process.execPath, ['--check', browserBundle], { stdio: 'inherit' });
if (syntax.status !== 0) {
  console.error(`test: browser bundle ${relative(root, browserBundle)} failed its syntax check.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
