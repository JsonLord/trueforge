import type { AgentCapability } from './AgentCapability';
import type { RequestClassification } from './RequestClassifier';

export type FastPathAdmissionReason =
  | 'eligible'
  | 'classification_missing'
  | 'complexity_not_simple'
  | 'action_not_read'
  | 'classification_low_confidence'
  | 'tool_not_eligible'
  | 'multiple_tools'
  | 'arguments_invalid'
  | 'approval_required'
  | 'policy_veto'
  | 'unknown';

export interface FastPathToolIdentity {
  serverId: string;
  toolName: string;
}

export interface FastPathAdmissionInput {
  classification: RequestClassification | undefined;
  selectedToolCount: number;
  tool: FastPathToolIdentity | undefined;
  toolExplicitlyEligible: boolean | undefined;
  argumentsValidated: boolean | undefined;
  approvalRequired: boolean | undefined;
  policyVeto: boolean | undefined;
}

export interface FastPathAdmissionResult {
  eligible: boolean;
  reasons: FastPathAdmissionReason[];
}

export interface FastPathAdmissionMetadata extends FastPathAdmissionResult {
  evaluated: true;
}

export interface FastPathAdmissionPolicy {
  evaluate(input: FastPathAdmissionInput): FastPathAdmissionResult;
  isToolExplicitlyEligible(tool: FastPathToolIdentity): boolean;
}

export interface ShadowFastPathAdmissionOptions {
  shadowEnabled?: boolean | undefined;
  minClassificationConfidence?: number | undefined;
  eligibleTools?: readonly FastPathToolIdentity[] | undefined;
}

export const DEFAULT_FAST_PATH_MIN_CLASSIFICATION_CONFIDENCE = 0.95;

function toolKey(tool: FastPathToolIdentity): string {
  return JSON.stringify([tool.serverId, tool.toolName]);
}

export class ConservativeFastPathAdmissionPolicy implements FastPathAdmissionPolicy {
  private readonly minClassificationConfidence: number;
  private readonly eligibleToolKeys: ReadonlySet<string>;

  constructor(options: ShadowFastPathAdmissionOptions) {
    const configuredConfidence = options.minClassificationConfidence;
    this.minClassificationConfidence =
      configuredConfidence !== undefined &&
      Number.isFinite(configuredConfidence) &&
      configuredConfidence >= 0 &&
      configuredConfidence <= 1
        ? configuredConfidence
        : DEFAULT_FAST_PATH_MIN_CLASSIFICATION_CONFIDENCE;
    this.eligibleToolKeys = new Set((options.eligibleTools ?? []).map(toolKey));
  }

  isToolExplicitlyEligible(tool: FastPathToolIdentity): boolean {
    return this.eligibleToolKeys.has(toolKey(tool));
  }

  evaluate(input: FastPathAdmissionInput): FastPathAdmissionResult {
    const reasons: FastPathAdmissionReason[] = [];
    if (!input.classification) {
      reasons.push('classification_missing');
    } else {
      if (input.classification.complexity !== 'simple') {
        reasons.push('complexity_not_simple');
      }
      if (input.classification.actionClass !== 'read') {
        reasons.push('action_not_read');
      }
      if (
        !Number.isFinite(input.classification.confidence) ||
        input.classification.confidence < 0 ||
        input.classification.confidence > 1 ||
        input.classification.confidence < this.minClassificationConfidence
      ) {
        reasons.push('classification_low_confidence');
      }
    }
    if (input.selectedToolCount !== 1) {
      reasons.push('multiple_tools');
    }
    if (input.toolExplicitlyEligible !== true) {
      reasons.push('tool_not_eligible');
    }
    if (input.argumentsValidated === false) {
      reasons.push('arguments_invalid');
    } else if (input.argumentsValidated === undefined) {
      reasons.push('unknown');
    }
    if (input.approvalRequired === true) {
      reasons.push('approval_required');
    } else if (input.approvalRequired === undefined) {
      reasons.push('unknown');
    }
    if (input.policyVeto === true) {
      reasons.push('policy_veto');
    } else if (input.policyVeto === undefined) {
      reasons.push('unknown');
    }
    if (!input.tool) {
      reasons.push('unknown');
    }

    const uniqueReasons = [...new Set(reasons)];
    return uniqueReasons.length === 0
      ? { eligible: true, reasons: ['eligible'] }
      : { eligible: false, reasons: uniqueReasons };
  }
}

export function shadowFastPathAdmission(options: ShadowFastPathAdmissionOptions): AgentCapability {
  return options.shadowEnabled === true
    ? { fastPathAdmissionPolicy: new ConservativeFastPathAdmissionPolicy(options) }
    : {};
}
