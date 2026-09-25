import type { FastPathClassificationReplayEntry, RequestClassifier } from '../../../src/core';
import {
  FAST_PATH_ADMISSION_EVAL_CASES,
  createFastPathEvaluationArtifact,
  evaluateFastPathAdmission,
  simulateFastPathAdmissionThresholds,
} from '../../../src/core';

function confidenceFor(caseId: string): number {
  const confidenceById = new Map([
    ['eligible-git-status', 0.99],
    ['eligible-list-files', 0.98],
    ['eligible-read-package', 0.97],
    ['eligible-current-branch', 0.96],
    ['eligible-repo-metadata', 0.95],
    ['info-deploy', 0.98],
  ]);
  return confidenceById.get(caseId) ?? 0.99;
}

function replayEntries(): FastPathClassificationReplayEntry[] {
  return FAST_PATH_ADMISSION_EVAL_CASES.map(testCase => ({
    caseId: testCase.id,
    classification: { ...testCase.expectedClassification, confidence: confidenceFor(testCase.id) },
  }));
}

describe('fast-path admission evaluation', () => {
  test('evaluates the built-in corpus through the production admission policy', async () => {
    const result = await evaluateFastPathAdmission({
      cases: FAST_PATH_ADMISSION_EVAL_CASES,
      classifier: undefined,
      replay: replayEntries(),
      minClassificationConfidence: 0.95,
    });

    expect(result.summary).toMatchObject({
      total: 36,
      eligible: 6,
      ineligible: 30,
      eligibleRate: 1 / 6,
      unsafeEligibleCount: 0,
      unsafeEligibleCaseIds: [],
      falseEligibleCount: 0,
      falseIneligibleCount: 0,
    });
    expect(result.summary.reasonCounts).toMatchObject({
      eligible: 6,
      tool_not_eligible: 7,
      approval_required: 2,
      arguments_invalid: 1,
      policy_veto: 1,
    });
    expect(
      result.cases
        .filter(testCase =>
          ['write', 'destructive', 'external_side_effect'].includes(testCase.expectedClassification.actionClass),
        )
        .every(testCase => !testCase.admission.eligible),
    ).toBe(true);
  });

  test('supports a deterministic or consumer-supplied classifier without AgentThread', async () => {
    const classifications = new Map(
      FAST_PATH_ADMISSION_EVAL_CASES.map(testCase => [
        testCase.request,
        { ...testCase.expectedClassification, confidence: confidenceFor(testCase.id) },
      ]),
    );
    const classifier: RequestClassifier = {
      classify: input => {
        const classification = classifications.get(input.query);
        return classification ? Promise.resolve(classification) : Promise.reject(new Error('missing'));
      },
    };

    const result = await evaluateFastPathAdmission({
      cases: FAST_PATH_ADMISSION_EVAL_CASES,
      classifier,
      replay: [],
      minClassificationConfidence: 0.95,
    });

    expect(result.summary.eligible).toBe(6);
    expect(result.summary.unsafeEligibleCount).toBe(0);
  });

  test('fails closed when classification is missing or the classifier errors', async () => {
    const testCase = FAST_PATH_ADMISSION_EVAL_CASES[0];
    expect(testCase).toBeDefined();
    if (!testCase) {
      return;
    }
    const missing = await evaluateFastPathAdmission({ cases: [testCase], classifier: undefined, replay: [] });
    const failed = await evaluateFastPathAdmission({
      cases: [testCase],
      classifier: { classify: () => Promise.reject(new Error('offline')) },
      replay: [],
    });

    expect(missing.cases[0]?.admission).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(['classification_missing']),
    });
    expect(failed.cases[0]?.admission).toEqual(missing.cases[0]?.admission);
  });

  test('simulates thresholds without mutating production defaults', async () => {
    const results = await simulateFastPathAdmissionThresholds({
      cases: FAST_PATH_ADMISSION_EVAL_CASES,
      replay: replayEntries(),
      thresholds: [0.8, 0.85, 0.9, 0.95, 0.97, 0.99],
    });

    expect(results.map(result => result.trueEligibleCount)).toEqual([6, 6, 6, 6, 4, 1]);
    expect(results.map(result => result.unsafeEligibleCount)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(results.map(result => result.eligibleRate)).toEqual([1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 9, 1 / 36]);
    expect(
      results.every((result, index) => {
        const previous = results[index - 1];
        return previous === undefined || result.eligibleRate <= previous.eligibleRate;
      }),
    ).toBe(true);
  });

  test('creates a JSON-safe live-provider artifact without credentials', async () => {
    const evaluation = await evaluateFastPathAdmission({
      cases: FAST_PATH_ADMISSION_EVAL_CASES,
      classifier: undefined,
      replay: replayEntries(),
    });
    const thresholdSimulation = await simulateFastPathAdmissionThresholds({
      cases: FAST_PATH_ADMISSION_EVAL_CASES,
      replay: replayEntries(),
      thresholds: [0.95],
    });
    const artifact = createFastPathEvaluationArtifact({
      classifier: 'needle-example-v1',
      timestamp: '2026-09-25T00:00:00.000Z',
      evaluation,
      thresholdSimulation,
    });

    expect(JSON.parse(JSON.stringify(artifact))).toEqual(artifact);
    expect(JSON.stringify(artifact)).not.toContain('credential');
    expect(artifact.cases.every(testCase => testCase.request === undefined)).toBe(true);
  });
});
