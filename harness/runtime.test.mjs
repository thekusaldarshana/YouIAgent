import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageRuntime } from './cli.mjs';

const dir = await mkdtemp(join(tmpdir(), 'film-runtime-test-'));
try {
  await mkdir(join(dir, 'workspace'));
  const first = await stageRuntime(dir);
  assert.equal(first.gsapPrepared, true);
  assert.ok((await readFile(join(dir, 'workspace', 'film-runtime', 'gsap.min.js'))).length > 10_000);
  assert.match(await readFile(join(dir, 'workspace', 'film-runtime', 'TOOLING.md'), 'utf8'), /HyperFrames 0\.8\.80/);
  await stageRuntime(dir);
} finally {
  await rm(dir, { recursive: true, force: true });
}
