import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureSources } from './source.js';

test('a local folder becomes a filtered, source-backed job snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'youiagent-local-capture-'));
  const source = join(root, 'project');
  const job = join(root, 'job');
  try {
    await mkdir(source);
    await writeFile(join(source, 'README.md'), 'A local product fact.');
    await writeFile(join(source, '.env'), 'SECRET=example');
    await mkdir(join(source, 'node_modules'));
    await writeFile(join(source, 'node_modules', 'dependency.js'), 'ignored');
    await symlink(join(source, '.env'), join(source, 'linked-secret'));
    const manifest = await captureSources(job, { repositoryUrl: source, goal: 'Make a film' });
    assert.equal(manifest.website, null);
    assert.equal(manifest.repository?.kind, 'local-folder');
    assert.equal(manifest.repository?.files, 1);
    assert.equal(await readFile(join(job, 'workspace', 'source-repo', 'README.md'), 'utf8'), 'A local product fact.');
    await assert.rejects(readFile(join(job, 'workspace', 'source-repo', '.env')));
    await assert.rejects(readFile(join(job, 'workspace', 'source-repo', 'linked-secret')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
