import { writeFile } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { agentInvocation } from './local-agent.mjs';

export async function runClaudeStage({ workspace, logBase, prompt, model, timeoutMs }) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const stderr = [];
  const output = [];
  const events = [];
  let result;
  const executable = agentInvocation('claude');
  try {
    const session = query({
      prompt,
      options: {
        cwd: workspace,
        ...(model ? { model } : {}),
        pathToClaudeCodeExecutable: executable.command,
        permissionMode: 'acceptEdits',
        settingSources: ['user', 'project', 'local'],
        persistSession: false,
        abortController,
        stderr: (chunk) => { if (stderr.join('').length < 1_000_000) stderr.push(chunk); },
      },
    });
    for await (const message of session) {
      if (message.type === 'assistant') {
        for (const block of message.message?.content || []) if (block.type === 'text') output.push(block.text);
      }
      if (message.type === 'result') {
        result = message;
        events.push({ type: 'turn.completed', usage: message.usage || null, status: message.subtype });
      }
    }
    if (!result || result.subtype !== 'success' || result.is_error) {
      throw new Error(`Claude generation failed: ${result?.errors?.join('; ') || result?.result || 'no result returned'}`);
    }
    await writeFile(`${logBase}.stdout`, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
    await writeFile(`${logBase}.last.txt`, result.result || output.at(-1) || '');
    return { log: `${logBase}.stdout` };
  } finally {
    clearTimeout(timer);
    await writeFile(`${logBase}.stderr`, stderr.join('')).catch(() => {});
  }
}
