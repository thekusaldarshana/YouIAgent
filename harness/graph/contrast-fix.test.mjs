import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fixUniqueContrastLiterals } from './contrast-fix.mjs';

test('only a unique literal with a concrete HyperFrames suggestion is changed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'film-contrast-'));
  try {
    const path = join(dir, 'index.html');
    await writeFile(path, '<style>.caption{color:#79705f}</style>');
    const finding = { code: 'contrast_aa_failure', sourceFile: 'index.html', fg: 'rgb(121,112,95)', suggestedColor: 'rgb(112,104,88)', text: 'caption' };
    const fixes = await fixUniqueContrastLiterals(dir, { contrast: { findings: [finding] } });
    assert.equal(fixes.length, 1);
    assert.match(await readFile(path, 'utf8'), /#706858/);
    await writeFile(path, '<style>.a{color:#79705f}.b{color:#79705f}</style>');
    assert.deepEqual(await fixUniqueContrastLiterals(dir, { contrast: { findings: [finding] } }), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
