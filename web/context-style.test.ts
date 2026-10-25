import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractStyleguide, styleguideMarkdown } from './context-style.js';

const response = await extractStyleguide('domain-sdk.dev', {
  cacheDir: null,
  key: 'fixture-key',
  fetcher: async (url, options) => {
    assert.equal(url.hostname, 'api.context.dev');
    assert.equal(url.searchParams.get('domain'), 'domain-sdk.dev');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    return {
      ok: true,
      headers: { get: (name) => name === 'x-credits-used' ? '10' : null },
      json: async () => ({ status: 'ok', domain: 'domain-sdk.dev', request_id: 'fixture-request', styleguide: { mode: 'dark', colors: { accent: '#aabbcc', background: '#101010', text: '#ffffff' }, typography: { headings: { h1: { fontFamily: 'Inter', fontSize: '64px', fontWeight: 700 } } }, elementSpacing: { section: '64px' }, components: { button: { borderRadius: '8px' } } } }),
    };
  },
});
assert.equal(response.creditsUsed, 10);
const markdown = styleguideMarkdown(response);
assert.match(markdown, /Accent: #aabbcc/);
assert.match(markdown, /Spacing section: 64px/);
assert.doesNotMatch(markdown, /fixture-key/);

const missing = await extractStyleguide('domain-sdk.dev', { key: '', cacheDir: null, fetcher: async () => { throw new Error('Must not call'); } });
assert.equal(missing.available, false);
const cacheDir = await mkdtemp(join(tmpdir(), 'context-style-test-'));
let calls = 0;
const fixtureFetch = async () => {
  calls++;
  return { ok: true, headers: { get: () => '10' }, json: async () => ({ domain: 'example.com', styleguide: { mode: 'light', colors: {} } }) };
};
await assert.rejects(() => extractStyleguide('example.com', { key: 'fixture', cacheDir, fetcher: fixtureFetch }), /fingerprint/);
await extractStyleguide('example.com', { key: 'fixture', cacheDir, sourceFingerprint: 'commit-a', fetcher: fixtureFetch, now: 1000 });
const cached = await extractStyleguide('example.com', { key: '', cacheDir, sourceFingerprint: 'commit-a', fetcher: fixtureFetch, now: 2000 });
assert.equal(calls, 1);
assert.ok(cached.available);
assert.equal(cached.cacheStatus, 'local');
assert.equal(cached.creditsUsed, 0);
await extractStyleguide('example.com', { key: 'fixture', cacheDir, sourceFingerprint: 'commit-b', fetcher: fixtureFetch, now: 2000 });
await extractStyleguide('different.example.com', { key: 'fixture', cacheDir, sourceFingerprint: 'commit-a', fetcher: fixtureFetch, now: 2000 });
assert.equal(calls, 3);
await rm(cacheDir, { recursive: true, force: true });
console.log('Context.dev styleguide contracts pass');
