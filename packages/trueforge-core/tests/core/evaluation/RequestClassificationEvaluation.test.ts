import type {
  ClassificationEvalCase,
  ClassificationReplayEntry,
  RequestClassification,
  RequestClassifier,
} from '../../../src/core';
import {
  REQUEST_CLASSIFICATION_EVAL_CASES,
  evaluateClassificationReplay,
  evaluateRequestClassifier,
} from '../../../src/core';

function evalCase(params: {
  id: string;
  request: string;
  complexity: ClassificationEvalCase['expected']['complexity'];
  actionClass: ClassificationEvalCase['expected']['actionClass'];
}): ClassificationEvalCase {
  return {
    id: params.id,
    request: params.request,
    toolsAvailable: true,
    expected: { complexity: params.complexity, actionClass: params.actionClass },
    tags: ['test'],
  };
}

function deterministicClock(latencies: number[]): () => number {
  let index = 0;
  let elapsed = 0;
  return () => {
    const callIndex = index++;
    if (callIndex % 2 === 0) {
      return elapsed;
    }
    elapsed += latencies[Math.floor(callIndex / 2)] ?? 0;
    return elapsed;
  };
}

describe('request classification evaluation', () => {
  const cases: ClassificationEvalCase[] = [
    evalCase({ id: 'correct-read', request: 'read', complexity: 'simple', actionClass: 'read' }),
    evalCase({ id: 'under-write', request: 'write', complexity: 'reasoning', actionClass: 'write' }),
    evalCase({ id: 'under-destructive', request: 'destroy', complexity: 'simple', actionClass: 'destructive' }),
    evalCase({ id: 'over-read', request: 'over', complexity: 'simple', actionClass: 'read' }),
    evalCase({ id: 'low-confidence', request: 'low', complexity: 'reasoning', actionClass: 'unknown' }),
    evalCase({ id: 'transport-error', request: 'error', complexity: 'simple', actionClass: 'read' }),
  ];

  test('calculates deterministic metrics, confusion matrices, fallbacks, and latency', async () => {
    const responses = new Map<string, RequestClassification>([
      ['read', { complexity: 'simple', actionClass: 'read', confidence: 0.95 }],
      ['write', { complexity: 'simple', actionClass: 'read', confidence: 0.9 }],
      ['destroy', { complexity: 'unknown', actionClass: 'unknown', confidence: 0 }],
      ['over', { complexity: 'simple', actionClass: 'destructive', confidence: 0.9 }],
      ['low', { complexity: 'unknown', actionClass: 'unknown', confidence: 0.4 }],
    ]);
    const classifier: RequestClassifier = {
      classify: input => {
        const response = responses.get(input.query);
        return response ? Promise.resolve(response) : Promise.reject(new Error('transport'));
      },
    };

    const result = await evaluateRequestClassifier({
      classifier,
      cases,
      now: deterministicClock([10, 20, 30, 40, 50, 60]),
    });

    expect(result.summary).toMatchObject({
      total: 6,
      exactMatchRate: 1 / 6,
      complexityAccuracy: 2 / 6,
      actionClassAccuracy: 2 / 6,
      unknownRate: 3 / 6,
      lowConfidenceRate: 1 / 6,
      classifierErrorRate: 1 / 6,
      fallbackRate: 3 / 6,
      unsafeUnderclassificationCount: 3,
      unsafeUnderclassificationCaseIds: ['under-write', 'under-destructive', 'transport-error'],
      overclassificationCount: 1,
      overclassificationCaseIds: ['over-read'],
      latency: { meanMs: 35, p50Ms: 30, p95Ms: 60, maxMs: 60 },
    });
    expect(result.summary.actionClassConfusionMatrix.write.read).toBe(1);
    expect(result.summary.actionClassConfusionMatrix.destructive.unknown).toBe(1);
    expect(result.summary.actionClassMetrics.read).toEqual({ precision: 0.5, recall: 1 / 3, support: 3 });
    expect(result.summary.complexityMetrics.reasoning).toEqual({ precision: 0, recall: 0, support: 2 });
    expect(result.cases.map(testCase => testCase.fallbackReason)).toEqual([
      undefined,
      undefined,
      'opaque_fallback',
      undefined,
      'low_confidence',
      'classifier_error',
    ]);
  });

  test('replays normalized results by case and tool availability without a provider', async () => {
    const replayCases = REQUEST_CLASSIFICATION_EVAL_CASES.filter(testCase => testCase.tags.includes('tools'));
    const entries: ClassificationReplayEntry[] = replayCases.map(testCase => ({
      caseId: testCase.id,
      result: { ...testCase.expected, confidence: 0.99 },
    }));

    const result = await evaluateClassificationReplay({ cases: replayCases, entries });

    expect(result.summary.exactMatchRate).toBe(1);
    expect(result.summary.classifierErrorRate).toBe(0);
    expect(result.cases).toHaveLength(2);
  });

  test('provides a representative corpus with explicit stable labels', () => {
    expect(REQUEST_CLASSIFICATION_EVAL_CASES).toHaveLength(42);
    expect(new Set(REQUEST_CLASSIFICATION_EVAL_CASES.map(testCase => testCase.id)).size).toBe(42);
    expect(REQUEST_CLASSIFICATION_EVAL_CASES.filter(testCase => testCase.tags.includes('adversarial'))).toHaveLength(6);
    expect(REQUEST_CLASSIFICATION_EVAL_CASES.filter(testCase => testCase.tags.includes('mixed'))).toHaveLength(5);

    const toolCases = REQUEST_CLASSIFICATION_EVAL_CASES.filter(testCase => testCase.tags.includes('tools'));
    expect(toolCases.map(testCase => testCase.toolsAvailable)).toEqual([true, false]);
    expect(toolCases[0]?.expected).toEqual(toolCases[1]?.expected);
  });
});
