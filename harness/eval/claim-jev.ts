import { z } from 'zod';
import { claimDecisionSchema, type ClaimDecision } from '../../shared/film.js';
import { privateKeys } from '../../web/private-keys.js';

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

const jevResponseSchema = z.looseObject({
  model: z.string().nullish().catch(undefined),
  answers: z.looseObject({
    supported: z.looseObject({ type: z.string(), noul: z.number() }).optional(),
  }).optional(),
  usage: claimDecisionSchema.shape.usage,
});

export function claimRequest(claim: string, quote: string, sourcePath: string) {
  if (!claim?.trim() || !quote?.trim() || !sourcePath?.trim()) throw new Error('Claim, exact source excerpt and path are required.');
  return {
    model: 'typesafe/jev-1.13',
    state: { proposedOnScreenClaim: claim, exactSourceExcerpt: quote, sourcePath },
    questions: {
      supported: {
        type: 'noul',
        instructions: 'Does the exact source excerpt support the proposed on-screen claim without adding a stronger promise or dropping a condition?',
        criteria: {
          true: 'The excerpt states or directly entails the complete claim, including any relevant conditions.',
          false: 'The excerpt is silent, contradicts the claim, or supports only a weaker or conditional version.',
        },
      },
    },
  };
}

/** The subset of `fetch` the claim gate needs, so tests can supply a deterministic response. */
export type ClaimFetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ClaimOptions {
  fetcher?: ClaimFetcher;
  apiKey?: string;
}

export type ClaimEvaluator = (claim: string, quote: string, sourcePath: string) => Promise<ClaimDecision>;

export async function evaluateClaim(claim: string, quote: string, sourcePath: string, { fetcher = fetch, apiKey }: ClaimOptions = {}): Promise<ClaimDecision> {
  const key = apiKey ?? (await privateKeys()).openrouter;
  if (!key) throw new Error('OPENROUTER_API_KEY is required for the graph claim gate.');
  const response = await fetcher(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(claimRequest(claim, quote, sourcePath)),
    signal: AbortSignal.timeout(30_000),
  });
  const parsed = jevResponseSchema.safeParse(await response.json());
  const supported = parsed.success ? parsed.data.answers?.supported : undefined;
  if (!parsed.success || !response.ok || supported?.type !== 'noul' || !Number.isFinite(supported.noul)) {
    throw new Error(`Jev claim check failed (${response.status}).`);
  }
  return { probabilitySupported: supported.noul, model: parsed.data.model, usage: parsed.data.usage ?? null };
}
