import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LoginSession, LoginState, ProviderId } from '../shared/api.js';
import { providerSchema } from '../shared/film.js';
import { errorCode, errorMessage } from '../shared/json.js';
import { CodexAppServer } from '../harness/graph/codex-app-server.js';
import { agentInvocation, agentStatus } from '../harness/graph/local-agent.js';

interface Session {
  id: string;
  provider: ProviderId;
  state: LoginState;
  message: string;
  url: string | null;
  loginId?: string;
  server?: CodexAppServer;
  child?: ChildProcess;
  timer?: NodeJS.Timeout;
  pollTimer?: NodeJS.Timeout;
}

const sessions = new Map<ProviderId, Session>();
const LOGIN_TIMEOUT_MS = 10 * 60_000;

const loginStartSchema = z.looseObject({ type: z.string().optional(), authUrl: z.string().optional(), loginId: z.string().optional() });
const loginCompletedSchema = z.looseObject({ loginId: z.string().nullish().transform((id) => id ?? undefined), success: z.boolean().optional(), error: z.unknown().transform((error) => typeof error === 'string' ? error : undefined) });

function publicSession(session: Session): LoginSession {
  return {
    id: session.id, provider: session.provider, state: session.state, message: session.message,
    ...(session.state === 'waiting' && session.url ? { url: session.url } : {}),
  };
}

function authUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

async function finish(session: Session, state: LoginState, message: string): Promise<void> {
  if (session.state !== 'waiting') return;
  session.state = state;
  session.message = message;
  clearTimeout(session.timer);
  clearTimeout(session.pollTimer);
  if (session.server) await session.server.close().catch(() => {});
  if (session.child && session.child.exitCode === null) session.child.kill();
}

async function startCodex(session: Session): Promise<void> {
  const server = new CodexAppServer({ cwd: process.cwd() });
  session.server = server;
  server.onNotification = (event) => {
    if (event.method !== 'account/login/completed') return;
    const completed = loginCompletedSchema.safeParse(event.params);
    if (!completed.success || (completed.data.loginId && completed.data.loginId !== session.loginId)) return;
    if (!completed.data.success) {
      finish(session, 'failed', completed.data.error || 'Codex sign-in failed.').catch(() => {});
      return;
    }
    finish(session, 'connected', 'Codex is connected.').catch(() => {});
  };
  await server.open();
  const result = await server.call('account/login/start', { type: 'chatgpt' }, loginStartSchema);
  const url = result.authUrl ? authUrl(result.authUrl) : null;
  if (result.type !== 'chatgpt' || !url) throw new Error('Codex did not provide a browser sign-in URL.');
  if (result.loginId) session.loginId = result.loginId;
  session.url = url;
  session.message = 'Open the sign-in page and finish with your ChatGPT account.';
}

function startClaude(session: Session): void {
  const invocation = agentInvocation('claude');
  if (invocation.prefix.length) throw new Error('Claude Code executable could not be launched directly.');
  const child = spawn(invocation.command, ['auth', 'login', '--claudeai'], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: process.env,
  });
  session.child = child;
  let output = '';
  const inspect = (chunk: Buffer): void => {
    output = `${output}${chunk.toString()}`.slice(-8_000);
    if (!session.url) {
      const match = output.match(/https:\/\/[^\s\x1b<>"']+/);
      session.url = match ? authUrl(match[0].replace(/[),.;]+$/, '')) : null;
    }
  };
  child.stdout.on('data', inspect);
  child.stderr.on('data', inspect);
  child.on('error', (error) => { finish(session, 'failed', errorCode(error) === 'ENOENT' ? 'Claude Code is not on PATH.' : error.message).catch(() => {}); });
  child.on('exit', (code) => {
    void (async () => {
      if (session.state !== 'waiting') return;
      if (code !== 0) return finish(session, 'failed', 'Claude sign-in did not complete. Try again.');
      const status = await agentStatus('claude');
      if (status.ready) return finish(session, 'connected', 'Claude Code is connected.');
      session.message = 'Waiting for Claude Code to finish browser sign-in…';
      const poll = async (): Promise<void> => {
        if (session.state !== 'waiting') return;
        const current = await agentStatus('claude');
        if (current.ready) return finish(session, 'connected', 'Claude Code is connected.');
        session.pollTimer = setTimeout(() => { void poll(); }, 2_000);
      };
      session.pollTimer = setTimeout(() => { void poll(); }, 2_000);
    })();
  });
  session.message = 'Finish Claude Code sign-in in the browser it opens.';
}

export async function startProviderLogin(provider: string): Promise<LoginSession> {
  const known = providerSchema.safeParse(provider);
  if (!known.success) throw new Error('Unknown provider.');
  const id = known.data;
  const previous = sessions.get(id);
  if (previous?.state === 'waiting') return publicSession(previous);
  const session: Session = { id: randomUUID(), provider: id, state: 'waiting', message: 'Starting sign-in…', url: null };
  sessions.set(id, session);
  session.timer = setTimeout(() => { finish(session, 'failed', 'Sign-in timed out. Try again.').catch(() => {}); }, LOGIN_TIMEOUT_MS);
  try {
    if (id === 'codex') await startCodex(session);
    else startClaude(session);
  } catch (error) { await finish(session, 'failed', errorMessage(error)); }
  return publicSession(session);
}

export function getProviderLogin(provider: string, id: string): LoginSession | null {
  const known = providerSchema.safeParse(provider);
  const session = known.success ? sessions.get(known.data) : undefined;
  return session?.id === id ? publicSession(session) : null;
}

export async function cancelProviderLogin(provider: string, id: string): Promise<boolean> {
  const known = providerSchema.safeParse(provider);
  const session = known.success ? sessions.get(known.data) : undefined;
  if (!session || session.id !== id) return false;
  if (session.state === 'waiting') {
    if (session.provider === 'codex' && session.loginId) await session.server?.request('account/login/cancel', { loginId: session.loginId }).catch(() => {});
    await finish(session, 'cancelled', 'Sign-in cancelled.');
  }
  return true;
}
