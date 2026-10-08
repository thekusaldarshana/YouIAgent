import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { agentInvocation, agentStatus } from '../harness/graph/local-agent.mjs';
import { CodexAppServer } from '../harness/graph/codex-app-server.mjs';

const sessions = new Map();
const LOGIN_TIMEOUT_MS = 10 * 60_000;

function publicSession(session) {
  return { id: session.id, provider: session.provider, state: session.state, message: session.message,
    ...(session.state === 'waiting' && session.url ? { url: session.url } : {}) };
}

function authUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

async function finish(session, state, message) {
  if (session.state !== 'waiting') return;
  session.state = state;
  session.message = message;
  clearTimeout(session.timer);
  clearTimeout(session.pollTimer);
  if (session.server) await session.server.close().catch(() => {});
  if (session.child && session.child.exitCode === null) session.child.kill();
}

async function startCodex(session) {
  const server = new CodexAppServer({ cwd: process.cwd() });
  session.server = server;
  server.onNotification = (event) => {
    if (event.method !== 'account/login/completed' || (event.params?.loginId && event.params.loginId !== session.loginId)) return;
    if (!event.params.success) {
      finish(session, 'failed', event.params.error || 'Codex sign-in failed.').catch(() => {});
      return;
    }
    finish(session, 'connected', 'Codex is connected.').catch(() => {});
  };
  await server.open();
  const result = await server.request('account/login/start', { type: 'chatgpt' });
  if (result?.type !== 'chatgpt' || !authUrl(result.authUrl)) throw new Error('Codex did not provide a browser sign-in URL.');
  session.loginId = result.loginId;
  session.url = authUrl(result.authUrl);
  session.message = 'Open the sign-in page and finish with your ChatGPT account.';
}

function startClaude(session) {
  const invocation = agentInvocation('claude');
  if (invocation.prefix.length) throw new Error('Claude Code executable could not be launched directly.');
  const child = spawn(invocation.command, ['auth', 'login', '--claudeai'], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: process.env,
  });
  session.child = child;
  let output = '';
  const inspect = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-8_000);
    if (!session.url) {
      const match = output.match(/https:\/\/[^\s\x1b<>"']+/);
      session.url = match ? authUrl(match[0].replace(/[),.;]+$/, '')) : null;
    }
  };
  child.stdout.on('data', inspect);
  child.stderr.on('data', inspect);
  child.on('error', (error) => { finish(session, 'failed', error.code === 'ENOENT' ? 'Claude Code is not on PATH.' : error.message).catch(() => {}); });
  child.on('exit', async (code) => {
    if (session.state !== 'waiting') return;
    if (code !== 0) return finish(session, 'failed', 'Claude sign-in did not complete. Try again.');
    const status = await agentStatus('claude');
    if (status.ready) return finish(session, 'connected', 'Claude Code is connected.');
    session.message = 'Waiting for Claude Code to finish browser sign-in…';
    const poll = async () => {
      if (session.state !== 'waiting') return;
      const current = await agentStatus('claude');
      if (current.ready) return finish(session, 'connected', 'Claude Code is connected.');
      session.pollTimer = setTimeout(poll, 2_000);
    };
    session.pollTimer = setTimeout(poll, 2_000);
  });
  session.message = 'Finish Claude Code sign-in in the browser it opens.';
}

export async function startProviderLogin(provider) {
  if (!['codex', 'claude'].includes(provider)) throw new Error('Unknown provider.');
  const previous = sessions.get(provider);
  if (previous?.state === 'waiting') return publicSession(previous);
  const session = { id: randomUUID(), provider, state: 'waiting', message: 'Starting sign-in…', url: null };
  sessions.set(provider, session);
  session.timer = setTimeout(() => { finish(session, 'failed', 'Sign-in timed out. Try again.').catch(() => {}); }, LOGIN_TIMEOUT_MS);
  try {
    if (provider === 'codex') await startCodex(session);
    else startClaude(session);
  } catch (error) { await finish(session, 'failed', error.message); }
  return publicSession(session);
}

export function getProviderLogin(provider, id) {
  const session = sessions.get(provider);
  return session?.id === id ? publicSession(session) : null;
}

export async function cancelProviderLogin(provider, id) {
  const session = sessions.get(provider);
  if (!session || session.id !== id) return false;
  if (session.state === 'waiting') {
    if (provider === 'codex' && session.loginId) await session.server.request('account/login/cancel', { loginId: session.loginId }).catch(() => {});
    await finish(session, 'cancelled', 'Sign-in cancelled.');
  }
  return true;
}
