import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { z } from 'zod';
import type { ProviderStatus } from '../../shared/api.js';
import { providerSchema, type Provider } from '../../shared/film.js';
import { errorCode, errorMessage, parseJson } from '../../shared/json.js';

export interface AgentInvocation {
  command: string;
  prefix: string[];
}

export function agentInvocation(provider: string): AgentInvocation {
  if (process.platform !== 'win32') return { command: provider, prefix: [] };
  const directories = (process.env['PATH'] || '').split(delimiter);
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

export interface AgentStage {
  provider: string;
  workspace: string;
  jobDir: string;
  stage: string;
  prompt: string;
  model?: string | undefined;
  effort?: string | undefined;
  timeoutMs?: number;
}

export interface AgentRun {
  log: string;
  provider: Provider;
  model: string | undefined;
  effort: string | undefined;
}

/** Runs one generation stage. The graph injects this so tests can substitute a deterministic agent. */
export type AgentRunner = (workspace: string, jobDir: string, stage: string, prompt: string, model?: string, effort?: string, provider?: Provider) => Promise<unknown>;

export async function runAgent({ provider, workspace, jobDir, stage, prompt, model, effort, timeoutMs = 26 * 60_000 }: AgentStage): Promise<AgentRun> {
  const known = providerSchema.safeParse(provider);
  if (!known.success) throw new Error(`Unknown generation provider: ${provider}`);
  const logBase = join(jobDir, `agent-${stage}`);
  if (known.data === 'codex') {
    const { runCodexStage } = await import('./codex-app-server.js');
    return { ...await runCodexStage({ workspace, logBase, prompt, model, effort, timeoutMs }), provider: 'codex', model, effort };
  }
  const { runClaudeStage } = await import('./claude-sdk.js');
  return { ...await runClaudeStage({ workspace, logBase, prompt, model, timeoutMs }), provider: 'claude', model, effort };
}

const claudeAuthSchema = z.looseObject({ loggedIn: z.boolean().optional(), authMethod: z.string().optional() });

export async function agentStatus(provider: Provider): Promise<ProviderStatus> {
  if (provider === 'codex') {
    const { codexConnectionStatus } = await import('./codex-app-server.js');
    return codexConnectionStatus();
  }
  const invocation = agentInvocation(provider);
  return new Promise((resolve) => {
    let output = '';
    let finished = false;
    const done = (result: ProviderStatus): void => { if (!finished) { finished = true; resolve(result); } };
    const child = spawn(invocation.command, [...invocation.prefix, 'auth', 'status'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); done({ ready: false, detail: 'Authentication check timed out.' }); }, 8000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString().slice(0, 2000); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString().slice(0, 2000); });
    child.on('error', (error) => { clearTimeout(timer); done({ ready: false, detail: errorCode(error) === 'ENOENT' ? `${provider} CLI is not on PATH.` : error.message }); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return done({ ready: false, detail: 'Run claude auth login in a terminal.' });
      try {
        const status = claudeAuthSchema.parse(parseJson(output));
        done({ ready: status.loggedIn === true, authType: status.authMethod, detail: status.loggedIn ? `Connected through ${status.authMethod}.` : 'Run claude auth login to connect Claude Code.' });
      } catch (error) {
        done({ ready: false, detail: error instanceof SyntaxError || error instanceof z.ZodError ? 'Could not read Claude authentication status.' : errorMessage(error) });
      }
    });
  });
}

export async function binaryStatus(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    const done = (ready: boolean): void => { if (!finished) { finished = true; resolve(ready); } };
    const child = spawn(command, ['-version'], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); done(false); }, 5000);
    child.on('error', () => { clearTimeout(timer); done(false); });
    child.on('exit', (code) => { clearTimeout(timer); done(code === 0); });
  });
}

export function renderBinary(name: string, configured?: string): string {
  if (configured) return configured;
  const supervenv = join(homedir(), 'supervenv', 'bin', name);
  if (existsSync(supervenv)) return supervenv;
  if (process.platform === 'win32' && process.env['LOCALAPPDATA']) {
    const alias = join(process.env['LOCALAPPDATA'], 'Microsoft', 'WinGet', 'Links', `${name}.exe`);
    if (existsSync(alias)) return alias;
  }
  return name;
}
