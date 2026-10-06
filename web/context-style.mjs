import { privateKeys } from './private-keys.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ENDPOINT = 'https://api.context.dev/v1/web/styleguide';
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

export async function extractStyleguide(domain, { fetcher = fetch, key, timeoutMs = 45_000, cacheDir = null, sourceFingerprint = null, now = Date.now() } = {}) {
  if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error('Invalid styleguide domain.');
  if (cacheDir && !sourceFingerprint) throw new Error('A source fingerprint is required to cache a styleguide.');
  const cacheKey = sourceFingerprint && createHash('sha256').update(JSON.stringify({ domain: domain.toLowerCase(), sourceFingerprint })).digest('hex');
  const cachePath = cacheDir ? join(cacheDir, `${cacheKey}.json`) : null;
  if (cachePath) {
    const cached = await readFile(cachePath, 'utf8').then(JSON.parse).catch(() => null);
    if (cached?.available && Number.isFinite(cached.savedAt) && now - cached.savedAt < CACHE_MS) {
      return { ...cached.result, creditsUsed: 0, cacheStatus: 'local' };
    }
  }
  key ??= (await privateKeys()).context;
  if (!key) return { available: false, reason: 'Context.dev key missing' };
  const url = new URL(ENDPOINT);
  url.searchParams.set('domain', domain);
  url.searchParams.set('colorScheme', 'light');
  url.searchParams.set('timeoutOpts[milliseconds]', String(Math.min(timeoutMs - 5_000, 300_000)));
  url.searchParams.set('timeoutOpts[behavior]', 'fail');
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  if (!response.ok) return {
    available: false, reason: body.error_code || `HTTP ${response.status}`,
    requestId: body.request_id || response.headers.get('x-request-id') || null,
    creditsUsed: Number(response.headers.get('x-credits-used') || body.key_metadata?.credits_consumed || 0),
  };
  if (!body.styleguide) return { available: false, reason: 'No styleguide returned', creditsUsed: Number(body.key_metadata?.credits_consumed || 0) };
  const result = {
    available: true,
    domain: body.domain || domain,
    styleguide: body.styleguide,
    requestId: body.request_id || null,
    creditsUsed: Number(response.headers.get('x-credits-used') || body.key_metadata?.credits_consumed || 0),
    cacheStatus: body.cache_metadata?.status || null,
  };
  if (cachePath) {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ available: true, domain: domain.toLowerCase(), sourceFingerprint, savedAt: now, result }));
  }
  return result;
}

function printable(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 240);
}

export function styleguideMarkdown(result) {
  if (!result?.available) return '';
  const guide = result.styleguide;
  const lines = [
    '## Context.dev observed styleguide',
    '',
    `Source: Context.dev Styleguide for ${printable(result.domain)} (request ${printable(result.requestId || 'unavailable')})`,
    'These are extracted observations. Verify against a screenshot before final render.',
    '',
    `- Mode: ${printable(guide.mode)}`,
    `- Accent: ${printable(guide.colors?.accent)}`,
    `- Background: ${printable(guide.colors?.background)}`,
    `- Text: ${printable(guide.colors?.text)}`,
  ];
  for (const level of ['h1', 'h2', 'h3']) {
    const heading = guide.typography?.headings?.[level];
    if (heading) lines.push(`- ${level.toUpperCase()}: ${printable(heading.fontFamily)}; ${printable(heading.fontSize)}; weight ${printable(heading.fontWeight)}; line-height ${printable(heading.lineHeight)}; tracking ${printable(heading.letterSpacing)}`);
  }
  for (const [name, value] of Object.entries(guide.elementSpacing || {}).slice(0, 8)) {
    if (typeof value === 'string' || typeof value === 'number') lines.push(`- Spacing ${printable(name)}: ${printable(value)}`);
    else if (value && typeof value === 'object') {
      const fields = Object.entries(value).filter(([, item]) => typeof item === 'string' || typeof item === 'number').slice(0, 4);
      if (fields.length) lines.push(`- Spacing ${printable(name)}: ${fields.map(([key, item]) => `${printable(key)} ${printable(item)}`).join(', ')}`);
    }
  }
  for (const [name, style] of Object.entries(guide.components || {}).slice(0, 5)) {
    if (style && typeof style === 'object') lines.push(`- ${printable(name)}: background ${printable(style.backgroundColor)}, text ${printable(style.textColor)}, radius ${printable(style.borderRadius)}, padding ${printable(style.padding)}`);
  }
  const links = Array.isArray(guide.fontLinks) ? guide.fontLinks : [];
  if (links.length) lines.push(`- Font links observed: ${links.slice(0, 5).map((link) => printable(typeof link === 'string' ? link : link.url || link.href || link.fontFamily)).join(' | ')}`);
  return lines.join('\n');
}
