#!/usr/bin/env node
// @ts-check
/*
 * Bootstrap for a fresh clone. It must stay plain JavaScript with no dependencies because it runs
 * before `npm ci` and before dist/ exists. It prepares this folder only (project dependencies and
 * the build) and then hands off to the typed setup in dist/setup/main.js, which asks before any
 * machine-level install (system tools, a provider CLI, the browser runtime).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes('--check');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('YouIAgent requires Node.js 22 or newer. Install it, then rerun npm run setup.');
  process.exit(1);
}

/** @param {string[]} args */
function npmRun(args) {
  console.log(`\nRunning: npm ${args.join(' ')}`);
  // npm.cmd needs a shell on Windows; the arguments here are fixed strings, never user input.
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
  if (result.status !== 0) {
    console.error(`npm ${args.join(' ')} failed. Fix the error above, then rerun npm run setup.`);
    process.exit(1);
  }
}

const installed = existsSync(join(root, 'node_modules', 'typescript'));
const built = existsSync(join(root, 'dist', 'setup', 'main.js'));

if (!installed) {
  if (checkOnly) {
    console.error('Project dependencies are not installed. Run npm run setup (it installs them for this folder only).');
    process.exit(1);
  }
  console.log('Installing project dependencies for this folder (npm ci)…');
  npmRun(['ci']);
}
if (!built) {
  if (checkOnly) {
    console.error('YouIAgent is not built. Run npm run setup (or npm run build) first; the check never builds.');
    process.exit(1);
  }
  console.log('Building YouIAgent (npm run build)…');
  npmRun(['run', 'build']);
}

const { runSetup } = await import(pathToFileURL(join(root, 'dist', 'setup', 'main.js')).href);
process.exitCode = await runSetup(process.argv.slice(2));
