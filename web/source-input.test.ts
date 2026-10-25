import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeSources } from './source-input.js';

test('accepts either source or both, including an existing local folder', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'youiagent-input-'));
  try {
    assert.deepEqual(await normalizeSources({ websiteUrl: 'https://example.com', repositoryUrl: '' }), { websiteUrl: 'https://example.com/', repositoryUrl: null });
    assert.deepEqual(await normalizeSources({ websiteUrl: '', repositoryUrl: 'https://github.com/owner/private.git' }), { websiteUrl: null, repositoryUrl: 'https://github.com/owner/private' });
    assert.deepEqual(await normalizeSources({ websiteUrl: 'https://example.com', repositoryUrl: folder }), { websiteUrl: 'https://example.com/', repositoryUrl: folder });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('rejects empty sources and embedded repository credentials', async () => {
  await assert.rejects(normalizeSources({}), /Enter a website URL/);
  await assert.rejects(normalizeSources({ repositoryUrl: 'https://token@github.com/owner/repo' }), /without embedded credentials/);
  await assert.rejects(normalizeSources({ repositoryUrl: '/missing/youiagent-source' }), /does not exist/);
});
