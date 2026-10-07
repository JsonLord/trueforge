import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  createHarnessBuilderServer,
  SYSTEM_SPYNEL_LIBRARY_ENTRY,
} from '@/plugins/trueforge-agent-server-adapter/builderServer.js';
import { createHarnessChatServer } from '@/plugins/trueforge-agent-server-adapter/chatServer.js';
import {
  isSpynelAgent,
  isSpynelSession,
  SYSTEM_SPYNEL_AGENT_NAME,
} from '@/plugins/trueforge-agent-server-adapter/types.js';

describe('Spynel composite integration', () => {
  it('isSpynelAgent identifies Spynel by ID and case-insensitive name', () => {
    assert.equal(isSpynelAgent('system-spynel'), true);
    assert.equal(isSpynelAgent('Spynel'), true);
    assert.equal(isSpynelAgent('spynel'), true);
    assert.equal(isSpynelAgent('SPYNEL'), true);
    assert.equal(isSpynelAgent('Developer'), false);
    assert.equal(isSpynelAgent(null), false);
  });

  it('isSpynelSession identifies Spynel sessions by prefix or agent name', () => {
    assert.equal(isSpynelSession('spynel-12345'), true);
    assert.equal(isSpynelSession({ id: 'spynel-999', agentName: 'Spynel' }), true);
    assert.equal(isSpynelSession({ id: 'tf-111', agentName: 'Spynel' }), true);
    assert.equal(isSpynelSession({ id: 'tf-111', agentName: 'Developer' }), false);
    assert.equal(isSpynelSession(null), false);
  });

  it('searchAgents prepends Spynel system entry first', async () => {
    const fetchMock: typeof fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/api/v1/agents')) {
        return Response.json({
          data: [
            {
              id: 'agt_dev',
              name: 'Developer',
              description: 'Software developer',
              manifest: { model: { name: 'gpt-4' } },
            },
          ],
          pagination: { limit: 25 },
        });
      }
      return new Response(`Unexpected: ${url}`, { status: 500 });
    };

    const builder = createHarnessBuilderServer({ fetch: fetchMock });
    const agents = await builder.searchAgents();

    assert.equal(agents.length, 2);
    assert.deepEqual(agents[0], SYSTEM_SPYNEL_LIBRARY_ENTRY);
    assert.equal(agents[1]?.name, 'Developer');
  });

  it('saveAgent and deleteAgent guard Spynel from mutation', async () => {
    const builder = createHarnessBuilderServer({ fetch: async () => new Response('ok') });

    await assert.rejects(
      builder.saveAgent({
        agentName: 'Spynel',
        agentSpec: { model: { name: 'gpt-4' } },
        intent: 'update',
      }),
      /cannot be modified/i,
    );

    if (builder.deleteAgent) {
      await assert.rejects(builder.deleteAgent({ agentName: 'Spynel' }), /cannot be deleted/i);
    }
  });

  it('createSession routes Spynel agent through client.sessions', async () => {
    const requests: { url: string; body: unknown }[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/api/v1/sessions')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        requests.push({ url, body });
        return Response.json({
          data: {
            id: 'spynel-session-1',
            agent: { type: 'reference', id: 'system-spynel', name: 'Spynel' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
      }
      return new Response('ok');
    };

    const chatServer = createHarnessChatServer({ fetch: fetchMock });
    const session = await chatServer.createSession({ agentName: 'Spynel' });

    assert.equal(session.agentName, SYSTEM_SPYNEL_AGENT_NAME);
    assert.equal(session.isMutable, false);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.body, { agent: { name: 'Spynel' } });
  });
});
