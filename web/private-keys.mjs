export async function privateKeys() {
  return {
    gateway: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY_KEY || '',
    context: process.env.CONTEXT_DEV_API_KEY || process.env.CONTEXT_DEV_API || '',
    openrouter: process.env.OPENROUTER_API_KEY || '',
  };
}
