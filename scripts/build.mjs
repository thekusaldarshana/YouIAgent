// @ts-check
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { BUNDLES, REQUIRED_OUTPUTS, STATIC_COPIES } from './asset-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const log = (/** @type {string} */ message) => console.log(`build: ${message}`);
const at = (/** @type {string} */ path) => join(root, path);

async function exists(/** @type {string} */ path) {
  return Boolean(await stat(path).catch(() => null));
}

function compileNode() {
  log('type-check and emit Node ESM (tsc, NodeNext, strict)');
  const tsc = require.resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', at('tsconfig.json')], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('TypeScript compilation failed.');
}

async function bundleBrowserAssets() {
  for (const bundle of BUNDLES) {
    log(`bundle ${bundle.entry} -> ${bundle.out} (${bundle.format})`);
    await build({
      absWorkingDir: root,
      entryPoints: [bundle.entry],
      outfile: bundle.out,
      bundle: true,
      format: bundle.format,
      target: bundle.target,
      platform: 'browser',
      sourcemap: bundle.sourcemap ? 'linked' : false,
      legalComments: bundle.legalComments,
      tsconfig: at('tsconfig.client.json'),
      logLevel: 'warning',
    });
  }
}

async function copyStaticAssets() {
  for (const rule of STATIC_COPIES) {
    const source = at(rule.from);
    if (!await exists(source)) throw new Error(`Asset manifest entry is missing from the source tree: ${rule.from}`);
    log(`copy ${rule.from} -> ${rule.to}`);
    await mkdir(dirname(at(rule.to)), { recursive: true });
    const excluded = new Set(rule.exclude ?? []);
    await cp(source, at(rule.to), {
      recursive: true,
      filter: (path) => !excluded.has(relative(source, path)),
    });
  }
}

/** Every non-test emitted module's relative imports must resolve to a real file. */
async function verifyImports() {
  /** @type {string[]} */
  const problems = [];
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
  async function visit(/** @type {string} */ directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await visit(path); continue; }
      // Browser bundles are self-contained, and test modules embed import text for generated scripts and are exercised by running them.
      if (!entry.name.endsWith('.js') || path.startsWith(at('dist/web/public')) || path.startsWith(at('dist/test'))) continue;
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(importPattern)) {
        const target = resolve(dirname(path), match[2] ?? '');
        if (!await exists(target)) problems.push(`${relative(root, path)} imports ${match[2]}, which was not emitted`);
      }
    }
  }
  await visit(at('dist'));
  if (problems.length) throw new Error(`Unresolved imports in dist/:\n  ${problems.join('\n  ')}`);
}

async function verifyOutputs() {
  /** @type {string[]} */
  const missing = [];
  for (const output of REQUIRED_OUTPUTS) if (!await exists(at(output))) missing.push(output);
  if (missing.length) throw new Error(`Build is missing required outputs:\n  ${missing.join('\n  ')}`);
  if (await exists(at('web/public/app.js'))) throw new Error('web/public/app.js is hand-written source. Edit web/client/app.ts; the build owns the served bundle.');
  await verifyImports();
}

const started = Date.now();
try {
  if (await exists(at('web/public/app.js'))) throw new Error('web/public/app.js is hand-written source. Edit web/client/app.ts; the build owns the served bundle.');
  log('clean dist/');
  await rm(at('dist'), { recursive: true, force: true });
  compileNode();
  await bundleBrowserAssets();
  await copyStaticAssets();
  await verifyOutputs();
  await writeFile(at('dist/.build-stamp'), `${new Date().toISOString()}\n`);
  log(`ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (error) {
  console.error(`build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
