import { createNeedleClient } from '../adapter/client.mjs';
import { ALL_TOOLS, BENCHMARK_QUERIES } from './corpus.mjs';
import { compareEmbeddingVsStructuredProposal } from './proposal.mjs';
import { benchmarkRetrieval } from './retrieval.mjs';

const client = createNeedleClient({ url: process.env.NEEDLE_URL ?? 'http://127.0.0.1:8792' });
const topK = Number(process.env.NEEDLE_TOP_K ?? '5');

const retrievalResult = await benchmarkRetrieval({
  client,
  fixtures: BENCHMARK_QUERIES,
  tools: ALL_TOOLS,
  topK,
});

const proposalResult = await compareEmbeddingVsStructuredProposal({
  client,
  fixtures: BENCHMARK_QUERIES,
  tools: ALL_TOOLS,
  candidateCounts: [5, 10, 25, 50],
});

const summary = {
  retrieval: retrievalResult,
  proposalComparison: proposalResult,
};

console.log(JSON.stringify(summary, null, 2));

if (retrievalResult.embeddingErrors > 0) {
  process.exitCode = 1;
}
