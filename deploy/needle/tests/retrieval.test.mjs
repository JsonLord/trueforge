import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEmbeddingVsStructuredProposal } from '../benchmark/proposal.mjs';
import { benchmarkRetrieval, cosine } from '../benchmark/retrieval.mjs';

test('calculates cosine similarity correctly', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([], []), undefined);
  assert.equal(cosine([1, 0], [1]), undefined);
  assert.equal(cosine([Number.NaN, 0], [1, 0]), undefined);
});

test('calculates deterministic retrieval metrics with distractors', async () => {
  const values = new Map([
    ['status document', [1, 0]],
    ['file document', [0, 1]],
    ['distractor', [-1, 0]],
    ['show status', [1, 0]],
    ['read file', [0, 1]],
  ]);
  const client = { embed: async inputs => inputs.map(input => values.get(input)) };
  const result = await benchmarkRetrieval({
    client,
    fixtures: [
      { query: 'show status', expected: 'status', actionType: 'read' },
      { query: 'read file', expected: 'file', actionType: 'read' },
    ],
    tools: [
      { id: 'status', document: 'status document', actionType: 'read' },
      { id: 'file', document: 'file document', actionType: 'read' },
      { id: 'delete', document: 'distractor', actionType: 'destructive' },
    ],
    topK: 2,
    registrySizes: [3],
  });
  assert.equal(result.top1Accuracy, 1);
  assert.equal(result.top3Recall, 1);
  assert.equal(result.configuredTopKRecall, 1);
  assert.equal(result.mrr, 1);
  assert.equal(result.meanCorrectRank, 1);
  assert.equal(result.medianCorrectRank, 1);
  assert.equal(result.worstCorrectRank, 1);
  assert.equal(result.actionMismatchTop1Count, 0);
  assert.equal(result.correctToolAbsentFromTopK, 0);
  assert.equal(result.embeddingErrors, 0);
  assert.equal(result.catastrophicMissCount, 0);
  assert.ok(result.candidateReductionPercent > 0);
});

test('detects action mismatches and catastrophic misses when distractor dominates', async () => {
  const values = new Map([
    ['read doc', [0, 1]],
    ['delete doc', [1, 0]],
    ['read request', [1, 0]], // read query accidentally embedded close to delete tool!
  ]);
  const client = { embed: async inputs => inputs.map(input => values.get(input)) };
  const result = await benchmarkRetrieval({
    client,
    fixtures: [{ query: 'read request', expected: 'read_tool', actionType: 'read' }],
    tools: [
      { id: 'delete_tool', document: 'delete doc', actionType: 'destructive' },
      { id: 'read_tool', document: 'read doc', actionType: 'read' },
    ],
    topK: 1,
    registrySizes: [2],
  });
  assert.equal(result.top1Accuracy, 0);
  assert.equal(result.actionMismatchTop1Count, 1);
  assert.equal(result.correctToolAbsentFromTopK, 1);
  assert.equal(result.catastrophicMissCount, 1);
});

test('evaluates threshold simulations and topK sweeps', async () => {
  const values = new Map([
    ['status document', [1, 0]],
    ['file document', [0, 1]],
    ['show status', [1, 0]],
  ]);
  const client = { embed: async inputs => inputs.map(input => values.get(input)) };
  const result = await benchmarkRetrieval({
    client,
    fixtures: [{ query: 'show status', expected: 'status', actionType: 'read' }],
    tools: [
      { id: 'status', document: 'status document', actionType: 'read' },
      { id: 'file', document: 'file document', actionType: 'read' },
    ],
    topK: 1,
    thresholds: [{ minTopSimilarity: 0.8, minMargin: 0.1 }],
    topKSweepValues: [1, 2],
    registrySizes: [2],
  });
  assert.equal(result.thresholdSimulations.length, 1);
  assert.equal(result.thresholdSimulations[0].acceptedRate, 1);
  assert.equal(result.topKSweep.length, 2);
  assert.equal(result.topKSweep[0].topK, 1);
  assert.equal(result.topKSweep[0].recall, 1);
});

test('compares embedding retrieval vs structured tool proposal and two-stage pipeline', async () => {
  const values = new Map([
    ['status document', [1, 0]],
    ['file document', [0, 1]],
    ['show status', [1, 0]],
  ]);
  const client = {
    embed: async inputs => inputs.map(input => values.get(input)),
    selectTools: async ({ candidates }) => ({
      toolIds: [candidates[0].id],
      confidence: 1.0,
    }),
  };
  const result = await compareEmbeddingVsStructuredProposal({
    client,
    fixtures: [{ query: 'show status', expected: 'status', actionType: 'read' }],
    tools: [
      { id: 'status', document: 'status document', actionType: 'read' },
      { id: 'file', document: 'file document', actionType: 'read' },
    ],
    candidateCounts: [2],
  });
  assert.equal(result.resultsByCandidateCount.length, 1);
  assert.equal(result.resultsByCandidateCount[0].modeA.top1Accuracy, 1);
  assert.equal(result.resultsByCandidateCount[0].modeB.top1Accuracy, 1);
  assert.equal(result.resultsByCandidateCount[0].twoStagePipeline.top1Accuracy, 1);
});

test('reports embedding failures without claiming scores', async () => {
  const result = await benchmarkRetrieval({
    client: {
      embed: async () => {
        throw new Error('unavailable');
      },
    },
    fixtures: [{ query: 'show status', expected: 'status' }],
    tools: [{ id: 'status', document: 'status document' }],
    topK: 1,
  });
  assert.deepEqual(
    {
      top1: result.top1Accuracy,
      top3: result.top3Recall,
      topK: result.configuredTopKRecall,
      errors: result.embeddingErrors,
    },
    { top1: 0, top3: 0, topK: 0, errors: 1 },
  );
});
