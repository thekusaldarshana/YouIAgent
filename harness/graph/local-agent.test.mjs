import assert from 'node:assert/strict';
import test from 'node:test';
import { agentArgs, agentInvocation } from './local-agent.mjs';

test('local agent commands use native executables and keep model choices separate', () => {
  assert.ok(agentInvocation('codex').command);
  assert.ok(agentInvocation('claude').command);
  if (process.platform !== 'win32') assert.deepEqual(agentInvocation('codex'), { command: 'codex', prefix: [] });
  const codex = agentArgs('codex', { workspace: '/job', model: 'gpt-6-sol', effort: 'high', output: '/job/last.txt', prompt: 'Plan film' });
  assert.deepEqual(codex.slice(0, 2), ['exec', '--json']);
  assert.ok(codex.includes('gpt-6-sol'));
  const claude = agentArgs('claude', { workspace: '/job', model: 'sonnet', effort: 'high', output: '/job/last.txt', prompt: 'Plan film' });
  assert.deepEqual(claude.slice(0, 3), ['-p', '--output-format', 'stream-json']);
  assert.ok(claude.includes('sonnet'));
  assert.ok(!claude.includes('gpt-6-sol'));
  assert.equal(claude.at(-1), 'Plan film');
});
