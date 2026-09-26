import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCrossProcessEmbeddingStability } from '../benchmark/stability.mjs';

test('verifies cross-process embedding vector and ranking stability across cold starts', async () => {
  const mockVectorMap = new Map([
    ['tool_a', [1, 0, 0]],
    ['tool_b', [0, 1, 0]],
    ['query_1', [1, 0, 0]],
  ]);

  function createMockClient() {
    return {
      embed: async inputs => inputs.map(input => mockVectorMap.get(input) ?? [0, 0, 1]),
    };
  }

  // Create 3 mock cold process client instances
  const clients = [createMockClient(), createMockClient(), createMockClient()];

  const result = await evaluateCrossProcessEmbeddingStability({
    clients,
    queries: [{ query: 'query_1', expected: 'tool_a' }],
    tools: [
      { id: 'tool_a', document: 'tool_a' },
      { id: 'tool_b', document: 'tool_b' },
    ],
    topK: 1,
  });

  assert.equal(result.runsEvaluated, 3);
  assert.equal(result.isStable, true);
  assert.equal(result.minToolVectorCosine, 1);
  assert.equal(result.rankingChangeCount, 0);
  assert.equal(result.topKMembershipChangeCount, 0);
});

test('detects cross-process instability if vectors shift across restarts', async () => {
  const client1 = { embed: async inputs => inputs.map(() => [1, 0]) };
  const client2 = { embed: async inputs => inputs.map(() => [0, 1]) }; // shifted vector in process 2!

  const result = await evaluateCrossProcessEmbeddingStability({
    clients: [client1, client2],
    queries: [{ query: 'q', expected: 't1' }],
    tools: [{ id: 't1', document: 't1' }],
    topK: 1,
  });

  assert.equal(result.isStable, false);
  assert.ok(result.minToolVectorCosine < 0.99);
});
