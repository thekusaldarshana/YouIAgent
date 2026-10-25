import { readFile, stat } from 'node:fs/promises';
import type { ZodType } from 'zod';

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

/** `JSON.parse` returns `any`; everything crossing a boundary is `unknown` until validated. */
export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export async function readJson(path: string): Promise<unknown> {
  return parseJson(await readFile(path, 'utf8'));
}

/** Reads and validates a JSON file; throws with the file path when it is malformed. */
export async function readJsonWith<T>(path: string, schema: ZodType<T>, label = path): Promise<T> {
  const parsed = schema.safeParse(await readJson(path));
  if (!parsed.success) throw new Error(`${label} is malformed: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`);
  return parsed.data;
}

/** Like `readJsonWith`, but a missing, unreadable, or malformed file yields `null`. */
export async function readJsonOrNull<T>(path: string, schema: ZodType<T>): Promise<T | null> {
  try {
    const parsed = schema.safeParse(await readJson(path));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Parses newline-delimited JSON, skipping blank and corrupt lines (logs may be mid-write). */
export function parseJsonLines<T>(raw: string, schema: ZodType<T>): T[] {
  const result: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const parsed = schema.safeParse(parseJson(line));
      if (parsed.success) result.push(parsed.data);
    } catch { /* A partially written line is not an event yet. */ }
  }
  return result;
}

export async function isFile(path: string): Promise<boolean> {
  return Boolean((await stat(path).catch(() => null))?.isFile());
}

export async function isDirectory(path: string): Promise<boolean> {
  return Boolean((await stat(path).catch(() => null))?.isDirectory());
}
