import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { NeedleToolSelectorPolicy } from '../../../packages/trueforge-core/dist/core/index.mjs';
import { createNeedleClient } from '../adapter/client.mjs';

const logger = { debug() {}, warn() {}, error() {}, info() {} };

async function fakeService(handler) {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => handler({ request, response, body: JSON.parse(body) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test('real adapter drives classifier, retrieval, and proposal-only extraction contracts', async t => {
  const { server, url } = await fakeService(({ request, response, body }) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/classify') {
      response.end(JSON.stringify({ complexity: 'simple', actionClass: 'read', confidence: 0.98 }));
    } else if (request.url === '/v1/embed') {
      response.end(JSON.stringify({ vectors: body.inputs.map(value => value.includes('status') ? [1, 0] : [0, 1]) }));
    } else {
      response.end(JSON.stringify({ arguments: { path: 'package.json' }, confidence: 0.95 }));
    }
  });
  t.after(() => server.close());
  const policy = new NeedleToolSelectorPolicy({
    client: createNeedleClient({ url }), logger, enabled: true, topK: 1,
    requestClassificationEnabled: true, argumentExtractionEnabled: true,
  });
  assert.deepEqual(await policy.classify({ query: 'Show git status.', toolsAvailable: true }), {
    complexity: 'simple', actionClass: 'read', confidence: 0.98,
  });
  const tools = [
    { name: 'git_status', description: 'show status', inputSchema: { type: 'object' } },
    { name: 'read_file', description: 'read file', inputSchema: { type: 'object' } },
  ];
  assert.deepEqual((await policy.selectTools({ query: 'show status', tools, serverName: 'local' })).map(tool => tool.name), ['git_status']);
  assert.deepEqual(
    await policy.extract({ query: 'read package', tool: tools[1], currentArguments: { path: 'wrong' } }),
    { path: 'package.json' },
  );
});

test('service failures preserve conservative classification, tools, and model arguments', async t => {
  const { server, url } = await fakeService(({ response }) => {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{"error":"runtime_unavailable"}');
  });
  t.after(() => server.close());
  const policy = new NeedleToolSelectorPolicy({
    client: createNeedleClient({ url }), logger, enabled: true,
    requestClassificationEnabled: true, argumentExtractionEnabled: true,
  });
  const tools = [{ name: 'write_file', description: 'write file', inputSchema: { type: 'object' } }];
  assert.deepEqual(await policy.classify({ query: 'write', toolsAvailable: true }), {
    complexity: 'unknown', actionClass: 'unknown', confidence: 0,
  });
  assert.equal(await policy.selectTools({ query: 'write', tools, serverName: 'local' }), tools);
  assert.equal(await policy.extract({ query: 'write', tool: tools[0], currentArguments: { safe: true } }), undefined);
});
