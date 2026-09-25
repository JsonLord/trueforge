import {
  ConservativeFastPathAdmissionPolicy,
  type FastPathAdmissionPolicy,
  type FastPathAdmissionReason,
  type FastPathAdmissionResult,
  type FastPathToolIdentity,
} from '../capabilities/FastPathAdmission';
import type {
  RequestActionClass,
  RequestClassification,
  RequestClassifier,
  RequestComplexity,
} from '../capabilities/RequestClassifier';

export interface FastPathEvalCase {
  id: string;
  request: string;
  toolsAvailable: boolean;
  expectedClassification: { complexity: RequestComplexity; actionClass: RequestActionClass };
  runtime: {
    selectedTools: FastPathToolIdentity[];
    argumentsValidated: boolean;
    approvalRequired: boolean;
    policyVeto: boolean;
  };
  eligibleTools: FastPathToolIdentity[];
  expectedEligible: boolean;
  tags: string[];
}

export interface FastPathClassificationReplayEntry {
  caseId: string;
  classification: RequestClassification;
}

export interface FastPathEvaluationCaseResult {
  id: string;
  request: string | undefined;
  expectedClassification: FastPathEvalCase['expectedClassification'];
  classification: RequestClassification | undefined;
  expectedEligible: boolean;
  admission: FastPathAdmissionResult;
  matched: boolean;
  tags: string[];
}

export interface FastPathEvaluationSummary {
  total: number;
  eligible: number;
  ineligible: number;
  eligibleRate: number;
  unsafeEligibleCount: number;
  unsafeEligibleCaseIds: string[];
  falseEligibleCount: number;
  falseIneligibleCount: number;
  reasonCounts: Record<FastPathAdmissionReason, number>;
}

export interface FastPathEvaluationResult {
  cases: FastPathEvaluationCaseResult[];
  summary: FastPathEvaluationSummary;
}

export interface FastPathThresholdSimulationResult {
  threshold: number;
  eligibleRate: number;
  trueEligibleCount: number;
  falseEligibleCount: number;
  falseIneligibleCount: number;
  unsafeEligibleCount: number;
}

export interface FastPathEvaluationArtifact {
  classifier: string;
  timestamp: string;
  summary: FastPathEvaluationSummary;
  thresholdSimulation: FastPathThresholdSimulationResult[];
  cases: FastPathEvaluationCaseResult[];
}

function emptyReasonCounts(): Record<FastPathAdmissionReason, number> {
  return {
    eligible: 0,
    classification_missing: 0,
    complexity_not_simple: 0,
    action_not_read: 0,
    classification_low_confidence: 0,
    tool_not_eligible: 0,
    multiple_tools: 0,
    arguments_invalid: 0,
    approval_required: 0,
    policy_veto: 0,
    unknown: 0,
  };
}

function isUnsafeAction(actionClass: RequestActionClass): boolean {
  return actionClass === 'write' || actionClass === 'destructive' || actionClass === 'external_side_effect';
}

function admissionInput(params: {
  testCase: FastPathEvalCase;
  classification: RequestClassification | undefined;
  policy: FastPathAdmissionPolicy;
}) {
  const tool =
    params.testCase.runtime.selectedTools.length === 1 ? params.testCase.runtime.selectedTools[0] : undefined;
  return {
    classification: params.classification,
    selectedToolCount: params.testCase.runtime.selectedTools.length,
    tool,
    toolExplicitlyEligible: tool ? params.policy.isToolExplicitlyEligible(tool) : undefined,
    argumentsValidated: params.testCase.runtime.argumentsValidated,
    approvalRequired: params.testCase.runtime.approvalRequired,
    policyVeto: params.testCase.runtime.policyVeto,
  };
}

function summarize(cases: FastPathEvaluationCaseResult[]): FastPathEvaluationSummary {
  const reasonCounts = emptyReasonCounts();
  const unsafeEligibleCaseIds: string[] = [];
  for (const result of cases) {
    for (const reason of result.admission.reasons) {
      reasonCounts[reason]++;
    }
    if (result.admission.eligible && isUnsafeAction(result.expectedClassification.actionClass)) {
      unsafeEligibleCaseIds.push(result.id);
    }
  }
  const eligible = cases.filter(result => result.admission.eligible).length;
  return {
    total: cases.length,
    eligible,
    ineligible: cases.length - eligible,
    eligibleRate: cases.length === 0 ? 0 : eligible / cases.length,
    unsafeEligibleCount: unsafeEligibleCaseIds.length,
    unsafeEligibleCaseIds,
    falseEligibleCount: cases.filter(result => result.admission.eligible && !result.expectedEligible).length,
    falseIneligibleCount: cases.filter(result => !result.admission.eligible && result.expectedEligible).length,
    reasonCounts,
  };
}

export async function evaluateFastPathAdmission(params: {
  cases: readonly FastPathEvalCase[];
  classifier: RequestClassifier | undefined;
  replay: readonly FastPathClassificationReplayEntry[];
  minClassificationConfidence?: number | undefined;
}): Promise<FastPathEvaluationResult> {
  const replayById = new Map(params.replay.map(entry => [entry.caseId, entry.classification]));
  const results: FastPathEvaluationCaseResult[] = [];
  for (const testCase of params.cases) {
    let classification = replayById.get(testCase.id);
    if (!classification && params.classifier) {
      try {
        classification = await params.classifier.classify({
          query: testCase.request,
          toolsAvailable: testCase.toolsAvailable,
        });
      } catch {
        classification = undefined;
      }
    }
    const policy = new ConservativeFastPathAdmissionPolicy({
      eligibleTools: testCase.eligibleTools,
      minClassificationConfidence: params.minClassificationConfidence,
    });
    const admission = policy.evaluate(admissionInput({ testCase, classification, policy }));
    results.push({
      id: testCase.id,
      request: testCase.request,
      expectedClassification: testCase.expectedClassification,
      classification,
      expectedEligible: testCase.expectedEligible,
      admission,
      matched: admission.eligible === testCase.expectedEligible,
      tags: [...testCase.tags],
    });
  }
  return { cases: results, summary: summarize(results) };
}

export async function simulateFastPathAdmissionThresholds(params: {
  cases: readonly FastPathEvalCase[];
  replay: readonly FastPathClassificationReplayEntry[];
  thresholds: readonly number[];
}): Promise<FastPathThresholdSimulationResult[]> {
  const results: FastPathThresholdSimulationResult[] = [];
  for (const threshold of params.thresholds) {
    const evaluation = await evaluateFastPathAdmission({
      cases: params.cases,
      classifier: undefined,
      replay: params.replay,
      minClassificationConfidence: threshold,
    });
    results.push({
      threshold,
      eligibleRate: evaluation.summary.eligibleRate,
      trueEligibleCount: evaluation.cases.filter(result => result.admission.eligible && result.expectedEligible).length,
      falseEligibleCount: evaluation.summary.falseEligibleCount,
      falseIneligibleCount: evaluation.summary.falseIneligibleCount,
      unsafeEligibleCount: evaluation.summary.unsafeEligibleCount,
    });
  }
  return results;
}

export function createFastPathEvaluationArtifact(params: {
  classifier: string;
  timestamp: string;
  evaluation: FastPathEvaluationResult;
  thresholdSimulation: FastPathThresholdSimulationResult[];
  includeRequests?: boolean | undefined;
}): FastPathEvaluationArtifact {
  return {
    classifier: params.classifier,
    timestamp: params.timestamp,
    summary: params.evaluation.summary,
    thresholdSimulation: params.thresholdSimulation,
    cases: params.evaluation.cases.map(result => ({
      ...result,
      request: params.includeRequests === true ? result.request : undefined,
    })),
  };
}
