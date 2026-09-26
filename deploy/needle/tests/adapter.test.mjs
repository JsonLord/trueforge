/* global Response, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createNeedleClient } from '../adapter/client.mjs';

function response(value, status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('validates and maps all provider-neutral operations', async () => {
  const requests = [];
  const client = createNeedleClient({
    fetchImpl: async (url, options) => {
      requests.push({ path: url.pathname, body: JSON.parse(options.body) });
      if (url.pathname === '/v1/classify') {
        return response({ complexity: 'simple', actionClass: 'read', confidence: 0.97 });
      }
      if (url.pathname === '/v1/embed') {
        return response({
          vectors: [
            [1, 0],
            [0, 1],
          ],
        });
      }
      return response({ arguments: { state: 'open' }, confidence: 0.94 });
    },
  });
  assert.deepEqual(await client.classifyRequest({ query: 'status', toolsAvailable: true }), {
    complexity: 'simple',
    actionClass: 'read',
    confidence: 0.97,
  });
  assert.deepEqual(await client.embed(['one', 'two']), [
    [1, 0],
    [0, 1],
  ]);
  assert.deepEqual(
    await client.extractToolArguments({
      query: 'open prs',
      tool: { name: 'list_prs', inputSchema: { type: 'object' } },
    }),
    { arguments: { state: 'open' }, confidence: 0.94 },
  );
  assert.deepEqual(
    requests.map(item => item.path),
    ['/v1/classify', '/v1/embed', '/v1/extract'],
  );
  assert.deepEqual(requests[0].body, { request: 'status', toolsAvailable: true });
});

test('rejects non-loopback URLs and malformed responses', async () => {
  assert.throws(() => createNeedleClient({ url: 'https://needle.example.com' }), /loopback/);
  for (const value of [
    { complexity: 'fast', actionClass: 'read', confidence: 1 },
    { complexity: 'simple', actionClass: 'execute', confidence: 1 },
    { complexity: 'simple', actionClass: 'read', confidence: Number.NaN },
    { complexity: 'simple', actionClass: 'read', confidence: 2 },
  ]) {
    const client = createNeedleClient({ fetchImpl: async () => response(value) });
    await assert.rejects(client.classifyRequest({ query: 'x', toolsAvailable: false }));
  }
  const malformed = createNeedleClient({ fetchImpl: async () => response('{') });
  await assert.rejects(malformed.classifyRequest({ query: 'x', toolsAvailable: false }));
});

test('rejects HTTP errors, unavailable runtime, connection errors, invalid vectors, and extraction', async () => {
  for (const status of [500, 503]) {
    const client = createNeedleClient({ fetchImpl: async () => response({ error: 'failure' }, status) });
    await assert.rejects(client.classifyRequest({ query: 'x', toolsAvailable: false }), new RegExp(`${status}`));
  }
  const refused = createNeedleClient({
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(refused.embed(['x']), /fetch failed/);
  for (const vectors of [[], [[]], [[1], [2]], [[Number.NaN]], [['one']]]) {
    const client = createNeedleClient({ fetchImpl: async () => response({ vectors }) });
    await assert.rejects(client.embed(['x']));
  }
  for (const extraction of [
    { arguments: 'bad', confidence: 1 },
    { arguments: {}, confidence: null },
  ]) {
    const client = createNeedleClient({ fetchImpl: async () => response(extraction) });
    await assert.rejects(client.extractToolArguments({ query: 'x', tool: { name: 't', inputSchema: {} } }));
  }
});

test('aborts a timed-out request', async () => {
  const client = createNeedleClient({
    timeoutMs: 10,
    fetchImpl: (_url, options) =>
      new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => {
          // timer to keep event loop active during timeout test
        }, 100);
        options.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(keepAlive);
            reject(options.signal.reason);
          },
          { once: true },
        );
      }),
  });
  await assert.rejects(client.classifyRequest({ query: 'x', toolsAvailable: false }), /timeout|aborted/i);
});

test('uses the real HTTP boundary without exposing request data in errors', async t => {
  const server = createServer((request, responseStream) => {
    request.resume();
    responseStream.writeHead(503, { 'content-type': 'application/json' });
    responseStream.end('{"error":"runtime_unavailable"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const client = createNeedleClient({ url: `http://127.0.0.1:${address.port}` });
  await assert.rejects(
    client.classifyRequest({ query: 'private credential text', toolsAvailable: true }),
    error => !String(error).includes('private credential text'),
  );
});
