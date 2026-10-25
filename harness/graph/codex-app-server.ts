import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { ProviderStatus } from '../../shared/api.js';
import { errorCode, errorMessage, parseJson } from '../../shared/json.js';
import { agentInvocation } from './local-agent.js';

const CLIENT = { name: 'youiagent', title: 'YouIAgent', version: '0.1.0' };

/** A JSON-RPC line from `codex app-server`. Everything on the wire is untrusted until parsed. */
const rpcMessageSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).nullish().transform((id) => id ?? undefined),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.union([z.looseObject({ message: z.string().optional().catch(undefined) }), z.string().transform((message) => ({ message }))]).optional().catch(undefined),
});

export const accountReadSchema = z.looseObject({
  account: z.looseObject({ type: z.string().optional() }).nullish(),
  requiresOpenaiAuth: z.boolean().optional(),
});

const threadStartSchema = z.looseObject({ thread: z.looseObject({ id: z.string() }) });
const turnStartSchema = z.looseObject({ turn: z.looseObject({ id: z.string() }) });

const turnSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  error: z.looseObject({ message: z.string().optional() }).nullish(),
  items: z.array(z.looseObject({ type: z.string().optional(), text: z.string().optional() })).optional(),
});
export type CodexTurn = z.infer<typeof turnSchema>;

const itemCompletedSchema = z.looseObject({ item: z.looseObject({ type: z.string().optional(), text: z.string().optional() }) });
const tokenUsageSchema = z.looseObject({
  tokenUsage: z.looseObject({
    last: z.looseObject({ inputTokens: z.number().optional(), cachedInputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional(),
  }),
});
const turnCompletedSchema = z.looseObject({ threadId: z.string().optional(), turn: turnSchema });
const unsupportedRequestSchema = z.looseObject({ method: z.string() });

export interface CodexNotification {
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface CodexServerOptions {
  cwd: string;
  stderrPath?: string | undefined;
  onNotification?: (event: CodexNotification) => void;
  environment?: NodeJS.ProcessEnv;
}

export class CodexAppServer {
  readonly cwd: string;
  readonly stderrPath: string | undefined;
  readonly environment: NodeJS.ProcessEnv;
  onNotification: (event: CodexNotification) => void;
  child: Pick<ChildProcess, 'stdin' | 'kill'> | undefined;
  private stderr: WriteStream | undefined;
  private readonly pending = new Map<number | string, PendingRequest>();
  private nextId = 1;
  private closed = false;

  constructor({ cwd, stderrPath, onNotification = () => {}, environment = process.env }: CodexServerOptions) {
    this.cwd = cwd;
    this.stderrPath = stderrPath;
    this.onNotification = onNotification;
    this.environment = environment;
  }

  async open(): Promise<void> {
    const invocation = agentInvocation('codex');
    if (this.stderrPath) this.stderr = createWriteStream(this.stderrPath);
    const child = spawn(invocation.command, [...invocation.prefix, 'app-server'], {
      cwd: this.cwd, env: this.environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child = child;
    if (this.stderr) child.stderr.pipe(this.stderr);
    else child.stderr.resume();
    child.on('error', (error) => this.failAll(error));
    child.on('exit', (code) => this.failAll(new Error(`Codex app-server exited (${code}).`)));
    createInterface({ input: child.stdout }).on('line', (line) => {
      try { this.receive(parseJson(line)); }
      catch (error) { this.failAll(new Error(`Invalid Codex app-server response: ${errorMessage(error)}`)); }
    });
    await this.request('initialize', { clientInfo: CLIENT, capabilities: { experimentalApi: true, requestAttestation: false } });
    this.send({ method: 'initialized' });
  }

  send(message: object): void {
    if (this.closed || !this.child?.stdin?.writable) throw new Error('Codex app-server is unavailable.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: object = {}, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  /** Sends a request and validates the reply against `schema`. */
  async call<T>(method: string, params: object, schema: z.ZodType<T>, timeoutMs?: number): Promise<T> {
    const parsed = schema.safeParse(await this.request(method, params, timeoutMs));
    if (!parsed.success) throw new Error(`Codex ${method} returned an unexpected reply.`);
    return parsed.data;
  }

  receive(raw: unknown): void {
    const parsed = rpcMessageSchema.safeParse(raw);
    if (!parsed.success) throw new Error('not a JSON-RPC message');
    const message = parsed.data;
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
    if (message.method) this.onNotification({ method: message.method, params: message.params });
  }

  failAll(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  async close(): Promise<void> {
    this.failAll(new Error('Codex app-server closed.'));
    this.child?.kill();
    const stderr = this.stderr;
    if (stderr) await new Promise<void>((resolve) => stderr.end(resolve));
  }
}

export async function codexConnectionStatus(): Promise<ProviderStatus> {
  const server = new CodexAppServer({ cwd: process.cwd() });
  try {
    await server.open();
    const account = await server.call('account/read', {}, accountReadSchema);
    if (!account.account && account.requiresOpenaiAuth) return { ready: false, detail: 'Run codex login to connect your ChatGPT subscription.' };
    const authType = account.account?.type || 'external';
    return { ready: true, authType, detail: authType === 'chatgpt' ? 'Connected through your ChatGPT login.' : authType === 'apiKey' ? 'Connected with an OpenAI API key.' : 'Codex is ready.' };
  } catch (error) {
    return { ready: false, detail: errorCode(error) === 'ENOENT' ? 'Codex CLI is not on PATH.' : errorMessage(error) };
  } finally {
    await server.close();
  }
}

export interface CodexStage {
  workspace: string;
  logBase: string;
  prompt: string;
  model?: string | undefined;
  effort?: string | undefined;
  timeoutMs: number;
}

interface TurnUsage {
  input_tokens: number | undefined;
  cached_input_tokens: number | undefined;
  output_tokens: number | undefined;
}

export async function runCodexStage({ workspace, logBase, prompt, model, effort, timeoutMs }: CodexStage): Promise<{ log: string }> {
  const lines: string[] = [];
  const events: object[] = [];
  let usage: TurnUsage | undefined;
  let finish: (turn: CodexTurn) => void = () => {};
  let fail: (error: Error) => void = () => {};
  let threadId: string | undefined;
  let turnId: string | undefined;
  let earlyCompletion: CodexTurn | undefined;
  const completed = new Promise<CodexTurn>((resolve, reject) => { finish = resolve; fail = reject; });
  completed.catch(() => {});
  const server = new CodexAppServer({
    cwd: workspace,
    stderrPath: `${logBase}.stderr`,
    onNotification: (event) => {
      if (event.method === 'item/completed') {
        const item = itemCompletedSchema.safeParse(event.params);
        if (item.success) {
          events.push({ type: 'item.completed', item: item.data.item });
          if (item.data.item.type === 'agentMessage' && item.data.item.text !== undefined) lines.push(item.data.item.text);
        } else events.push({ type: 'item.completed', item: undefined });
      }
      if (event.method === 'thread/tokenUsage/updated') {
        const tokens = tokenUsageSchema.safeParse(event.params);
        const last = tokens.success ? tokens.data.tokenUsage.last : undefined;
        if (last) usage = { input_tokens: last.inputTokens, cached_input_tokens: last.cachedInputTokens, output_tokens: last.outputTokens };
      }
      if (event.method === 'provider/requestUnsupported') {
        const request = unsupportedRequestSchema.safeParse(event.params);
        fail(new Error(`Codex requested ${request.success ? request.data.method : 'an interactive request'}; this needs an interactive answer in YouIAgent.`));
      }
      if (event.method !== 'turn/completed') return;
      const done = turnCompletedSchema.safeParse(event.params);
      if (!done.success || done.data.threadId !== threadId) return;
      if (!turnId) { earlyCompletion = done.data.turn; return; }
      if (done.data.turn.id === turnId) finish(done.data.turn);
    },
  });
  const timer = setTimeout(() => fail(new Error('Codex generation timed out.')), timeoutMs);
  try {
    await server.open();
    const account = await server.call('account/read', {}, accountReadSchema);
    if (!account.account && account.requiresOpenaiAuth) throw new Error('Codex is not signed in. Run codex login.');
    const thread = await server.call('thread/start', {
      cwd: workspace, model: model || null, approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review', sandbox: 'workspace-write', ephemeral: true,
    }, threadStartSchema);
    threadId = thread.thread.id;
    const started = await server.call('turn/start', {
      threadId, input: [{ type: 'text', text: prompt, text_elements: [] }],
      ...(effort ? { effort } : {}),
    }, turnStartSchema);
    turnId = started.turn.id;
    if (earlyCompletion?.id === turnId) finish(earlyCompletion);
    const turn = await completed;
    if (turn.status !== 'completed') throw new Error(`Codex turn ${turn.status}: ${turn.error?.message || 'generation did not finish'}`);
    const last = [...(turn.items ?? [])].reverse().find((item) => item.type === 'agentMessage')?.text || lines.at(-1) || '';
    events.push({ type: 'turn.completed', usage: usage ?? null, status: turn.status });
    await writeFile(`${logBase}.stdout`, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
    await writeFile(`${logBase}.last.txt`, last);
    return { log: `${logBase}.stdout` };
  } finally {
    clearTimeout(timer);
    await server.close();
  }
}
