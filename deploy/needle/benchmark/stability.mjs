import { ALL_TOOLS, BENCHMARK_QUERIES } from './corpus.mjs';
import { cosine } from './retrieval.mjs';

export async function evaluateCrossProcessEmbeddingStability({
  clients, // Array of at least 3 client instances representing cold process starts
  queries = BENCHMARK_QUERIES.slice(0, 20),
  tools = ALL_TOOLS.slice(0, 20),
  topK = 5,
}) {
  if (!clients || clients.length < 2) {
    throw new Error('At least 2 process clients are required to measure cross-process stability');
  }

  const runsData = [];

  for (let runIndex = 0; runIndex < clients.length; runIndex++) {
    const client = clients[runIndex];
    const toolVectors = await client.embed(tools.map(t => t.document ?? t.id));
    const queryVectors = [];
    const queryRankings = [];

    for (const fixture of queries) {
      const [queryVector] = await client.embed([fixture.query]);
      queryVectors.push(queryVector);

      const ranked = tools
        .map((tool, index) => ({ id: tool.id, score: cosine(queryVector, toolVectors[index]) ?? -1 }))
        .sort((a, b) => b.score - a.score);

      queryRankings.push({
        query: fixture.query,
        top1: ranked[0]?.id,
        topKSet: new Set(ranked.slice(0, topK).map(r => r.id)),
        fullOrder: ranked.map(r => r.id),
      });
    }

    runsData.push({
      runIndex,
      toolVectors,
      queryVectors,
      queryRankings,
    });
  }

  // Compare run 0 vs subsequent runs
  const baseline = runsData[0];
  let minToolCosine = 1.0;
  let maxToolVectorCosineDiff = 0.0;
  let minQueryCosine = 1.0;
  let maxQueryVectorCosineDiff = 0.0;
  let rankingChangeCount = 0;
  let topKMembershipChangeCount = 0;

  for (let r = 1; r < runsData.length; r++) {
    const compareRun = runsData[r];

    // Tool vector cosine comparison
    for (let t = 0; t < tools.length; t++) {
      const sim = cosine(baseline.toolVectors[t], compareRun.toolVectors[t]) ?? 0;
      if (sim < minToolCosine) {
        minToolCosine = sim;
      }
      const diff = Math.abs(1.0 - sim);
      if (diff > maxToolVectorCosineDiff) {
        maxToolVectorCosineDiff = diff;
      }
    }

    // Query vector cosine comparison
    for (let q = 0; q < queries.length; q++) {
      const sim = cosine(baseline.queryVectors[q], compareRun.queryVectors[q]) ?? 0;
      if (sim < minQueryCosine) {
        minQueryCosine = sim;
      }
      const diff = Math.abs(1.0 - sim);
      if (diff > maxQueryVectorCosineDiff) {
        maxQueryVectorCosineDiff = diff;
      }

      // Ranking & Top-K comparison
      const baseRanking = baseline.queryRankings[q];
      const compRanking = compareRun.queryRankings[q];

      if (
        baseRanking.top1 !== compRanking.top1 ||
        JSON.stringify(baseRanking.fullOrder) !== JSON.stringify(compRanking.fullOrder)
      ) {
        rankingChangeCount += 1;
      }

      const topKSame = [...baseRanking.topKSet].every(id => compRanking.topKSet.has(id));
      if (!topKSame) {
        topKMembershipChangeCount += 1;
      }
    }
  }

  const isStable =
    minToolCosine >= 0.9999 && minQueryCosine >= 0.9999 && rankingChangeCount === 0 && topKMembershipChangeCount === 0;

  return {
    runsEvaluated: clients.length,
    minToolVectorCosine: minToolCosine,
    maxToolVectorCosineDiff,
    minQueryVectorCosine: minQueryCosine,
    maxQueryVectorCosineDiff,
    rankingChangeCount,
    topKMembershipChangeCount,
    isStable,
  };
}
