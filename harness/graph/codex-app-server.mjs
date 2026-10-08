import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { agentInvocation } from './local-agent.mjs';

const CLIENT = { name: 'youiagent', title: 'YouIAgent', version: '0.1.0' };

export class CodexAppServer {
  constructor({ cwd, stderrPath, onNotification = () => {}, environment = process.env }) {
    this.cwd = cwd;
    this.stderrPath = stderrPath;
    this.onNotification = onNotification;
    this.environment = environment;
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
  }

  async open() {
    const invocation = agentInvocation('codex');
    if (this.stderrPath) this.stderr = createWriteStream(this.stderrPath);
    this.child = spawn(invocation.command, [...invocation.prefix, 'app-server'], {
      cwd: this.cwd, env: this.environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    if (this.stderr) this.child.stderr.pipe(this.stderr);
    else this.child.stderr.resume();
    this.child.on('error', (error) => this.failAll(error));
    this.child.on('exit', (code) => this.failAll(new Error(`Codex app-server exited (${code}).`)));
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      try { this.receive(JSON.parse(line)); }
      catch (error) { this.failAll(new Error(`Invalid Codex app-server response: ${error.message}`)); }
    });
    await this.request('initialize', { clientInfo: CLIENT, capabilities: { experimentalApi: true, requestAttestation: false } });
    this.send({ method: 'initialized' });
  }

  send(message) {
    if (this.closed || !this.child?.stdin?.writable) throw new Error('Codex app-server is unavailable.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  receive(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`Codex: ${message.error.message || JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method && message.id !== undefined) {
      // Fail explicitly if the model asks a question this version cannot show in the film UI.
      this.send({ id: message.id, error: { code: -32601, message: 'YouIAgent does not yet display interactive provider requests.' } });
      this.onNotification({ method: 'provider/requestUnsupported', params: { method: message.method } });
      return;
    }
    if (message.method) this.onNotification(message);
  }

  failAll(error) {
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  async close() {
    this.failAll(new Error('Codex app-server closed.'));
    this.child?.kill();
    if (this.stderr) await new Promise((resolve) => this.stderr.end(resolve));
  }
}

export async function codexConnectionStatus() {
  const server = new CodexAppServer({ cwd: process.cwd() });
  try {
    await server.open();
    const account = await server.request('account/read');
    if (!account?.account && account?.requiresOpenaiAuth) return { ready: false, detail: 'Run codex login to connect your ChatGPT subscription.' };
    const authType = account?.account?.type || 'external';
    return { ready: true, authType, detail: authType === 'chatgpt' ? 'Connected through your ChatGPT login.' : authType === 'apiKey' ? 'Connected with an OpenAI API key.' : 'Codex is ready.' };
  } catch (error) {
    return { ready: false, detail: error.code === 'ENOENT' ? 'Codex CLI is not on PATH.' : error.message };
  } finally {
    await server.close();
  }
}

export async function runCodexStage({ workspace, logBase, prompt, model, effort, timeoutMs }) {
  const lines = [];
  const events = [];
  let usage;
  let finish;
  let fail;
  let threadId;
  let turnId;
  let earlyCompletion;
  const completed = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  completed.catch(() => {});
  const server = new CodexAppServer({
    cwd: workspace,
    stderrPath: `${logBase}.stderr`,
    onNotification: (event) => {
      if (event.method === 'item/completed') {
        events.push({ type: 'item.completed', item: event.params?.item });
        if (event.params?.item?.type === 'agentMessage') lines.push(event.params.item.text);
      }
      if (event.method === 'thread/tokenUsage/updated' && event.params?.tokenUsage?.last) {
        const value = event.params.tokenUsage.last;
        usage = { input_tokens: value.inputTokens, cached_input_tokens: value.cachedInputTokens, output_tokens: value.outputTokens };
      }
      if (event.method === 'provider/requestUnsupported') fail(new Error(`Codex requested ${event.params.method}; this needs an interactive answer in YouIAgent.`));
      if (event.method !== 'turn/completed' || event.params?.threadId !== threadId) return;
      if (!turnId) { earlyCompletion = event.params.turn; return; }
      if (event.params.turn?.id === turnId) finish(event.params.turn);
    },
  });
  const timer = setTimeout(() => fail(new Error('Codex generation timed out.')), timeoutMs);
  try {
    await server.open();
    const account = await server.request('account/read');
    if (!account?.account && account?.requiresOpenaiAuth) throw new Error('Codex is not signed in. Run codex login.');
    const thread = await server.request('thread/start', {
      cwd: workspace, model: model || null, approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review', sandbox: 'workspace-write', ephemeral: true,
    });
    threadId = thread.thread.id;
    const started = await server.request('turn/start', {
      threadId, input: [{ type: 'text', text: prompt, text_elements: [] }],
      ...(effort ? { effort } : {}),
    });
    turnId = started.turn.id;
    if (earlyCompletion?.id === turnId) finish(earlyCompletion);
    const turn = await completed;
    if (turn.status !== 'completed') throw new Error(`Codex turn ${turn.status}: ${turn.error?.message || 'generation did not finish'}`);
    const last = [...(turn.items || [])].reverse().find((item) => item.type === 'agentMessage')?.text || lines.at(-1) || '';
    events.push({ type: 'turn.completed', usage: usage || null, status: turn.status });
    await writeFile(`${logBase}.stdout`, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
    await writeFile(`${logBase}.last.txt`, last);
    return { log: `${logBase}.stdout` };
  } finally {
    clearTimeout(timer);
    await server.close();
  }
}
