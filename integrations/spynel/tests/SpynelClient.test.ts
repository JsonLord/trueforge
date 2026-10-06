import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SpynelAmbiguousMessageError, SpynelClient } from '../client/SpynelClient.js';

async function fixture(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<{ client: SpynelClient; close: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'spynel-client-'));
  await chmod(directory, 0o700);
  const socketPath = path.join(directory, 'api.sock');
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  await writeFile(
    `${socketPath}.json`,
    JSON.stringify({ schema: 'spynel.socket/v1', workspace_id: 'a'.repeat(64), token: 'b'.repeat(32) }),
    { mode: 0o600 },
  );
  return {
    client: new SpynelClient({ socketPath }),
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error === undefined ? resolve() : reject(error))),
      );
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('uses the descriptor bearer token without exposing it in URLs', async () => {
  const token = 'b'.repeat(32);
  const instance = await fixture((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.url, '/v1/health');
    response.writeHead(204).end();
  });
  try {
    assert.equal(await instance.client.health(), true);
  } finally {
    await instance.close();
  }
});

test('treats message EOF without a terminal envelope as ambiguous', async () => {
  const instance = await fixture((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/x-ndjson' });
    response.end('{"event":{"kind":"text","text":"partial"}}\n');
  });
  try {
    await assert.rejects(
      instance.client.send({
        channel: 'cli',
        conversation: 'trueforge-test',
        source_message_id: 'message-1',
        sender: 'trueforge',
        followup_only: false,
        text: 'hello',
      }),
      SpynelAmbiguousMessageError,
    );
  } finally {
    await instance.close();
  }
});
