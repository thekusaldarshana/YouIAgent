export interface PrivateKeys {
  gateway: string;
  context: string;
  openrouter: string;
}

/** Provider keys come only from the process environment; they are never persisted or sent to the browser. */
export async function privateKeys(): Promise<PrivateKeys> {
  return {
    gateway: process.env['AI_GATEWAY_API_KEY'] || process.env['VERCEL_AI_GATEWAY_KEY'] || '',
    context: process.env['CONTEXT_DEV_API_KEY'] || process.env['CONTEXT_DEV_API'] || '',
    openrouter: process.env['OPENROUTER_API_KEY'] || '',
  };
}
