import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { z } from 'zod';
import { parseJson } from '../shared/json.js';

/** The compiled server, started exactly as `npm start` starts it. */
const serverEntry = fileURLToPath(new URL('./server.js', import.meta.url));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('Could not reserve a port.');
  return address.port;
}

const configSchema = z.looseObject({
  providers: z.looseObject({ codex: z.looseObject({ ready: z.boolean() }), claude: z.looseObject({ ready: z.boolean() }) }),
  renderTools: z.looseObject({ ffmpeg: z.boolean() }),
});

test('a clone serves the homepage and every frontend asset without local job data', async () => {
  const port = await freePort();
  const home = await mkdtemp(join(tmpdir(), 'youiagent-smoke-'));
  const child = spawn(process.execPath, [serverEntry], { env: { ...process.env, PORT: String(port), YOUIAGENT_HOME: home }, stdio: 'ignore' });
  try {
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(`${origin}/api/config`)).ok; if (ready) break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.equal(ready, true, 'local web server did not start');
    const config = configSchema.parse(await (await fetch(`${origin}/api/config`)).json());
    assert.equal(typeof config.providers.codex.ready, 'boolean');
    assert.equal(typeof config.providers.claude.ready, 'boolean');
    assert.equal(typeof config.renderTools.ffmpeg, 'boolean');
    for (const [path, type, marker] of [
      ['/', 'text/html', 'YouIAgent · Local studio'],
      ['/app.js', 'text/javascript', 'source-form'],
      ['/styles.css', 'text/css', '.hero'],
    ] as const) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200, `${path} must be present in a clone`);
      assert.match(response.headers.get('content-type') || '', new RegExp(type));
      assert.ok((await response.text()).includes(marker), `${path} has unexpected content`);
    }
    const homepage = await (await fetch(origin)).text();
    assert.match(homepage, /id="provider"/);
    assert.match(homepage, /id="model"/);
    assert.match(homepage, /id="music-mode"/);
    assert.match(homepage, /id="past-creations"/);
    assert.match(homepage, /aria-label="Star YouIAgent on GitHub"/);
    assert.doesNotMatch(homepage, /Local preview/);
    assert.match(homepage, /id="website" type="url" placeholder="https:\/\/example\.com" \/>/);
    assert.match(homepage, /id="repository" type="text"/);
    assert.match(homepage, /id="choose-folder"/);
    assert.match(homepage, /id="folder-picker"[^>]*webkitdirectory/);
    const created = await fetch(`${origin}/api/uploads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Example project' }) });
    assert.equal(created.status, 201);
    const { id: uploadId } = z.looseObject({ id: z.string() }).parse(await created.json());
    const uploaded = await fetch(`${origin}/api/uploads/${uploadId}/files?path=src%2Findex.js`, { method: 'PUT', body: 'export default true;' });
    assert.equal(uploaded.status, 201);
    const rejected = await fetch(`${origin}/api/uploads/${uploadId}/files?path=..%2Fsecret`, { method: 'PUT', body: 'secret' });
    assert.equal(rejected.status, 400);
    const cancelled = await fetch(`${origin}/api/uploads/${uploadId}`, { method: 'DELETE' });
    assert.equal(cancelled.status, 200);
    const library = z.looseObject({ jobs: z.array(z.unknown()) }).parse(parseJson(await (await fetch(`${origin}/api/jobs`)).text()));
    assert.ok(Array.isArray(library.jobs));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    await rm(home, { recursive: true, force: true });
  }
});
