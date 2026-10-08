import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function agentInvocation(provider) {
  if (process.platform !== 'win32') return { command: provider, prefix: [] };
  const directories = (process.env.PATH || '').split(delimiter);
  if (directories.some((directory) => existsSync(join(directory, `${provider}.exe`)))) return { command: `${provider}.exe`, prefix: [] };
  if (provider === 'codex') {
    for (const directory of directories) {
      const script = join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(script)) return { command: process.execPath, prefix: [script] };
    }
  }
  return { command: `${provider}.exe`, prefix: [] };
}

export function agentArgs(provider, { workspace, model, effort, output, prompt }) {
  if (provider === 'claude') return [
    '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--permission-mode', 'acceptEdits', ...(model ? ['--model', model] : []), prompt,
  ];
  if (provider === 'codex') return [
    'exec', '--json', '--ephemeral', '--skip-git-repo-check', '-C', workspace,
    '-m', model || 'gpt-6-sol', '-c', `model_reasoning_effort=${effort || 'high'}`,
    '--approve-for-me', '-o', output, prompt,
  ];
  throw new Error(`Unknown generation provider: ${provider}`);
}

export async function agentStatus(provider) {
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
          return done({ ready: status.loggedIn === true, detail: status.loggedIn ? `Signed in via ${status.authMethod}.` : 'Run claude auth login in a terminal.' });
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
