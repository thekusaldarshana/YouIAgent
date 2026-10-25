import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../../shared/json.js';

const requireFromHere = createRequire(import.meta.url);
const hereDir = dirname(fileURLToPath(import.meta.url));

/**
 * The compiled harness tree (`dist/harness`). Skills, music and the motion helper are copied
 * beside the compiled code, so asset lookups are relative to this directory, never to a source checkout.
 */
export const harnessDir = resolve(hereDir, '..');

const PACKAGE_NAME = 'youiagent';
let cachedRoot: string | undefined;

function packageNameAt(directory: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    return isRecord(parsed) && typeof parsed['name'] === 'string' ? parsed['name'] : null;
  } catch { return null; }
}

/**
 * True when `metaUrl`'s module is the script Node was started with. Both sides are realpath-ed:
 * Node resolves symlinks in `import.meta.url` but not in `argv[1]`, so a symlinked install
 * (systemd units, `/opt/app -> releases/x`) would otherwise start nothing and exit 0.
 */
export function isEntryPoint(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return realpathSync(entry) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}

/** The directory holding YouIAgent's package.json and its single `node_modules` install. */
export function packageRoot(): string {
  if (cachedRoot) return cachedRoot;
  for (let directory = hereDir; ; directory = dirname(directory)) {
    if (packageNameAt(directory) === PACKAGE_NAME) return cachedRoot = directory;
    if (dirname(directory) === directory) throw new Error('Could not locate the YouIAgent package root.');
  }
}

/**
 * Local state (jobs, uploads) lives beside the install and is never part of the build output.
 * YOUIAGENT_HOME relocates it, which keeps tests and scratch runs away from real jobs.
 */
export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['YOUIAGENT_HOME'];
  return override ? resolve(override) : join(packageRoot(), '.youiagent');
}

export function harnessAsset(...segments: string[]): string {
  return join(harnessDir, ...segments);
}

/** Locates an installed dependency's folder without relying on its `exports` map or a hard-coded path. */
export function packageDir(name: string): string {
  for (const base of requireFromHere.resolve.paths(name) ?? []) {
    const candidate = join(base, name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  throw new Error(`Dependency "${name}" is not installed. Run npm ci in the YouIAgent folder, or npm run setup.`);
}

function binEntry(directory: string, name: string): string {
  const parsed: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const bin = isRecord(parsed) ? parsed['bin'] : undefined;
  const relative = typeof bin === 'string' ? bin : isRecord(bin) && typeof bin[name] === 'string' ? bin[name] : null;
  if (!relative) throw new Error(`${name} does not declare a ${name} executable.`);
  return join(directory, relative);
}

/**
 * HyperFrames CLI entry script, run as `node <entry> …` so no shell or global install is involved.
 * YOUIAGENT_HYPERFRAMES_BIN overrides it (advanced use and offline integration tests).
 */
export function hyperframesBin(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['YOUIAGENT_HYPERFRAMES_BIN'];
  return override ? resolve(override) : binEntry(packageDir('hyperframes'), 'hyperframes');
}

/** The frozen GSAP build copied into every job so compositions never fetch a CDN copy. */
export function gsapRuntimeSource(): string {
  return join(packageDir('gsap'), 'dist', 'gsap.min.js');
}

/** npm's executable shims, offered on PATH to the agent's shell so it can run `hyperframes` directly. */
export function toolBinDir(): string | null {
  try {
    const directory = join(dirname(packageDir('hyperframes')), '.bin');
    return statSync(directory).isDirectory() ? directory : null;
  } catch { return null; }
}
