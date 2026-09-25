import type { FastPathAdmissionInput, RequestActionClass, RequestComplexity } from '../../../src/core';
import { ConservativeFastPathAdmissionPolicy } from '../../../src/core';

const TOOL = { serverId: 'git', toolName: 'git_status' };

function input(overrides: Partial<FastPathAdmissionInput> = {}): FastPathAdmissionInput {
  return {
    classification: { complexity: 'simple', actionClass: 'read', confidence: 0.98 },
    selectedToolCount: 1,
    tool: TOOL,
    toolExplicitlyEligible: true,
    argumentsValidated: true,
    approvalRequired: false,
    policyVeto: false,
    ...overrides,
  };
}

describe('ConservativeFastPathAdmissionPolicy', () => {
  const policy = new ConservativeFastPathAdmissionPolicy({
    eligibleTools: [TOOL],
    minClassificationConfidence: 0.95,
  });

  test('admits only a fully eligible simple read', () => {
    expect(policy.isToolExplicitlyEligible(TOOL)).toBe(true);
    expect(policy.evaluate(input())).toEqual({ eligible: true, reasons: ['eligible'] });
  });

  test('does not treat classification or a read-like tool name as authorization', () => {
    expect(policy.isToolExplicitlyEligible({ serverId: 'git', toolName: 'get_status' })).toBe(false);
    expect(policy.evaluate(input({ toolExplicitlyEligible: false }))).toEqual({
      eligible: false,
      reasons: ['tool_not_eligible'],
    });
  });

  test('reports every independent failed runtime gate', () => {
    expect(
      policy.evaluate(
        input({
          classification: undefined,
          selectedToolCount: 2,
          tool: undefined,
          toolExplicitlyEligible: undefined,
          argumentsValidated: false,
          approvalRequired: true,
          policyVeto: true,
        }),
      ),
    ).toEqual({
      eligible: false,
      reasons: [
        'classification_missing',
        'multiple_tools',
        'tool_not_eligible',
        'arguments_invalid',
        'approval_required',
        'policy_veto',
        'unknown',
      ],
    });
  });

  test.each<RequestActionClass>(['write', 'destructive', 'external_side_effect', 'unknown'])(
    'rejects the %s action class even for an explicitly eligible tool',
    actionClass => {
      const result = policy.evaluate(
        input({ classification: { complexity: 'simple', actionClass, confidence: 0.99 } }),
      );
      expect(result).toMatchObject({ eligible: false });
      expect(result.reasons).toContain('action_not_read');
    },
  );

  test.each<RequestComplexity>(['reasoning', 'unknown'])('rejects %s complexity', complexity => {
    const result = policy.evaluate(input({ classification: { complexity, actionClass: 'read', confidence: 0.99 } }));
    expect(result).toMatchObject({ eligible: false });
    expect(result.reasons).toContain('complexity_not_simple');
  });

  test.each([0, 0.94, Number.NaN, Number.POSITIVE_INFINITY])('rejects low or invalid confidence %s', confidence => {
    const result = policy.evaluate(
      input({ classification: { complexity: 'simple', actionClass: 'read', confidence } }),
    );
    expect(result).toMatchObject({ eligible: false });
    expect(result.reasons).toContain('classification_low_confidence');
  });

  test.each([
    ['invalid arguments', { argumentsValidated: false }, 'arguments_invalid'],
    ['required approval', { approvalRequired: true }, 'approval_required'],
    ['policy veto', { policyVeto: true }, 'policy_veto'],
    ['multiple tools', { selectedToolCount: 2 }, 'multiple_tools'],
  ] satisfies [string, Partial<FastPathAdmissionInput>, string][])('%s blocks admission', (_name, override, reason) => {
    const result = policy.evaluate(input(override));
    expect(result).toMatchObject({ eligible: false });
    expect(result.reasons).toContain(reason);
  });
});
