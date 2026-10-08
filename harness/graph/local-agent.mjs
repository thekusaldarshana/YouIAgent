import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function agentInvocation(provider) {
  if (process.platform !== 'win32') return { command: provider, prefix: [] };
  const directories = (process.env.PATH || '').split(delimiter);
  for (const directory of directories) {
    const executable = join(directory, `${provider}.exe`);
    if (existsSync(executable)) return { command: executable, prefix: [] };
  }
  if (provider === 'codex') {
    for (const directory of directories) {
      const script = join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(script)) return { command: process.execPath, prefix: [script] };
    }
  }
  return { command: `${provider}.exe`, prefix: [] };
}

export async function runAgent({ provider, workspace, jobDir, stage, prompt, model, effort, timeoutMs = 26 * 60_000 }) {
  const logBase = join(jobDir, `agent-${stage}`);
  if (provider === 'codex') {
    const { runCodexStage } = await import('./codex-app-server.mjs');
    return { ...await runCodexStage({ workspace, logBase, prompt, model, effort, timeoutMs }), provider, model, effort };
  }
  if (provider === 'claude') {
    const { runClaudeStage } = await import('./claude-sdk.mjs');
    return { ...await runClaudeStage({ workspace, logBase, prompt, model, timeoutMs }), provider, model, effort };
  }
  throw new Error(`Unknown generation provider: ${provider}`);
}

export async function agentStatus(provider) {
  if (provider === 'codex') {
    const { codexConnectionStatus } = await import('./codex-app-server.mjs');
    return codexConnectionStatus();
  }
  const args = provider === 'claude' ? ['auth', 'status'] : ['login', 'status'];
  const invocation = agentInvocation(provider);
  return new Promise((resolve) => {
    let output = '';
    let finished = false;
    const done = (result) => { if (!finished) { finished = true; resolve(result); } };
    const child = spawn(invocation.command, [...invocation.prefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); done({ ready: false, detail: 'Authentication check timed out.' }); }, 8000);
    child.stdout.on('data', (chunk) => { output += chunk.toString().slice(0, 2000); });
    child.stderr.on('data', (chunk) => { output += chunk.toString().slice(0, 2000); });
    child.on('error', (error) => { clearTimeout(timer); done({ ready: false, detail: error.code === 'ENOENT' ? `${provider} CLI is not on PATH.` : error.message }); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return done({ ready: false, detail: `Run ${provider === 'claude' ? 'claude auth login' : 'codex login'} in a terminal.` });
      if (provider === 'claude') {
        try {
          const status = JSON.parse(output);
          return done({ ready: status.loggedIn === true, authType: status.authMethod, detail: status.loggedIn ? `Connected through ${status.authMethod}.` : 'Run claude auth login to connect Claude Code.' });
        } catch { return done({ ready: false, detail: 'Could not read Claude authentication status.' }); }
      }
      done({ ready: true, detail: output.trim().split('\n')[0] || 'Signed in.' });
    });
  });
}

export async function binaryStatus(command) {
  return new Promise((resolve) => {
    let finished = false;
    const done = (ready) => { if (!finished) { finished = true; resolve(ready); } };
    const child = spawn(command, ['-version'], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); done(false); }, 5000);
    child.on('error', () => { clearTimeout(timer); done(false); });
    child.on('exit', (code) => { clearTimeout(timer); done(code === 0); });
  });
}

export function renderBinary(name, configured) {
  if (configured) return configured;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const alias = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', `${name}.exe`);
    if (existsSync(alias)) return alias;
  }
  return name;
}
