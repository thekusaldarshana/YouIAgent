import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { harnessAsset, harnessDir, gsapRuntimeSource, hyperframesBin, packageDir, packageRoot, stateRoot, toolBinDir } from '../harness/runtime/paths.js';
import { resolveInWorkspace } from '../harness/runtime/workspace-path.js';

test('the package root and compiled harness tree are located from the build, not from a source checkout', () => {
  assert.equal(basename(harnessDir), 'harness');
  assert.equal(basename(dirname(harnessDir)), 'dist', 'tests run from dist/, the layout users run');
  assert.equal(resolve(dirname(harnessDir), '..'), packageRoot());
});

test('state lives beside the install unless YOUIAGENT_HOME relocates it', () => {
  assert.equal(stateRoot({}), join(packageRoot(), '.youiagent'));
  assert.equal(stateRoot({ YOUIAGENT_HOME: '/tmp/youiagent-elsewhere' }), resolve('/tmp/youiagent-elsewhere'));
});

test('HyperFrames and GSAP resolve from the single root install', async () => {
  const bin = hyperframesBin({});
  assert.ok((await stat(bin)).isFile(), 'the HyperFrames entry script exists');
  assert.ok(bin.startsWith(join(packageRoot(), 'node_modules')), 'it comes from the root node_modules, not harness/node_modules');
  assert.ok((await stat(gsapRuntimeSource())).size > 10_000);
  assert.equal(hyperframesBin({ YOUIAGENT_HYPERFRAMES_BIN: '/opt/custom/hyperframes.mjs' }), resolve('/opt/custom/hyperframes.mjs'));
  const shims = toolBinDir();
  if (shims) assert.ok((await readdir(shims)).some((name) => name.startsWith('hyperframes')));
});

test('a missing dependency fails with an actionable message', () => {
  assert.throws(() => packageDir('definitely-not-an-installed-package'), /npm ci|npm run setup/);
});

test('copied assets are found beside the compiled code', async () => {
  for (const parts of [['skills', 'film-graph', 'SKILL.md'], ['media', 'music', 'airy.mp3'], ['motion', 'mechanics.js'], ['motion', 'README.md'], ['graph', 'score-kit.js'], ['worker', 'render.js']]) {
    assert.ok((await stat(harnessAsset(...parts))).isFile(), parts.join('/'));
  }
});

test('workspace paths reject absolute, parent, and backslash-escaping input on every platform', () => {
  const messages = { invalid: 'invalid', escapes: 'escapes' };
  const workspace = resolve('/tmp/youiagent-workspace');
  assert.equal(resolveInWorkspace(workspace, 'film-output/film.mp4', messages), join(workspace, 'film-output', 'film.mp4'));
  for (const bad of ['../secret', 'a/../../secret', 'a\\..\\secret', '..\\secret', '/etc/passwd', '', '.', undefined, 42]) {
    assert.throws(() => resolveInWorkspace(workspace, bad, messages), /invalid|escapes/, `${String(bad)} must be rejected`);
  }
});
