import assert from 'node:assert/strict';
import test from 'node:test';
import { agentInvocation, runAgent } from './local-agent.js';

test('local agent resolution uses native executables', () => {
  assert.ok(agentInvocation('codex').command);
  assert.ok(agentInvocation('claude').command);
  if (process.platform !== 'win32') assert.deepEqual(agentInvocation('codex'), { command: 'codex', prefix: [] });
});

test('unknown generation provider fails without launching a process', async () => {
  await assert.rejects(runAgent({ provider: 'other', workspace: '.', jobDir: '.', stage: 'plan', prompt: 'test' }), /Unknown generation provider/);
});
