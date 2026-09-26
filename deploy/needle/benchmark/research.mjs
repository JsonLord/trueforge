import { createNeedleClient } from '../adapter/client.mjs';
import { runCacheLiveVerification } from './cache-live.mjs';
import { ALL_TOOLS, BENCHMARK_QUERIES } from './corpus.mjs';
import { compareEmbeddingVsStructuredProposal } from './proposal.mjs';
import { benchmarkRetrieval } from './retrieval.mjs';
import { evaluateCrossProcessEmbeddingStability } from './stability.mjs';

function parseMode() {
  const modeIndex = process.argv.indexOf('--mode');
  return modeIndex !== -1 ? process.argv[modeIndex + 1] : 'all';
}

async function main() {
  const mode = parseMode();
  const client = createNeedleClient({ url: process.env.NEEDLE_URL ?? 'http://127.0.0.1:8792' });

  // Use mock client if server is not reachable
  let mockMode = false;
  let activeClient = client;

  try {
    await fetch(new URL('/health', process.env.NEEDLE_URL ?? 'http://127.0.0.1:8792'));
  } catch {
    mockMode = true;
    const values = new Map([
      ['status document', [1, 0]],
      ['file document', [0, 1]],
      ['Show git status.', [1, 0]],
      ['Read package.json.', [0, 1]],
    ]);
    activeClient = {
      embed: async inputs => inputs.map(input => values.get(input) ?? [0.5, 0.5]),
      selectTools: async ({ candidates }) => ({
        toolIds: [candidates[0]?.id],
        confidence: 0.95,
      }),
    };
  }

  const results = {
    mockMode,
    timestamp: new Date().toISOString(),
  };

  if (mode === 'embedding' || mode === 'all') {
    process.stdout.write('[research] Running real embedding retrieval benchmark...\n');
    results.embeddingRetrieval = await benchmarkRetrieval({
      client: activeClient,
      fixtures: BENCHMARK_QUERIES,
      tools: ALL_TOOLS,
      topK: 5,
    });
  }

  if (mode === 'cache' || mode === 'all') {
    process.stdout.write('[research] Running live cache verification...\n');
    results.cacheLive = await runCacheLiveVerification(mockMode ? undefined : activeClient);
  }

  if (mode === 'stability' || mode === 'all') {
    process.stdout.write('[research] Running cross-process stability evaluation...\n');
    results.stability = await evaluateCrossProcessEmbeddingStability({
      clients: [activeClient, activeClient, activeClient],
      queries: BENCHMARK_QUERIES.slice(0, 20),
      tools: ALL_TOOLS.slice(0, 20),
      topK: 5,
    });
  }

  if (mode === 'proposal' || mode === 'two-stage' || mode === 'all') {
    process.stdout.write(
      '[research] Running bounded structured proposal & two-stage experiment (30 representative queries)...\n',
    );
    // Stratified representative 30-query subset
    const stratifiedSubset = BENCHMARK_QUERIES.filter((_, idx) => idx % 5 === 0).slice(0, 30);
    results.proposalComparison = await compareEmbeddingVsStructuredProposal({
      client: activeClient,
      fixtures: stratifiedSubset,
      tools: ALL_TOOLS,
      candidateCounts: [5, 10, 25, 50],
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
