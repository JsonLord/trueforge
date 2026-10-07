import { OpenAPIHono } from '@hono/zod-openapi';
import { getSafeSpynelStatus } from '../../../../integrations/spynel/admin/status';
import { SpynelClient } from '../../../../integrations/spynel/client/SpynelClient';

export function createSpynelInternalRouter() {
  const router = new OpenAPIHono();

  router.get('/status', async c => {
    const socketPath = process.env['SPYNEL_SOCKET'] ?? '/run/spynel/api.sock';
    const client = new SpynelClient({ socketPath });
    const remoteOpenCodeConfigured =
      Boolean(process.env['OPENCODE_WINDOWS_ACP_URL']) && Boolean(process.env['OPENCODE_WINDOWS_ACP_TOKEN']);

    try {
      const safeStatus = await getSafeSpynelStatus({
        client,
        conversation: 'system-status',
        remoteOpenCodeConfigured,
      });
      return c.json({ data: safeStatus }, 200);
    } catch {
      return c.json({ data: { available: false, connections: [] } }, 200);
    }
  });

  return router;
}
