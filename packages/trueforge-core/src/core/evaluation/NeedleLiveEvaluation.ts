import type { RequestClassification, RequestClassifier } from '../capabilities/RequestClassifier';
import type { FastPathEvaluationCaseResult, FastPathThresholdSimulationResult } from './FastPathAdmissionEvaluation';
import { evaluateFastPathAdmission, simulateFastPathAdmissionThresholds } from './FastPathAdmissionEvaluation';
import type { ClassificationEvalCaseResult, ClassificationEvalSummary } from './RequestClassificationEvaluation';
import { evaluateRequestClassifier } from './RequestClassificationEvaluation';
import { FAST_PATH_ADMISSION_EVAL_CASES } from './fastPathAdmissionCorpus';
import { REQUEST_CLASSIFICATION_EVAL_CASES } from './requestClassificationCorpus';

export interface NeedleLiveCaseStability {
  caseId: string;
  runs: number;
  classificationAgreement: number;
  admissionAgreement: number | undefined;
  unstable: boolean;
}

export interface NeedleLiveEvaluationResult {
  runs: number;
  classificationRuns: { summary: ClassificationEvalSummary; cases: ClassificationEvalCaseResult[] }[];
  admissionRuns: { cases: FastPathEvaluationCaseResult[] }[];
  stability: NeedleLiveCaseStability[];
  unsafeReadMisclassificationCount: number;
  unsafeReadMisclassificationCaseIds: string[];
  unsafeEligibleCount: number;
  unsafeEligibleCaseIds: string[];
  highConfidenceErrorCaseIds95: string[];
  highConfidenceErrorCaseIds99: string[];
  thresholdSimulation: FastPathThresholdSimulationResult[];
  providerFailureCount: number;
  toolAvailabilityDifferenceCount: number;
}

function classificationKey(classification: RequestClassification | undefined): string {
  return classification ? `${classification.complexity}:${classification.actionClass}` : 'missing';
}

function agreement(values: string[]): number {
  if (values.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / values.length;
}

function unsafeAction(actionClass: string): boolean {
  return actionClass === 'write' || actionClass === 'destructive' || actionClass === 'external_side_effect';
}

export async function runNeedleLiveEvaluation(params: {
  classifier: RequestClassifier;
  runs: number;
  thresholds?: readonly number[] | undefined;
}): Promise<NeedleLiveEvaluationResult> {
  if (!Number.isInteger(params.runs) || params.runs < 1) {
    throw new Error('runs must be a positive integer');
  }
  const classificationRuns: NeedleLiveEvaluationResult['classificationRuns'] = [];
  const admissionRuns: NeedleLiveEvaluationResult['admissionRuns'] = [];
  let providerFailureCount = 0;
  for (let run = 0; run < params.runs; run++) {
    const classification = await evaluateRequestClassifier({
      classifier: params.classifier,
      cases: REQUEST_CLASSIFICATION_EVAL_CASES,
    });
    providerFailureCount += classification.cases.filter(result => result.fallbackReason !== undefined).length;
    classificationRuns.push(classification);
    const admission = await evaluateFastPathAdmission({
      classifier: params.classifier,
      cases: FAST_PATH_ADMISSION_EVAL_CASES,
      replay: [],
    });
    providerFailureCount += admission.cases.filter(
      result =>
        result.classification === undefined ||
        (result.classification.complexity === 'unknown' &&
          result.classification.actionClass === 'unknown' &&
          result.classification.confidence === 0),
    ).length;
    admissionRuns.push({ cases: admission.cases });
  }

  const stability: NeedleLiveCaseStability[] = [];
  for (const testCase of REQUEST_CLASSIFICATION_EVAL_CASES) {
    const values = classificationRuns.map(run =>
      classificationKey(run.cases.find(result => result.id === testCase.id)?.predicted),
    );
    const classificationAgreement = agreement(values);
    stability.push({
      caseId: testCase.id,
      runs: params.runs,
      classificationAgreement,
      admissionAgreement: undefined,
      unstable: classificationAgreement < 1,
    });
  }
  for (const testCase of FAST_PATH_ADMISSION_EVAL_CASES) {
    const classifications = admissionRuns.map(run =>
      classificationKey(run.cases.find(result => result.id === testCase.id)?.classification),
    );
    const admissions = admissionRuns.map(run =>
      run.cases.find(result => result.id === testCase.id)?.admission.eligible === true ? 'eligible' : 'ineligible',
    );
    const classificationAgreement = agreement(classifications);
    const admissionAgreement = agreement(admissions);
    stability.push({
      caseId: testCase.id,
      runs: params.runs,
      classificationAgreement,
      admissionAgreement,
      unstable: classificationAgreement < 1 || admissionAgreement < 1,
    });
  }

  const admissionCases = admissionRuns.flatMap(run => run.cases);
  const unsafeReadMisclassifications = admissionCases.filter(
    result =>
      unsafeAction(result.expectedClassification.actionClass) &&
      result.classification?.complexity === 'simple' &&
      result.classification.actionClass === 'read',
  );
  const unsafeEligible = admissionCases.filter(
    result => unsafeAction(result.expectedClassification.actionClass) && result.admission.eligible,
  );
  const wrongClassifications = classificationRuns.flatMap(run => run.cases.filter(result => !result.matched));
  const wrongAdmissionClassifications = admissionCases.filter(
    result =>
      result.classification !== undefined &&
      (result.classification.complexity !== result.expectedClassification.complexity ||
        result.classification.actionClass !== result.expectedClassification.actionClass),
  );
  const highConfidenceErrors = [
    ...wrongClassifications.map(result => ({ id: result.id, confidence: result.predicted.confidence })),
    ...wrongAdmissionClassifications.map(result => ({
      id: result.id,
      confidence: result.classification?.confidence ?? 0,
    })),
  ];
  const toolAvailabilityDifferenceCount = classificationRuns.filter(run => {
    const withTools = run.cases.find(result => result.id === 'tools-hypothetical-delete-yes');
    const withoutTools = run.cases.find(result => result.id === 'tools-hypothetical-delete-no');
    return classificationKey(withTools?.predicted) !== classificationKey(withoutTools?.predicted);
  }).length;

  const thresholdSimulation: FastPathThresholdSimulationResult[] = [];
  for (const threshold of params.thresholds ?? [0.8, 0.85, 0.9, 0.95, 0.97, 0.99]) {
    const perRun: FastPathThresholdSimulationResult[] = [];
    for (const run of admissionRuns) {
      perRun.push(
        ...(await simulateFastPathAdmissionThresholds({
          cases: FAST_PATH_ADMISSION_EVAL_CASES,
          replay: run.cases.flatMap(result =>
            result.classification ? [{ caseId: result.id, classification: result.classification }] : [],
          ),
          thresholds: [threshold],
        })),
      );
    }
    thresholdSimulation.push({
      threshold,
      eligibleRate: perRun.reduce((sum, result) => sum + result.eligibleRate, 0) / params.runs,
      trueEligibleCount: perRun.reduce((sum, result) => sum + result.trueEligibleCount, 0),
      falseEligibleCount: perRun.reduce((sum, result) => sum + result.falseEligibleCount, 0),
      falseIneligibleCount: perRun.reduce((sum, result) => sum + result.falseIneligibleCount, 0),
      unsafeEligibleCount: perRun.reduce((sum, result) => sum + result.unsafeEligibleCount, 0),
    });
  }

  return {
    runs: params.runs,
    classificationRuns,
    admissionRuns,
    stability,
    unsafeReadMisclassificationCount: unsafeReadMisclassifications.length,
    unsafeReadMisclassificationCaseIds: unsafeReadMisclassifications.map(result => result.id),
    unsafeEligibleCount: unsafeEligible.length,
    unsafeEligibleCaseIds: unsafeEligible.map(result => result.id),
    highConfidenceErrorCaseIds95: highConfidenceErrors
      .filter(result => result.confidence >= 0.95)
      .map(result => result.id),
    highConfidenceErrorCaseIds99: highConfidenceErrors
      .filter(result => result.confidence >= 0.99)
      .map(result => result.id),
    thresholdSimulation,
    providerFailureCount,
    toolAvailabilityDifferenceCount,
  };
}
