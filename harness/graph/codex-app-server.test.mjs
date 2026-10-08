import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexAppServer } from './codex-app-server.mjs';

test('Codex app-server routes replies by request ID and reports protocol errors', async () => {
  const sent = [];
  const server = new CodexAppServer({ cwd: '.' });
  server.child = { stdin: { writable: true, write: (line) => sent.push(JSON.parse(line)) } };
  const first = server.request('account/read');
  const second = server.request('thread/start', { cwd: '.' });
  assert.deepEqual(sent.map(({ method }) => method), ['account/read', 'thread/start']);
  server.receive({ id: sent[1].id, result: { thread: { id: 'thread-1' } } });
  server.receive({ id: sent[0].id, result: { account: { type: 'chatgpt' } } });
  assert.equal((await first).account.type, 'chatgpt');
  assert.equal((await second).thread.id, 'thread-1');
  const failed = server.request('turn/start');
  server.receive({ id: sent[2].id, error: { code: -1, message: 'unavailable' } });
  await assert.rejects(failed, /unavailable/);
});
