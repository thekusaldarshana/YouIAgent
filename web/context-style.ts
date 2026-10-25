import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { isRecord, parseJson } from '../shared/json.js';
import { privateKeys } from './private-keys.js';

const ENDPOINT = 'https://api.context.dev/v1/web/styleguide';
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

/** The observed styleguide is third-party data, so it stays a bag of `unknown` and is narrowed field by field. */
export type Styleguide = Record<string, unknown>;

export interface AvailableStyleguide {
  available: true;
  domain: string;
  styleguide: Styleguide;
  requestId: string | null;
  creditsUsed: number;
  cacheStatus: string | null;
}

export interface UnavailableStyleguide {
  available: false;
  reason?: string;
  requestId?: string | null;
  creditsUsed?: number;
}

export type StyleguideResult = AvailableStyleguide | UnavailableStyleguide;

export interface StyleFetchResponse {
  ok: boolean;
  status?: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type StyleFetcher = (url: URL, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<StyleFetchResponse>;

export interface StyleguideOptions {
  fetcher?: StyleFetcher;
  key?: string;
  timeoutMs?: number;
  cacheDir?: string | null;
  sourceFingerprint?: string | null;
  now?: number;
}

const bodySchema = z.looseObject({
  domain: z.string().optional().catch(undefined),
  styleguide: z.record(z.string(), z.unknown()).optional().catch(undefined),
  request_id: z.string().optional().catch(undefined),
  error_code: z.string().optional().catch(undefined),
  key_metadata: z.looseObject({ credits_consumed: z.coerce.number().optional().catch(undefined) }).optional().catch(undefined),
  cache_metadata: z.looseObject({ status: z.string().optional().catch(undefined) }).optional().catch(undefined),
});

const availableSchema = z.object({
  available: z.literal(true),
  domain: z.string(),
  styleguide: z.record(z.string(), z.unknown()),
  requestId: z.string().nullable(),
  creditsUsed: z.number(),
  cacheStatus: z.string().nullable(),
});

const cacheEntrySchema = z.looseObject({ available: z.literal(true), savedAt: z.number(), result: availableSchema });

export async function extractStyleguide(domain: string, { fetcher = fetch, key, timeoutMs = 45_000, cacheDir = null, sourceFingerprint = null, now = Date.now() }: StyleguideOptions = {}): Promise<StyleguideResult> {
  if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error('Invalid styleguide domain.');
  if (cacheDir && !sourceFingerprint) throw new Error('A source fingerprint is required to cache a styleguide.');
  const cacheKey = sourceFingerprint && createHash('sha256').update(JSON.stringify({ domain: domain.toLowerCase(), sourceFingerprint })).digest('hex');
  const cachePath = cacheDir ? join(cacheDir, `${cacheKey}.json`) : null;
  if (cachePath) {
    const cached = await readFile(cachePath, 'utf8').then((text) => cacheEntrySchema.safeParse(parseJson(text))).catch(() => null);
    if (cached?.success && Number.isFinite(cached.data.savedAt) && now - cached.data.savedAt < CACHE_MS) {
      return { ...cached.data.result, creditsUsed: 0, cacheStatus: 'local' };
    }
  }
  const apiKey = key ?? (await privateKeys()).context;
  if (!apiKey) return { available: false, reason: 'Context.dev key missing' };
  const url = new URL(ENDPOINT);
  url.searchParams.set('domain', domain);
  url.searchParams.set('colorScheme', 'light');
  url.searchParams.set('timeoutOpts[milliseconds]', String(Math.min(timeoutMs - 5_000, 300_000)));
  url.searchParams.set('timeoutOpts[behavior]', 'fail');
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const parsed = bodySchema.safeParse(await response.json());
  const body = parsed.success ? parsed.data : {};
  const creditsUsed = Number(response.headers.get('x-credits-used') || body.key_metadata?.credits_consumed || 0);
  if (!response.ok) return {
    available: false, reason: body.error_code || `HTTP ${response.status}`,
    requestId: body.request_id || response.headers.get('x-request-id') || null,
    creditsUsed,
  };
  if (!body.styleguide) return { available: false, reason: 'No styleguide returned', creditsUsed: Number(body.key_metadata?.credits_consumed || 0) };
  const result: AvailableStyleguide = {
    available: true,
    domain: body.domain || domain,
    styleguide: body.styleguide,
    requestId: body.request_id || null,
    creditsUsed,
    cacheStatus: body.cache_metadata?.status || null,
  };
  if (cachePath) {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ available: true, domain: domain.toLowerCase(), sourceFingerprint, savedAt: now, result }));
  }
  return result;
}

function printable(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 240);
}

const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};

export function styleguideMarkdown(result: StyleguideResult | null | undefined): string {
  if (!result?.available) return '';
  const guide = result.styleguide;
  const colors = record(guide['colors']);
  const lines = [
    '## Context.dev observed styleguide',
    '',
    `Source: Context.dev Styleguide for ${printable(result.domain)} (request ${printable(result.requestId || 'unavailable')})`,
    'These are extracted observations. Verify against a screenshot before final render.',
    '',
    `- Mode: ${printable(guide['mode'])}`,
    `- Accent: ${printable(colors['accent'])}`,
    `- Background: ${printable(colors['background'])}`,
    `- Text: ${printable(colors['text'])}`,
  ];
  const headings = record(record(guide['typography'])['headings']);
  for (const level of ['h1', 'h2', 'h3']) {
    const heading = headings[level];
    if (isRecord(heading)) lines.push(`- ${level.toUpperCase()}: ${printable(heading['fontFamily'])}; ${printable(heading['fontSize'])}; weight ${printable(heading['fontWeight'])}; line-height ${printable(heading['lineHeight'])}; tracking ${printable(heading['letterSpacing'])}`);
  }
  for (const [name, value] of Object.entries(record(guide['elementSpacing'])).slice(0, 8)) {
    if (typeof value === 'string' || typeof value === 'number') lines.push(`- Spacing ${printable(name)}: ${printable(value)}`);
    else if (isRecord(value)) {
      const fields = Object.entries(value).filter(([, item]) => typeof item === 'string' || typeof item === 'number').slice(0, 4);
      if (fields.length) lines.push(`- Spacing ${printable(name)}: ${fields.map(([key, item]) => `${printable(key)} ${printable(item)}`).join(', ')}`);
    }
  }
  for (const [name, style] of Object.entries(record(guide['components'])).slice(0, 5)) {
    if (isRecord(style)) lines.push(`- ${printable(name)}: background ${printable(style['backgroundColor'])}, text ${printable(style['textColor'])}, radius ${printable(style['borderRadius'])}, padding ${printable(style['padding'])}`);
  }
  const fontLinks = guide['fontLinks'];
  const links: unknown[] = Array.isArray(fontLinks) ? fontLinks : [];
  if (links.length) lines.push(`- Font links observed: ${links.slice(0, 5).map((link) => printable(typeof link === 'string' ? link : isRecord(link) ? link['url'] || link['href'] || link['fontFamily'] : link)).join(' | ')}`);
  return lines.join('\n');
}
