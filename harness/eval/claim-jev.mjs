import { privateKeys } from '../../web/private-keys.mjs';

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

export function claimRequest(claim, quote, sourcePath) {
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

export async function evaluateClaim(claim, quote, sourcePath, { fetcher = fetch, apiKey } = {}) {
  apiKey ??= (await privateKeys()).openrouter;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for the graph claim gate.');
  const response = await fetcher(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(claimRequest(claim, quote, sourcePath)),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok || result.answers?.supported?.type !== 'noul' || !Number.isFinite(result.answers.supported.noul)) {
    throw new Error(`Jev claim check failed (${response.status}).`);
  }
  return { probabilitySupported: result.answers.supported.noul, model: result.model, usage: result.usage ?? null };
}
