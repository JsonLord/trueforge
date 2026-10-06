import type { SpynelClient } from '../client/SpynelClient.js';

export interface SafeSpynelStatus {
  available: boolean;
  status?: Record<string, unknown>;
  connections: Array<{ id: string; state: 'configured' | 'unconfigured' }>;
}

export async function getSafeSpynelStatus(options: {
  client: SpynelClient;
  conversation: string;
  remoteOpenCodeConfigured: boolean;
}): Promise<SafeSpynelStatus> {
  const available = await options.client.health();
  if (!available) return { available: false, connections: [] };
  const status = await options.client.status(options.conversation);
  return {
    available: true,
    status,
    connections: [
      {
        id: 'windows-opencode',
        state: options.remoteOpenCodeConfigured ? 'configured' : 'unconfigured',
      },
    ],
  };
}
