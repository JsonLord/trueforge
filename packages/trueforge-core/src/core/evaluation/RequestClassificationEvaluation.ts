import type {
  RequestActionClass,
  RequestClassification,
  RequestClassifier,
  RequestComplexity,
} from '../capabilities/RequestClassifier';

export interface ClassificationEvalCase {
  id: string;
  request: string;
  toolsAvailable: boolean;
  expected: { complexity: RequestComplexity; actionClass: RequestActionClass };
  tags: string[];
}

export interface ClassificationReplayEntry {
  caseId: string;
  result: RequestClassification;
}

export type ClassificationEvalFallbackReason = 'classifier_error' | 'low_confidence' | 'opaque_fallback';

export interface ClassificationEvalCaseResult {
  id: string;
  expected: ClassificationEvalCase['expected'];
  predicted: RequestClassification;
  matched: boolean;
  complexityMatched: boolean;
  actionClassMatched: boolean;
  latencyMs: number;
  fallbackReason: ClassificationEvalFallbackReason | undefined;
  tags: string[];
  toolsAvailable: boolean;
}

export interface ClassificationClassMetrics {
  precision: number;
  recall: number;
  support: number;
}

export interface ClassificationLatencyMetrics {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface ClassificationEvalSummary {
  total: number;
  exactMatchRate: number;
  complexityAccuracy: number;
  actionClassAccuracy: number;
  unknownRate: number;
  lowConfidenceRate: number;
  classifierErrorRate: number;
  fallbackRate: number;
  complexityMetrics: Record<RequestComplexity, ClassificationClassMetrics>;
  actionClassMetrics: Record<RequestActionClass, ClassificationClassMetrics>;
  complexityConfusionMatrix: Record<RequestComplexity, Record<RequestComplexity, number>>;
  actionClassConfusionMatrix: Record<RequestActionClass, Record<RequestActionClass, number>>;
  unsafeUnderclassificationCount: number;
  unsafeUnderclassificationCaseIds: string[];
  overclassificationCount: number;
  overclassificationCaseIds: string[];
  latency: ClassificationLatencyMetrics;
}

export interface ClassificationEvalResult {
  cases: ClassificationEvalCaseResult[];
  summary: ClassificationEvalSummary;
}

const UNKNOWN_CLASSIFICATION: RequestClassification = {
  complexity: 'unknown',
  actionClass: 'unknown',
  confidence: 0,
};

const ACTION_SEVERITY: Record<RequestActionClass, number> = {
  unknown: 0,
  read: 1,
  write: 2,
  external_side_effect: 3,
  destructive: 4,
};

function rate(params: { numerator: number; denominator: number }): number {
  return params.denominator === 0 ? 0 : params.numerator / params.denominator;
}

function emptyComplexityConfusionMatrix(): Record<RequestComplexity, Record<RequestComplexity, number>> {
  return {
    simple: { simple: 0, reasoning: 0, unknown: 0 },
    reasoning: { simple: 0, reasoning: 0, unknown: 0 },
    unknown: { simple: 0, reasoning: 0, unknown: 0 },
  };
}

function emptyActionClassConfusionMatrix(): Record<RequestActionClass, Record<RequestActionClass, number>> {
  const row = (): Record<RequestActionClass, number> => ({
    read: 0,
    write: 0,
    destructive: 0,
    external_side_effect: 0,
    unknown: 0,
  });
  return {
    read: row(),
    write: row(),
    destructive: row(),
    external_side_effect: row(),
    unknown: row(),
  };
}

function metricsForClass<T extends string>(params: {
  label: T;
  expected: T[];
  predicted: T[];
}): ClassificationClassMetrics {
  let truePositive = 0;
  let predictedPositive = 0;
  let support = 0;
  for (let index = 0; index < params.expected.length; index++) {
    const expected = params.expected[index];
    const predicted = params.predicted[index];
    if (expected === params.label) {
      support++;
    }
    if (predicted === params.label) {
      predictedPositive++;
    }
    if (expected === params.label && predicted === params.label) {
      truePositive++;
    }
  }
  return {
    precision: rate({ numerator: truePositive, denominator: predictedPositive }),
    recall: rate({ numerator: truePositive, denominator: support }),
    support,
  };
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.ceil(sorted.length * fraction) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

function latencyMetrics(latencies: number[]): ClassificationLatencyMetrics {
  const sorted = [...latencies].sort((left, right) => left - right);
  return {
    meanMs: rate({ numerator: latencies.reduce((total, value) => total + value, 0), denominator: latencies.length }),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

function buildSummary(cases: ClassificationEvalCaseResult[]): ClassificationEvalSummary {
  const complexityConfusionMatrix = emptyComplexityConfusionMatrix();
  const actionClassConfusionMatrix = emptyActionClassConfusionMatrix();
  const unsafeUnderclassificationCaseIds: string[] = [];
  const overclassificationCaseIds: string[] = [];
  for (const result of cases) {
    complexityConfusionMatrix[result.expected.complexity][result.predicted.complexity]++;
    actionClassConfusionMatrix[result.expected.actionClass][result.predicted.actionClass]++;
    const expectedSeverity = ACTION_SEVERITY[result.expected.actionClass];
    const predictedSeverity = ACTION_SEVERITY[result.predicted.actionClass];
    if (expectedSeverity > predictedSeverity && result.expected.actionClass !== 'unknown') {
      unsafeUnderclassificationCaseIds.push(result.id);
    } else if (predictedSeverity > expectedSeverity && result.expected.actionClass !== 'unknown') {
      overclassificationCaseIds.push(result.id);
    }
  }
  const complexities = cases.map(result => result.expected.complexity);
  const predictedComplexities = cases.map(result => result.predicted.complexity);
  const actions = cases.map(result => result.expected.actionClass);
  const predictedActions = cases.map(result => result.predicted.actionClass);
  return {
    total: cases.length,
    exactMatchRate: rate({ numerator: cases.filter(result => result.matched).length, denominator: cases.length }),
    complexityAccuracy: rate({
      numerator: cases.filter(result => result.complexityMatched).length,
      denominator: cases.length,
    }),
    actionClassAccuracy: rate({
      numerator: cases.filter(result => result.actionClassMatched).length,
      denominator: cases.length,
    }),
    unknownRate: rate({
      numerator: cases.filter(
        result => result.predicted.complexity === 'unknown' || result.predicted.actionClass === 'unknown',
      ).length,
      denominator: cases.length,
    }),
    lowConfidenceRate: rate({
      numerator: cases.filter(result => result.fallbackReason === 'low_confidence').length,
      denominator: cases.length,
    }),
    classifierErrorRate: rate({
      numerator: cases.filter(result => result.fallbackReason === 'classifier_error').length,
      denominator: cases.length,
    }),
    fallbackRate: rate({
      numerator: cases.filter(result => result.fallbackReason !== undefined).length,
      denominator: cases.length,
    }),
    complexityMetrics: {
      simple: metricsForClass({ label: 'simple', expected: complexities, predicted: predictedComplexities }),
      reasoning: metricsForClass({ label: 'reasoning', expected: complexities, predicted: predictedComplexities }),
      unknown: metricsForClass({ label: 'unknown', expected: complexities, predicted: predictedComplexities }),
    },
    actionClassMetrics: {
      read: metricsForClass({ label: 'read', expected: actions, predicted: predictedActions }),
      write: metricsForClass({ label: 'write', expected: actions, predicted: predictedActions }),
      destructive: metricsForClass({ label: 'destructive', expected: actions, predicted: predictedActions }),
      external_side_effect: metricsForClass({
        label: 'external_side_effect',
        expected: actions,
        predicted: predictedActions,
      }),
      unknown: metricsForClass({ label: 'unknown', expected: actions, predicted: predictedActions }),
    },
    complexityConfusionMatrix,
    actionClassConfusionMatrix,
    unsafeUnderclassificationCount: unsafeUnderclassificationCaseIds.length,
    unsafeUnderclassificationCaseIds,
    overclassificationCount: overclassificationCaseIds.length,
    overclassificationCaseIds,
    latency: latencyMetrics(cases.map(result => result.latencyMs)),
  };
}

export async function evaluateRequestClassifier(params: {
  classifier: RequestClassifier;
  cases: readonly ClassificationEvalCase[];
  now?: (() => number) | undefined;
}): Promise<ClassificationEvalResult> {
  const now = params.now ?? Date.now;
  const results: ClassificationEvalCaseResult[] = [];
  for (const testCase of params.cases) {
    const startedAt = now();
    let predicted: RequestClassification;
    let fallbackReason: ClassificationEvalFallbackReason | undefined;
    try {
      predicted = await params.classifier.classify({
        query: testCase.request,
        toolsAvailable: testCase.toolsAvailable,
      });
      fallbackReason =
        predicted.complexity === 'unknown' && predicted.actionClass === 'unknown'
          ? predicted.confidence > 0
            ? 'low_confidence'
            : 'opaque_fallback'
          : undefined;
    } catch {
      predicted = UNKNOWN_CLASSIFICATION;
      fallbackReason = 'classifier_error';
    }
    const latencyMs = Math.max(0, now() - startedAt);
    const complexityMatched = predicted.complexity === testCase.expected.complexity;
    const actionClassMatched = predicted.actionClass === testCase.expected.actionClass;
    results.push({
      id: testCase.id,
      expected: testCase.expected,
      predicted,
      matched: complexityMatched && actionClassMatched,
      complexityMatched,
      actionClassMatched,
      latencyMs,
      fallbackReason,
      tags: [...testCase.tags],
      toolsAvailable: testCase.toolsAvailable,
    });
  }
  return { cases: results, summary: buildSummary(results) };
}

export function evaluateClassificationReplay(params: {
  cases: readonly ClassificationEvalCase[];
  entries: readonly ClassificationReplayEntry[];
  now?: (() => number) | undefined;
}): Promise<ClassificationEvalResult> {
  const resultsById = new Map(params.entries.map(entry => [entry.caseId, entry.result]));
  const caseIdsByInput = new Map(params.cases.map(testCase => [classificationInputKey(testCase), testCase.id]));
  const classifier: RequestClassifier = {
    classify: input => {
      const caseId = caseIdsByInput.get(
        classificationInputKey({ request: input.query, toolsAvailable: input.toolsAvailable }),
      );
      const result = caseId ? resultsById.get(caseId) : undefined;
      return result ? Promise.resolve({ ...result }) : Promise.reject(new Error('Missing replay for request'));
    },
  };
  return evaluateRequestClassifier({ classifier, cases: params.cases, now: params.now });
}

function classificationInputKey(input: { request: string; toolsAvailable: boolean }): string {
  return JSON.stringify([input.request, input.toolsAvailable]);
}
