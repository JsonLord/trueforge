import type { FastPathToolIdentity } from '../capabilities/FastPathAdmission';
import type { RequestActionClass, RequestComplexity } from '../capabilities/RequestClassifier';
import type { FastPathEvalCase } from './FastPathAdmissionEvaluation';

const GIT_STATUS = { serverId: 'git', toolName: 'git_status' };
const READ_FILE = { serverId: 'filesystem', toolName: 'read_file' };

function evalCase(params: {
  id: string;
  request: string;
  complexity: RequestComplexity;
  actionClass: RequestActionClass;
  tool?: FastPathToolIdentity | undefined;
  selectedTools?: FastPathToolIdentity[] | undefined;
  eligible?: boolean | undefined;
  allowlisted?: boolean | undefined;
  approvalRequired?: boolean | undefined;
  argumentsValidated?: boolean | undefined;
  policyVeto?: boolean | undefined;
  tags: string[];
}): FastPathEvalCase {
  const selectedTools = params.selectedTools ?? [params.tool ?? GIT_STATUS];
  return {
    id: params.id,
    request: params.request,
    toolsAvailable: true,
    expectedClassification: { complexity: params.complexity, actionClass: params.actionClass },
    runtime: {
      selectedTools,
      argumentsValidated: params.argumentsValidated ?? true,
      approvalRequired: params.approvalRequired ?? false,
      policyVeto: params.policyVeto ?? false,
    },
    eligibleTools: params.allowlisted === false ? [] : [...selectedTools],
    expectedEligible: params.eligible ?? false,
    tags: params.tags,
  };
}

export const FAST_PATH_ADMISSION_EVAL_CASES: readonly FastPathEvalCase[] = [
  evalCase({
    id: 'eligible-git-status',
    request: 'Show git status.',
    complexity: 'simple',
    actionClass: 'read',
    eligible: true,
    tags: ['eligible-read'],
  }),
  evalCase({
    id: 'eligible-list-files',
    request: 'List files in this directory.',
    complexity: 'simple',
    actionClass: 'read',
    tool: { serverId: 'filesystem', toolName: 'list_files' },
    eligible: true,
    tags: ['eligible-read'],
  }),
  evalCase({
    id: 'eligible-read-package',
    request: 'Read package.json.',
    complexity: 'simple',
    actionClass: 'read',
    tool: READ_FILE,
    eligible: true,
    tags: ['eligible-read'],
  }),
  evalCase({
    id: 'eligible-current-branch',
    request: 'Show the current branch.',
    complexity: 'simple',
    actionClass: 'read',
    tool: { serverId: 'git', toolName: 'current_branch' },
    eligible: true,
    tags: ['eligible-read'],
  }),
  evalCase({
    id: 'eligible-repo-metadata',
    request: 'Get repository metadata.',
    complexity: 'simple',
    actionClass: 'read',
    tool: { serverId: 'git', toolName: 'repository_metadata' },
    eligible: true,
    tags: ['eligible-read'],
  }),

  evalCase({
    id: 'blocked-unlisted-status',
    request: 'Show git status.',
    complexity: 'simple',
    actionClass: 'read',
    allowlisted: false,
    tags: ['not-allowlisted'],
  }),
  evalCase({
    id: 'blocked-unlisted-file',
    request: 'Read package.json.',
    complexity: 'simple',
    actionClass: 'read',
    tool: READ_FILE,
    allowlisted: false,
    tags: ['not-allowlisted'],
  }),
  evalCase({
    id: 'blocked-unlisted-metadata',
    request: 'Get repository metadata.',
    complexity: 'simple',
    actionClass: 'read',
    tool: { serverId: 'git', toolName: 'repository_metadata' },
    allowlisted: false,
    tags: ['not-allowlisted'],
  }),

  evalCase({
    id: 'blocked-approval-status',
    request: 'Show protected repository status.',
    complexity: 'simple',
    actionClass: 'read',
    approvalRequired: true,
    tags: ['approval'],
  }),
  evalCase({
    id: 'blocked-approval-file',
    request: 'Read the protected config.',
    complexity: 'simple',
    actionClass: 'read',
    tool: READ_FILE,
    approvalRequired: true,
    tags: ['approval'],
  }),

  evalCase({
    id: 'reason-build',
    request: 'Investigate why the build fails.',
    complexity: 'reasoning',
    actionClass: 'unknown',
    tags: ['reasoning'],
  }),
  evalCase({
    id: 'reason-concurrency',
    request: 'Review this package for concurrency problems.',
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
    id: 'write-package',
    request: 'Update package.json.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['write'],
  }),
  evalCase({
    id: 'write-rename',
    request: 'Rename this function.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['write'],
  }),
  evalCase({
    id: 'write-test',
    request: 'Fix this test.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['write'],
  }),
  evalCase({
    id: 'write-config',
    request: 'Create a config file.',
    complexity: 'reasoning',
    actionClass: 'write',
    tags: ['write'],
  }),

  evalCase({
    id: 'destroy-directory',
    request: 'Delete this directory.',
    complexity: 'simple',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),
  evalCase({
    id: 'destroy-reset',
    request: 'Reset the repository.',
    complexity: 'simple',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),
  evalCase({
    id: 'destroy-branch',
    request: 'Remove the branch.',
    complexity: 'simple',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),
  evalCase({
    id: 'destroy-table',
    request: 'Drop the table.',
    complexity: 'reasoning',
    actionClass: 'destructive',
    tags: ['destructive'],
  }),

  evalCase({
    id: 'external-push',
    request: 'Push the branch.',
    complexity: 'simple',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),
  evalCase({
    id: 'external-pr',
    request: 'Create a pull request.',
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
    request: 'Deploy this revision.',
    complexity: 'reasoning',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),
  evalCase({
    id: 'external-message',
    request: 'Send the message.',
    complexity: 'simple',
    actionClass: 'external_side_effect',
    tags: ['external'],
  }),

  evalCase({
    id: 'info-delete',
    request: 'Tell me how to delete this branch, but do not do it.',
    complexity: 'reasoning',
    actionClass: 'read',
    tool: READ_FILE,
    tags: ['adversarial'],
  }),
  evalCase({
    id: 'info-reset',
    request: 'What would happen if I reset the repository?',
    complexity: 'reasoning',
    actionClass: 'read',
    tool: READ_FILE,
    tags: ['adversarial'],
  }),
  evalCase({
    id: 'info-deploy',
    request: 'Check whether the deployment succeeded.',
    complexity: 'simple',
    actionClass: 'read',
    eligible: true,
    tags: ['adversarial'],
  }),
  evalCase({
    id: 'info-publish',
    request: 'Explain how package publishing works.',
    complexity: 'reasoning',
    actionClass: 'read',
    tool: READ_FILE,
    tags: ['adversarial'],
  }),

  evalCase({
    id: 'mixed-status-write',
    request: 'Check git status and then update package.json.',
    complexity: 'reasoning',
    actionClass: 'write',
    selectedTools: [GIT_STATUS, READ_FILE],
    tags: ['mixed'],
  }),
  evalCase({
    id: 'mixed-branch-push',
    request: 'Inspect the branch and push it if clean.',
    complexity: 'reasoning',
    actionClass: 'external_side_effect',
    selectedTools: [GIT_STATUS, { serverId: 'git', toolName: 'push' }],
    tags: ['mixed'],
  }),
  evalCase({
    id: 'mixed-read-delete',
    request: 'Read the config and delete obsolete entries.',
    complexity: 'reasoning',
    actionClass: 'destructive',
    selectedTools: [READ_FILE, { serverId: 'filesystem', toolName: 'delete_entries' }],
    tags: ['mixed'],
  }),

  evalCase({
    id: 'blocked-multiple-reads',
    request: 'Read package.json and show git status.',
    complexity: 'simple',
    actionClass: 'read',
    selectedTools: [READ_FILE, GIT_STATUS],
    tags: ['multiple-tools'],
  }),
  evalCase({
    id: 'blocked-invalid-arguments',
    request: 'Read package.json.',
    complexity: 'simple',
    actionClass: 'read',
    tool: READ_FILE,
    argumentsValidated: false,
    tags: ['invalid-arguments'],
  }),
  evalCase({
    id: 'blocked-policy-veto',
    request: 'Show git status.',
    complexity: 'simple',
    actionClass: 'read',
    policyVeto: true,
    tags: ['policy-veto'],
  }),
];
