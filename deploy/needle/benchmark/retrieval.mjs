import { performance } from 'node:perf_hooks';
import { ALL_TOOLS, BENCHMARK_QUERIES } from './corpus.mjs';

export function cosine(left, right) {
  if (!left || !right || left.length === 0 || left.length !== right.length) {
    return undefined;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (!Number.isFinite(l) || !Number.isFinite(r)) {
      return undefined;
    }
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator === 0 ? undefined : dot / denominator;
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

function median(values) {
  return percentile(values, 50);
}

function isMutating(actionType) {
  return actionType === 'write' || actionType === 'destructive' || actionType === 'external_side_effect';
}

function isActionMismatch(queryActionType, toolActionType) {
  if (!queryActionType || !toolActionType) {
    return false;
  }
  if (queryActionType === 'read' && isMutating(toolActionType)) {
    return true;
  }
  if (isMutating(queryActionType) && toolActionType === 'read') {
    return true;
  }
  return false;
}

export async function benchmarkRetrieval({
  client,
  fixtures = BENCHMARK_QUERIES,
  tools = ALL_TOOLS,
  topK = 5,
  thresholds = [
    { minTopSimilarity: 0.5, minMargin: 0.01 },
    { minTopSimilarity: 0.6, minMargin: 0.02 },
    { minTopSimilarity: 0.7, minMargin: 0.05 },
    { minTopSimilarity: 0.8, minMargin: 0.1 },
  ],
  topKSweepValues = [1, 3, 5, 8, 10],
  registrySizes = [10, 25, 50],
}) {
  const startedAt = performance.now();
  let errors = 0;
  let toolEmbeddingBuildTimeMs = 0;
  let toolVectors = [];

  const toolBuildStarted = performance.now();
  try {
    toolVectors = await client.embed(tools.map(tool => tool.document ?? tool.id));
    toolEmbeddingBuildTimeMs = performance.now() - toolBuildStarted;
  } catch {
    errors = fixtures.length;
    toolEmbeddingBuildTimeMs = performance.now() - toolBuildStarted;
    return {
      top1Accuracy: 0,
      top3Recall: 0,
      top5Recall: 0,
      configuredTopKRecall: 0,
      mrr: 0,
      meanCorrectRank: 0,
      medianCorrectRank: 0,
      worstCorrectRank: 0,
      embeddingErrors: errors,
      latencyMs: performance.now() - startedAt,
      queryLatencyP50: 0,
      queryLatencyP95: 0,
      toolEmbeddingBuildTimeMs,
      actionMismatchTop1Count: 0,
      correctToolAbsentFromTopK: fixtures.length,
      candidateReductionPercent: 0,
      catastrophicMissCount: 0,
      margins: { correctPredictions: [], incorrectPredictions: [] },
      thresholdSimulations: [],
      topKSweep: [],
      registrySizeVariants: [],
      provisionalSuccessCriteria: {
        passed: false,
        details: { topKRecallPassed: false, zeroCatastrophicMissesPassed: false, candidateReductionPassed: false },
      },
    };
  }

  const queryLatencies = [];
  const rankings = [];
  let top1 = 0;
  let top3 = 0;
  let top5 = 0;
  let configured = 0;
  let reciprocalRankSum = 0;
  const ranks = [];
  let actionMismatchTop1Count = 0;
  let correctToolAbsentFromTopK = 0;
  let catastrophicMissCount = 0;

  const correctMargins = [];
  const incorrectMargins = [];

  for (const fixture of fixtures) {
    const qStarted = performance.now();
    try {
      const [queryVector] = await client.embed([fixture.query]);
      queryLatencies.push(performance.now() - qStarted);

      const scored = tools
        .map((tool, index) => {
          const score = cosine(queryVector, toolVectors[index]) ?? -1;
          return { tool, id: tool.id, score, actionType: tool.actionType };
        })
        .sort((left, right) => right.score - left.score);

      const expectedIndex = scored.findIndex(entry => entry.id === fixture.expected);
      const rank = expectedIndex === -1 ? tools.length : expectedIndex + 1;
      ranks.push(rank);
      reciprocalRankSum += 1 / rank;

      const top1Tool = scored[0];
      const top2Tool = scored[1];
      const correctToolEntry = scored[expectedIndex];

      if (rank === 1) {
        top1 += 1;
      }
      if (rank <= 3) {
        top3 += 1;
      }
      if (rank <= 5) {
        top5 += 1;
      }
      if (rank <= topK) {
        configured += 1;
      } else {
        correctToolAbsentFromTopK += 1;
      }

      // Action mismatch check
      if (top1Tool && isActionMismatch(fixture.actionType, top1Tool.actionType)) {
        actionMismatchTop1Count += 1;
      }

      // Catastrophic miss: expected tool absent from candidate set (rank > topK) AND semantically opposite tool dominates top-1 with high similarity >= 0.8
      if (
        rank > topK &&
        top1Tool &&
        isActionMismatch(fixture.actionType, top1Tool.actionType) &&
        top1Tool.score >= 0.8
      ) {
        catastrophicMissCount += 1;
      }

      const top1Score = top1Tool ? top1Tool.score : 0;
      const top2Score = top2Tool ? top2Tool.score : 0;
      const margin = top1Score - top2Score;

      // Dangerous near-neighbor margin
      const dangerousNeighbor = scored.find(
        entry => entry.id !== fixture.expected && isActionMismatch(fixture.actionType, entry.actionType),
      );
      const neighborMargin = (correctToolEntry?.score ?? 0) - (dangerousNeighbor?.score ?? 0);

      const marginRecord = {
        query: fixture.query,
        expected: fixture.expected,
        rank,
        correctSimilarity: correctToolEntry?.score ?? 0,
        top1Similarity: top1Score,
        top2Similarity: top2Score,
        top1Top2Margin: margin,
        dangerousNeighborMargin: neighborMargin,
      };

      if (rank === 1) {
        correctMargins.push(marginRecord);
      } else {
        incorrectMargins.push(marginRecord);
      }

      rankings.push({ fixture, scored, rank });
    } catch {
      errors += 1;
    }
  }

  const total = fixtures.length;
  const meanRank = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : 0;
  const medianRankVal = median(ranks);
  const worstRankVal = ranks.length > 0 ? Math.max(...ranks) : 0;
  const candidateReductionPercent =
    tools.length > 0 ? ((tools.length - Math.min(topK, tools.length)) / tools.length) * 100 : 0;

  // Threshold simulations
  const thresholdSimulations = thresholds.map(({ minTopSimilarity, minMargin }) => {
    let acceptedCount = 0;
    let acceptedTop1 = 0;
    let acceptedTopK = 0;
    let acceptedActionMismatch = 0;
    let acceptedMissingCorrect = 0;

    for (const item of rankings) {
      const top1Score = item.scored[0]?.score ?? 0;
      const top2Score = item.scored[1]?.score ?? 0;
      const margin = top1Score - top2Score;

      const accepted = top1Score >= minTopSimilarity && margin >= minMargin;
      if (accepted) {
        acceptedCount += 1;
        if (item.rank === 1) {
          acceptedTop1 += 1;
        }
        if (item.rank <= topK) {
          acceptedTopK += 1;
        } else {
          acceptedMissingCorrect += 1;
        }
        if (item.scored[0] && isActionMismatch(item.fixture.actionType, item.scored[0].actionType)) {
          acceptedActionMismatch += 1;
        }
      }
    }

    const acceptedRate = total > 0 ? acceptedCount / total : 0;
    return {
      minTopSimilarity,
      minMargin,
      acceptedRate,
      fallbackRate: 1 - acceptedRate,
      top1AccuracyAccepted: acceptedCount > 0 ? acceptedTop1 / acceptedCount : 0,
      topKRecallAccepted: acceptedCount > 0 ? acceptedTopK / acceptedCount : 0,
      actionMismatchTop1CountAccepted: acceptedActionMismatch,
      correctToolMissingAccepted: acceptedMissingCorrect,
    };
  });

  // TopK Sweep
  const topKSweep = topKSweepValues.map(kValue => {
    let recallCount = 0;
    let missingCount = 0;
    for (const item of rankings) {
      if (item.rank <= kValue) {
        recallCount += 1;
      } else {
        missingCount += 1;
      }
    }
    const recall = total > 0 ? recallCount / total : 0;
    const reduction = tools.length > 0 ? ((tools.length - Math.min(kValue, tools.length)) / tools.length) * 100 : 0;
    return {
      topK: kValue,
      recall,
      averageCandidateReductionPercent: reduction,
      worstCaseMissRate: total > 0 ? missingCount / total : 0,
    };
  });

  // Registry Size Variants
  const registrySizeVariants = [];
  for (const size of registrySizes) {
    if (size > tools.length) {
      continue;
    }
    const subsetTools = tools.slice(0, size);
    let subTop1 = 0;
    let subTopK = 0;
    for (const fixture of fixtures) {
      if (!subsetTools.some(t => t.id === fixture.expected)) {
        continue;
      } // skip if expected tool not in subset
      const matchingRank = rankings.find(r => r.fixture.query === fixture.query);
      if (!matchingRank) {
        continue;
      }
      const filteredScored = matchingRank.scored.filter(s => subsetTools.some(t => t.id === s.id));
      const subRank = filteredScored.findIndex(s => s.id === fixture.expected) + 1;
      if (subRank === 1) {
        subTop1 += 1;
      }
      if (subRank <= Math.min(topK, size)) {
        subTopK += 1;
      }
    }
    const subTotal = fixtures.filter(f => subsetTools.some(t => t.id === f.expected)).length;
    registrySizeVariants.push({
      registrySize: size,
      evalCount: subTotal,
      top1Accuracy: subTotal > 0 ? subTop1 / subTotal : 0,
      configuredTopKRecall: subTotal > 0 ? subTopK / subTotal : 0,
      candidateReductionPercent: size > 0 ? ((size - Math.min(topK, size)) / size) * 100 : 0,
    });
  }

  // Provisional Success Criteria Evaluation
  const topKRecallPassed = configured / total >= 0.99;
  const zeroCatastrophicMissesPassed = catastrophicMissCount === 0;
  const candidateReductionPassed = candidateReductionPercent >= 70;

  return {
    top1Accuracy: total > 0 ? top1 / total : 0,
    top3Recall: total > 0 ? top3 / total : 0,
    top5Recall: total > 0 ? top5 / total : 0,
    configuredTopKRecall: total > 0 ? configured / total : 0,
    mrr: total > 0 ? reciprocalRankSum / total : 0,
    meanCorrectRank: meanRank,
    medianCorrectRank: medianRankVal,
    worstCorrectRank: worstRankVal,
    embeddingErrors: errors,
    latencyMs: performance.now() - startedAt,
    queryLatencyP50: percentile(queryLatencies, 50),
    queryLatencyP95: percentile(queryLatencies, 95),
    toolEmbeddingBuildTimeMs,
    actionMismatchTop1Count,
    correctToolAbsentFromTopK,
    candidateReductionPercent,
    catastrophicMissCount,
    margins: {
      correctPredictions: correctMargins,
      incorrectPredictions: incorrectMargins,
    },
    thresholdSimulations,
    topKSweep,
    registrySizeVariants,
    provisionalSuccessCriteria: {
      passed: topKRecallPassed && zeroCatastrophicMissesPassed && candidateReductionPassed,
      details: {
        topKRecallPassed,
        zeroCatastrophicMissesPassed,
        candidateReductionPassed,
      },
    },
  };
}

export const retrievalFixtures = BENCHMARK_QUERIES;
export const retrievalTools = ALL_TOOLS;
