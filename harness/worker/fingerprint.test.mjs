import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compositionFingerprint } from './fingerprint.mjs';

test('composition hash covers source and assets but ignores generated snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'film-hash-'));
  try {
    await writeFile(join(root, 'index.html'), '<html>a</html>');
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'music.wav'), 'a');
    const first = await compositionFingerprint(root);
    await mkdir(join(root, 'snapshots'));
    await writeFile(join(root, 'snapshots', 'frame.png'), 'x');
    assert.equal(await compositionFingerprint(root), first);
    await writeFile(join(root, 'assets', 'music.wav'), 'b');
    assert.notEqual(await compositionFingerprint(root), first);
  } finally { await rm(root, { recursive: true, force: true }); }
});
