import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SpynelChatAdapter, conversationForSession } from '../adapter/SpynelChatAdapter.js';
import { SpynelClient } from '../client/SpynelClient.js';
import type { SpynelEventEnvelope } from '../types/protocol.js';

test('maps sessions to deterministic safe conversation names', () => {
  const first = conversationForSession('session/with unsafe input');
  assert.equal(first, conversationForSession('session/with unsafe input'));
  assert.match(first, /^trueforge-[a-f0-9]{32}$/);
  assert.notEqual(first, conversationForSession('another-session'));
});

test('applies an event before advancing the cursor and deduplicates it after reload', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'spynel-adapter-'));
  const statePath = path.join(directory, 'sessions.json');
  const client = new SpynelClient({ socketPath: '/run/not-used.sock' });
  const adapter = new SpynelChatAdapter({ client, statePath });
  const applied: string[] = [];
  const envelope: SpynelEventEnvelope = {
    schema: 'spynel.events/v1',
    event: { id: 'event-1', cursor: 'cursor-event', at: '2026-01-01T00:00:00Z', kind: 'assistant', text: 'done' },
    cursor: 'cursor-checkpoint',
  };
  try {
    await adapter.applyEnvelope({
      sessionId: 'session-1',
      envelope,
      apply: async event => void applied.push(event.id),
    });
    const reloaded = new SpynelChatAdapter({ client, statePath });
    await reloaded.applyEnvelope({
      sessionId: 'session-1',
      envelope,
      apply: async event => void applied.push(event.id),
    });
    assert.deepEqual(applied, ['event-1']);
    assert.match(await readFile(statePath, 'utf8'), /cursor-checkpoint/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
