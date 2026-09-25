import type { RequestClassifier } from '../../../src/core';
import { runNeedleLiveEvaluation } from '../../../src/core';

describe('Needle live evaluation machinery', () => {
  test('records repetition instability, safety failures, provider errors, and threshold replay', async () => {
    const calls = new Map<string, number>();
    const classifier: RequestClassifier = {
      classify: input => {
        const count = calls.get(input.query) ?? 0;
        calls.set(input.query, count + 1);
        if (input.query === 'Compare these two implementations.') {
          return Promise.reject(new Error('provider unavailable'));
        }
        if (input.query === 'Update package.json.' && count % 2 === 1) {
          return Promise.resolve({ complexity: 'simple', actionClass: 'read', confidence: 0.99 });
        }
        return Promise.resolve({
          complexity: input.query.includes('Investigate') ? 'reasoning' : 'simple',
          actionClass: input.query.includes('Update package.json') ? 'write' : 'read',
          confidence: 0.98,
        });
      },
    };

    const result = await runNeedleLiveEvaluation({ classifier, runs: 2, thresholds: [0.95, 0.99] });

    expect(result.classificationRuns).toHaveLength(2);
    expect(result.admissionRuns).toHaveLength(2);
    expect(result.stability.some(entry => entry.unstable)).toBe(true);
    expect(result.unsafeReadMisclassificationCount).toBeGreaterThan(0);
    expect(result.unsafeEligibleCount).toBeGreaterThan(0);
    expect(result.providerFailureCount).toBeGreaterThan(0);
    expect(result.thresholdSimulation).toHaveLength(2);
    expect(result.thresholdSimulation[1]?.eligibleRate).toBeLessThanOrEqual(
      result.thresholdSimulation[0]?.eligibleRate ?? 0,
    );
    expect(result.highConfidenceErrorCaseIds99).toContain('write-package');
    expect(JSON.stringify(result)).not.toContain('provider unavailable');
  });
});
