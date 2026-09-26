import { performance } from 'node:perf_hooks';
import { ALL_TOOLS, BENCHMARK_QUERIES } from './corpus.mjs';
import { cosine } from './retrieval.mjs';

function isMutating(actionType) {
  return actionType === 'write' || actionType === 'destructive' || actionType === 'external_side_effect';
}

function isActionMismatch(expectedActionType, predictedActionType) {
  if (!expectedActionType || !predictedActionType) {
    return false;
  }
  if (expectedActionType === 'read' && isMutating(predictedActionType)) {
    return true;
  }
  if (isMutating(expectedActionType) && predictedActionType === 'read') {
    return true;
  }
  return false;
}

export async function compareEmbeddingVsStructuredProposal({
  client,
  fixtures = BENCHMARK_QUERIES,
  tools = ALL_TOOLS,
  candidateCounts = [5, 10, 25, 50],
}) {
  const resultsByCandidateCount = [];

  // Pre-embed tool documents for Mode A & Stage 1
  let toolVectors = [];
  try {
    toolVectors = await client.embed(tools.map(tool => tool.document ?? tool.id));
  } catch {
    return { error: 'Failed to embed tool registry for structured proposal comparison' };
  }

  for (const count of candidateCounts) {
    const candidateSubset = tools.slice(0, Math.min(count, tools.length));
    const subsetVectors = toolVectors.slice(0, candidateSubset.length);
    const validCandidateIds = new Set(candidateSubset.map(t => t.id));

    let modeATop1Correct = 0;
    let modeBTop1Correct = 0;
    let modeBWrongAction = 0;
    let modeBFailures = 0;
    let modeATotalLatencyMs = 0;
    let modeBTotalLatencyMs = 0;

    let twoStageTop1Correct = 0;
    let twoStageFailures = 0;
    let twoStageTotalLatencyMs = 0;

    const evalFixtures = fixtures.filter(f => validCandidateIds.has(f.expected));

    for (const fixture of evalFixtures) {
      // --- Mode A: Embedding Cosine Ranking ---
      const modeAStart = performance.now();
      let top1ModeATool = null;
      try {
        const [queryVector] = await client.embed([fixture.query]);
        const rankedA = candidateSubset
          .map((tool, index) => ({ tool, score: cosine(queryVector, subsetVectors[index]) ?? -1 }))
          .sort((a, b) => b.score - a.score);
        top1ModeATool = rankedA[0]?.tool ?? null;
      } catch {
        // Mode A failure
      }
      modeATotalLatencyMs += performance.now() - modeAStart;

      if (top1ModeATool?.id === fixture.expected) {
        modeATop1Correct += 1;
      }

      // --- Mode B: Constrained Structured Proposal ---
      const modeBStart = performance.now();
      let top1ModeBTool = null;
      try {
        if (client.selectTools) {
          const response = await client.selectTools({
            query: fixture.query,
            candidates: candidateSubset.map(t => ({ id: t.id, score: 1.0 })),
          });
          const selectedId = response.toolIds[0];
          if (selectedId && validCandidateIds.has(selectedId)) {
            top1ModeBTool = candidateSubset.find(t => t.id === selectedId) ?? null;
          } else {
            modeBFailures += 1; // returned ID outside authorized candidate set
          }
        } else {
          // Fallback if client.selectTools is unavailable
          top1ModeBTool = top1ModeATool;
        }
      } catch {
        modeBFailures += 1;
      }
      modeBTotalLatencyMs += performance.now() - modeBStart;

      if (top1ModeBTool?.id === fixture.expected) {
        modeBTop1Correct += 1;
      }
      if (top1ModeBTool && isActionMismatch(fixture.actionType, top1ModeBTool.actionType)) {
        modeBWrongAction += 1;
      }

      // --- Two-Stage Experimental Pipeline ---
      // Full Registry -> Embeddings Top 10 -> Structured Reranker -> Predicted Tool
      const stageStart = performance.now();
      try {
        const [queryVector] = await client.embed([fixture.query]);
        const top10Candidates = tools
          .map((tool, index) => ({ tool, score: cosine(queryVector, toolVectors[index]) ?? -1 }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);

        const top10Ids = new Set(top10Candidates.map(c => c.id));
        let stage2PredictedTool = top10Candidates[0]?.tool ?? null;

        if (client.selectTools) {
          const stage2Resp = await client.selectTools({
            query: fixture.query,
            candidates: top10Candidates.map(c => ({ id: c.id, score: c.score })),
          });
          const selectedStage2Id = stage2Resp.toolIds[0];
          if (selectedStage2Id && top10Ids.has(selectedStage2Id)) {
            stage2PredictedTool = tools.find(t => t.id === selectedStage2Id) ?? stage2PredictedTool;
          }
        }

        if (stage2PredictedTool?.id === fixture.expected) {
          twoStageTop1Correct += 1;
        }
      } catch {
        twoStageFailures += 1;
      }
      twoStageTotalLatencyMs += performance.now() - stageStart;
    }

    const total = evalFixtures.length;
    resultsByCandidateCount.push({
      candidateCount: count,
      evalCount: total,
      modeA: {
        top1Accuracy: total > 0 ? modeATop1Correct / total : 0,
        avgLatencyMs: total > 0 ? modeATotalLatencyMs / total : 0,
      },
      modeB: {
        top1Accuracy: total > 0 ? modeBTop1Correct / total : 0,
        avgLatencyMs: total > 0 ? modeBTotalLatencyMs / total : 0,
        failureRate: total > 0 ? modeBFailures / total : 0,
        wrongActionSelectionRate: total > 0 ? modeBWrongAction / total : 0,
      },
      twoStagePipeline: {
        top1Accuracy: total > 0 ? twoStageTop1Correct / total : 0,
        avgLatencyMs: total > 0 ? twoStageTotalLatencyMs / total : 0,
        failureRate: total > 0 ? twoStageFailures / total : 0,
      },
    });
  }

  return { resultsByCandidateCount };
}
