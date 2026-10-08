import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('a clone serves the homepage and every frontend asset without local job data', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(`${origin}/api/config`)).ok; if (ready) break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.equal(ready, true, 'local web server did not start');
    const config = await (await fetch(`${origin}/api/config`)).json();
    assert.equal(typeof config.providers.codex.ready, 'boolean');
    assert.equal(typeof config.providers.claude.ready, 'boolean');
    assert.equal(typeof config.renderTools.ffmpeg, 'boolean');
    for (const [path, type, marker] of [
      ['/', 'text/html', 'YouIAgent · Local studio'],
      ['/app.js', 'text/javascript', 'source-form'],
      ['/styles.css', 'text/css', '.hero'],
    ]) {
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
    const library = await (await fetch(`${origin}/api/jobs`)).json();
    assert.ok(Array.isArray(library.jobs));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  }
});
