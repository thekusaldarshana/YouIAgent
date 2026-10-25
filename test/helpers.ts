import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJson } from '../shared/json.js';

/** Asserts a value is present and returns it narrowed, for fixtures whose shape the test controls. */
export function defined<T>(value: T | null | undefined, message = 'expected a value'): T {
  assert.ok(value !== null && value !== undefined, message);
  return value;
}

/** Runs `work` in a fresh temporary directory that is always removed afterwards. */
export async function withTempDir<T>(prefix: string, work: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try { return await work(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

export function jsonOf(text: string): unknown {
  return parseJson(text);
}

export async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('Could not reserve a port.');
  return address.port;
}

/** Polls until `probe` returns a value, failing with `description` after `timeoutMs`. */
export async function waitFor<T>(description: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 150_000, intervalMs = 400): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
