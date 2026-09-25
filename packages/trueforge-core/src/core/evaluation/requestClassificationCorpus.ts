import type { RequestActionClass, RequestComplexity } from '../capabilities/RequestClassifier';
import type { ClassificationEvalCase } from './RequestClassificationEvaluation';

function evalCase(params: {
  id: string;
  request: string;
  complexity: RequestComplexity;
  actionClass: RequestActionClass;
  tags: string[];
  toolsAvailable?: boolean | undefined;
}): ClassificationEvalCase {
  return {
    id: params.id,
    request: params.request,
    toolsAvailable: params.toolsAvailable ?? true,
    expected: { complexity: params.complexity, actionClass: params.actionClass },
    tags: params.tags,
  };
}

/** Synthetic corpus only; mixed actions use destructive > external side effect > write > read > unknown. */
export const REQUEST_CLASSIFICATION_EVAL_CASES: readonly ClassificationEvalCase[] = [
  evalCase({
    id: 'read-git-status',
    request: 'Show git status.',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['read'],
  }),
  evalCase({
    id: 'read-list-files',
    request: 'List files in packages/core.',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['read'],
  }),
  evalCase({
    id: 'read-package-json',
    request: 'Read package.json.',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['read'],
  }),
  evalCase({
    id: 'read-current-branch',
    request: 'Show the current branch.',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['read'],
  }),
  evalCase({
    id: 'read-open-issues',
    request: 'Get the open issues for this repository.',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['read'],
  }),
  evalCase({
    id: 'read-readme',
    request: 'Read the README.',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['read'],
  }),

  evalCase({
    id: 'reason-tests',
    request: 'Investigate why these tests are failing.',
    complexity: 'reasoning',
    actionClass: 'unknown',
    tags: ['reasoning'],
  }),
  evalCase({
    id: 'reason-compare',
    request: 'Compare these two implementations.',
    complexity: 'reasoning',
    actionClass: 'unknown',
    tags: ['reasoning'],
  }),
  evalCase({
    id: 'reason-build-speed',
    request: 'Explain why the build is slower after this commit.',
    complexity: 'reasoning',
    actionClass: 'unknown',
    tags: ['reasoning'],
  }),
  evalCase({
    id: 'reason-concurrency',
    request: 'Review this code for concurrency bugs.',
    complexity: 'reasoning',
    actionClass: 'unknown',
    tags: ['reasoning'],
  }),
  evalCase({
    id: 'reason-memory',
    request: 'Find the likely cause of this memory leak.',
    complexity: 'reasoning',
    actionClass: 'unknown',
    tags: ['reasoning'],
  }),

  evalCase({
    id: 'write-dependency',
    request: 'Update package.json to add zod.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['write'],
  }),
  evalCase({
    id: 'write-fix-test',
    request: 'Fix the failing test.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['write'],
  }),
  evalCase({
    id: 'write-rename',
    request: 'Rename this function throughout the package.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['write'],
  }),
  evalCase({
    id: 'write-docs',
    request: 'Add documentation for this API.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['write'],
  }),
  evalCase({
    id: 'write-config',
    request: 'Create a new configuration file.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['write'],
  }),

  evalCase({
    id: 'destroy-build',
    request: 'Delete the generated build directory.',
    complexity: 'simple',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),
  evalCase({
    id: 'destroy-migrations',
    request: 'Remove the old migration files.',
    complexity: 'reasoning',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),
  evalCase({
    id: 'destroy-reset',
    request: 'Reset the repository to HEAD.',
    complexity: 'simple',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),
  evalCase({
    id: 'destroy-branch',
    request: 'Delete the local feature branch.',
    complexity: 'simple',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),
  evalCase({
    id: 'destroy-tables',
    request: 'Drop the temporary database tables.',
    complexity: 'reasoning',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),
  evalCase({
    id: 'destroy-overwrite',
    request: 'Overwrite the existing config with defaults.',
    complexity: 'reasoning',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),

  evalCase({
    id: 'external-pr',
    request: 'Create a pull request.',
    complexity: 'simple',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),
  evalCase({
    id: 'external-push',
    request: 'Push this branch to origin.',
    complexity: 'simple',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),
  evalCase({
    id: 'external-send',
    request: 'Send the report to the team.',
    complexity: 'simple',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),
  evalCase({
    id: 'external-publish',
    request: 'Publish the package.',
    complexity: 'reasoning',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),
  evalCase({
    id: 'external-deploy',
    request: 'Deploy the current revision.',
    complexity: 'reasoning',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),
  evalCase({
    id: 'external-trigger',
    request: 'Trigger the production workflow.',
    complexity: 'simple',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),
  evalCase({
    id: 'external-issue',
    request: 'Update the GitHub issue.',
    complexity: 'reasoning',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),

  evalCase({
    id: 'mixed-check-fix',
    request: 'Check the current branch and fix anything obviously wrong.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['mixed'],
  }),
  evalCase({
    id: 'mixed-review-merge',
    request: 'Review the open PR and merge it if everything looks good.',
    complexity: 'reasoning',
    actionClass: 'external_side_effect',
    tags: ['mixed'],
  }),
  evalCase({
    id: 'mixed-inspect-update',
    request: 'Inspect package.json and update outdated dependencies.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['mixed'],
  }),
  evalCase({
    id: 'mixed-find-delete',
    request: 'Find the failing test and delete the obsolete implementation.',
    complexity: 'reasoning',
    actionClass: 'destructive',
    tags: ['mixed'],
  }),
  evalCase({
    id: 'mixed-investigate-pr',
    request: 'Investigate the issue and open a pull request with the fix.',
    complexity: 'reasoning',
    actionClass: 'external_side_effect',
    tags: ['mixed'],
  }),

  evalCase({
    id: 'adversarial-negation-delete',
    request: "Don't delete anything; just tell me which files could be removed.",
    complexity: 'reasoning',
    actionClass: 'read',
    tags: ['adversarial', 'negation'],
  }),
  evalCase({
    id: 'adversarial-negation-publish',
    request: 'Explain how I would publish this package, but do not publish it.',
    complexity: 'reasoning',
    actionClass: 'read',
    tags: ['adversarial', 'negation'],
  }),
  evalCase({
    id: 'adversarial-hypothetical-reset',
    request: 'What would happen if I reset the repository?',
    complexity: 'reasoning',
    actionClass: 'read',
    tags: ['adversarial', 'hypothetical'],
  }),
  evalCase({
    id: 'adversarial-command-delete',
    request: 'Show me the command to delete the branch.',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['adversarial', 'informational'],
  }),
  evalCase({
    id: 'adversarial-deploy-status',
    request: 'Check whether the production deployment succeeded.',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['adversarial', 'status'],
  }),
  evalCase({
    id: 'adversarial-quoted',
    request: 'Explain the phrase "drop the database" without changing anything.',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['adversarial', 'quoted'],
  }),

  evalCase({
    id: 'tools-hypothetical-delete-yes',
    request: 'How do I delete a branch?',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['tools', 'informational'],
    toolsAvailable: true,
  }),
  evalCase({
    id: 'tools-hypothetical-delete-no',
    request: 'How do I delete a branch?',
    complexity: 'simple',
    actionClass: 'read',
    tags: ['tools', 'informational'],
    toolsAvailable: false,
  }),
];
