import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { parseJson } from '../../shared/json.js';
import { accountReadSchema, CodexAppServer } from './codex-app-server.js';

const sentSchema = z.looseObject({ id: z.number(), method: z.string() });

test('Codex app-server routes replies by request ID and reports protocol errors', async () => {
  const sent: z.infer<typeof sentSchema>[] = [];
  const server = new CodexAppServer({ cwd: '.' });
  server.child = { stdin: { writable: true, write: (line: string) => { sent.push(sentSchema.parse(parseJson(line))); return true; } }, kill: () => true } as unknown as CodexAppServer['child'];
  const first = server.request('account/read');
  const second = server.request('thread/start', { cwd: '.' });
  assert.deepEqual(sent.map(({ method }) => method), ['account/read', 'thread/start']);
  server.receive({ id: sent[1]?.id, result: { thread: { id: 'thread-1' } } });
  server.receive({ id: sent[0]?.id, result: { account: { type: 'chatgpt' } } });
  assert.equal(accountReadSchema.parse(await first).account?.type, 'chatgpt');
  assert.deepEqual(await second, { thread: { id: 'thread-1' } });
  const failed = server.request('turn/start');
  server.receive({ id: sent[2]?.id, error: { code: -1, message: 'unavailable' } });
  await assert.rejects(failed, /unavailable/);
});

test('Codex app-server rejects replies that are not JSON-RPC messages', () => {
  const server = new CodexAppServer({ cwd: '.' });
  assert.throws(() => server.receive('not a message'), /JSON-RPC/);
});
