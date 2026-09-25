import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkRetrieval } from '../benchmark/retrieval.mjs';

test('calculates deterministic retrieval metrics with distractors', async () => {
  const values = new Map([
    ['status document', [1, 0]], ['file document', [0, 1]], ['distractor', [-1, 0]],
    ['show status', [1, 0]], ['read file', [0, 1]],
  ]);
  const client = { embed: async inputs => inputs.map(input => values.get(input)) };
  const result = await benchmarkRetrieval({
    client,
    fixtures: [{ query: 'show status', expected: 'status' }, { query: 'read file', expected: 'file' }],
    tools: [
      { id: 'status', document: 'status document' },
      { id: 'file', document: 'file document' },
      { id: 'delete', document: 'distractor' },
    ],
    topK: 2,
  });
  assert.equal(result.top1Accuracy, 1);
  assert.equal(result.top3Recall, 1);
  assert.equal(result.configuredTopKRecall, 1);
  assert.equal(result.embeddingErrors, 0);
});

test('reports embedding failures without claiming scores', async () => {
  const result = await benchmarkRetrieval({
    client: { embed: async () => { throw new Error('unavailable'); } },
    fixtures: [{ query: 'show status', expected: 'status' }],
    tools: [{ id: 'status', document: 'status document' }],
    topK: 1,
  });
  assert.deepEqual(
    { top1: result.top1Accuracy, top3: result.top3Recall, topK: result.configuredTopKRecall, errors: result.embeddingErrors },
    { top1: 0, top3: 0, topK: 0, errors: 1 },
  );
});
