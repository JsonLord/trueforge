import { createNeedleClient } from './client.mjs';

export const provider = 'needle';
export const model = 'Cactus-Compute/needle3@3e8e2a66057a29694052d915128b91b53e7e5ead';

export async function createClassifier({ timeoutMs }) {
  const client = createNeedleClient({ url: process.env.NEEDLE_URL ?? 'http://127.0.0.1:8792', timeoutMs });
  return { classify: input => client.classifyRequest(input) };
}
