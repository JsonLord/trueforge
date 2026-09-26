// Extended retrieval evaluation corpus with 150+ queries and 50+ tools across categories

export const CATEGORIES = {
  FILESYSTEM: 'filesystem',
  GIT: 'git',
  GITHUB: 'github',
  REPO_INTEL: 'repo_intel',
  BUILD_TEST: 'build_test',
  MCP_RESOURCE: 'mcp_resource',
};

export const ACTION_TYPES = {
  READ: 'read',
  WRITE: 'write',
  DESTRUCTIVE: 'destructive',
  EXTERNAL_SIDE_EFFECT: 'external_side_effect',
};

export const ALL_TOOLS = [
  // Filesystem
  {
    id: 'read_file',
    category: CATEGORIES.FILESYSTEM,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'read_file',
      description: 'Read full or partial contents of a file from disk.',
      inputSchema: { type: 'object', properties: { filepath: { type: 'string' } }, required: ['filepath'] },
    }),
  },
  {
    id: 'list_directory',
    category: CATEGORIES.FILESYSTEM,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'list_directory',
      description: 'List files and directories at a given filesystem path.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    }),
  },
  {
    id: 'search_files',
    category: CATEGORIES.FILESYSTEM,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'search_files',
      description: 'Search for files matching a glob or pattern in the directory tree.',
      inputSchema: { type: 'object', properties: { pattern: { type: 'string' } } },
    }),
  },
  {
    id: 'find_symbol',
    category: CATEGORIES.FILESYSTEM,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'find_symbol',
      description: 'Find definition of a function, class, or symbol in the workspace.',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
    }),
  },
  {
    id: 'write_file',
    category: CATEGORIES.FILESYSTEM,
    actionType: ACTION_TYPES.WRITE,
    document: JSON.stringify({
      name: 'write_file',
      description: 'Write or overwrite content into a specified file on disk.',
      inputSchema: {
        type: 'object',
        properties: { filepath: { type: 'string' }, content: { type: 'string' } },
        required: ['filepath', 'content'],
      },
    }),
  },
  {
    id: 'rename_file',
    category: CATEGORIES.FILESYSTEM,
    actionType: ACTION_TYPES.WRITE,
    document: JSON.stringify({
      name: 'rename_file',
      description: 'Rename or move a file or directory on the filesystem.',
      inputSchema: {
        type: 'object',
        properties: { old_path: { type: 'string' }, new_path: { type: 'string' } },
        required: ['old_path', 'new_path'],
      },
    }),
  },
  {
    id: 'delete_file',
    category: CATEGORIES.FILESYSTEM,
    actionType: ACTION_TYPES.DESTRUCTIVE,
    document: JSON.stringify({
      name: 'delete_file',
      description: 'Permanently delete a file or directory from disk.',
      inputSchema: { type: 'object', properties: { filepath: { type: 'string' } }, required: ['filepath'] },
    }),
  },

  // Git
  {
    id: 'git_status',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'git_status',
      description: 'Show git working tree status, modified, untracked, and staged files.',
      inputSchema: { type: 'object' },
    }),
  },
  {
    id: 'git_current_branch',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'git_current_branch',
      description: 'Show the currently checked out git branch name.',
      inputSchema: { type: 'object' },
    }),
  },
  {
    id: 'git_diff',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'git_diff',
      description: 'Show changes between commits, commit and working tree, or staged changes.',
      inputSchema: { type: 'object', properties: { target: { type: 'string' } } },
    }),
  },
  {
    id: 'git_log',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'git_log',
      description: 'Show commit logs, history, and author commit records.',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    }),
  },
  {
    id: 'git_show_commit',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'git_show_commit',
      description: 'Show details and diff of a specific git commit hash.',
      inputSchema: { type: 'object', properties: { hash: { type: 'string' } }, required: ['hash'] },
    }),
  },
  {
    id: 'git_create_branch',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.WRITE,
    document: JSON.stringify({
      name: 'git_create_branch',
      description: 'Create a new git branch from current HEAD or commit.',
      inputSchema: { type: 'object', properties: { branch: { type: 'string' } }, required: ['branch'] },
    }),
  },
  {
    id: 'git_delete_branch',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.DESTRUCTIVE,
    document: JSON.stringify({
      name: 'git_delete_branch',
      description: 'Delete a local git branch from the repository.',
      inputSchema: {
        type: 'object',
        properties: { branch: { type: 'string' }, force: { type: 'boolean' } },
        required: ['branch'],
      },
    }),
  },
  {
    id: 'git_reset',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.DESTRUCTIVE,
    document: JSON.stringify({
      name: 'git_reset',
      description: 'Reset current HEAD to specified state, discarding or unstaging changes.',
      inputSchema: { type: 'object', properties: { mode: { type: 'string' }, target: { type: 'string' } } },
    }),
  },
  {
    id: 'git_commit',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.WRITE,
    document: JSON.stringify({
      name: 'git_commit',
      description: 'Record staged changes into repository history with a commit message.',
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    }),
  },
  {
    id: 'git_push',
    category: CATEGORIES.GIT,
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
    document: JSON.stringify({
      name: 'git_push',
      description: 'Update remote refs along with associated objects to remote git repository.',
      inputSchema: { type: 'object', properties: { remote: { type: 'string' }, branch: { type: 'string' } } },
    }),
  },

  // GitHub
  {
    id: 'github_list_issues',
    category: CATEGORIES.GITHUB,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'github_list_issues',
      description: 'List open or closed issues for a GitHub repository.',
      inputSchema: {
        type: 'object',
        properties: { owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string' } },
      },
    }),
  },
  {
    id: 'github_get_issue',
    category: CATEGORIES.GITHUB,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'github_get_issue',
      description: 'Get details and comments for a specific GitHub issue number.',
      inputSchema: {
        type: 'object',
        properties: { owner: { type: 'string' }, repo: { type: 'string' }, issue_number: { type: 'number' } },
        required: ['issue_number'],
      },
    }),
  },
  {
    id: 'github_list_pull_requests',
    category: CATEGORIES.GITHUB,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'github_list_pull_requests',
      description: 'List pull requests for a GitHub repository.',
      inputSchema: {
        type: 'object',
        properties: { owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string' } },
      },
    }),
  },
  {
    id: 'github_get_pull_request',
    category: CATEGORIES.GITHUB,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'github_get_pull_request',
      description: 'Get details, diff, and files changed for a specific GitHub pull request.',
      inputSchema: {
        type: 'object',
        properties: { owner: { type: 'string' }, repo: { type: 'string' }, pull_number: { type: 'number' } },
        required: ['pull_number'],
      },
    }),
  },
  {
    id: 'github_create_pull_request',
    category: CATEGORIES.GITHUB,
    actionType: ACTION_TYPES.WRITE,
    document: JSON.stringify({
      name: 'github_create_pull_request',
      description: 'Create a new pull request on a GitHub repository.',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          head: { type: 'string' },
          base: { type: 'string' },
        },
        required: ['title', 'head', 'base'],
      },
    }),
  },
  {
    id: 'github_merge_pull_request',
    category: CATEGORIES.GITHUB,
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
    document: JSON.stringify({
      name: 'github_merge_pull_request',
      description: 'Merge a pull request on GitHub repository.',
      inputSchema: {
        type: 'object',
        properties: { owner: { type: 'string' }, repo: { type: 'string' }, pull_number: { type: 'number' } },
        required: ['pull_number'],
      },
    }),
  },
  {
    id: 'github_comment',
    category: CATEGORIES.GITHUB,
    actionType: ACTION_TYPES.WRITE,
    document: JSON.stringify({
      name: 'github_comment',
      description: 'Add a comment to an issue or pull request on GitHub.',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'number' },
          body: { type: 'string' },
        },
        required: ['issue_number', 'body'],
      },
    }),
  },
  {
    id: 'github_update_issue',
    category: CATEGORIES.GITHUB,
    actionType: ACTION_TYPES.WRITE,
    document: JSON.stringify({
      name: 'github_update_issue',
      description: 'Update issue status, labels, title, or body on GitHub.',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'number' },
          state: { type: 'string' },
        },
        required: ['issue_number'],
      },
    }),
  },
  {
    id: 'github_delete_issue',
    category: CATEGORIES.GITHUB,
    actionType: ACTION_TYPES.DESTRUCTIVE,
    document: JSON.stringify({
      name: 'github_delete_issue',
      description: 'Delete an issue or discussion on GitHub permanently.',
      inputSchema: { type: 'object', properties: { issue_number: { type: 'number' } }, required: ['issue_number'] },
    }),
  },

  // Repository Intelligence
  {
    id: 'find_references',
    category: CATEGORIES.REPO_INTEL,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'find_references',
      description: 'Find all usages and references of a symbol across the project.',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
    }),
  },
  {
    id: 'search_text',
    category: CATEGORIES.REPO_INTEL,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'search_text',
      description: 'Grep or search plain text / regex across repository files.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }),
  },
  {
    id: 'inspect_dependency',
    category: CATEGORIES.REPO_INTEL,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'inspect_dependency',
      description: 'Inspect dependency tree and installed package version details.',
      inputSchema: { type: 'object', properties: { package_name: { type: 'string' } } },
    }),
  },
  {
    id: 'inspect_package_metadata',
    category: CATEGORIES.REPO_INTEL,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'inspect_package_metadata',
      description: 'Read package manifest, scripts, and publishing configuration.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    }),
  },

  // Build / Test
  {
    id: 'run_test',
    category: CATEGORIES.BUILD_TEST,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'run_test',
      description: 'Run unit test suite or specific test file.',
      inputSchema: { type: 'object', properties: { test_file: { type: 'string' } } },
    }),
  },
  {
    id: 'inspect_test_result',
    category: CATEGORIES.BUILD_TEST,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'inspect_test_result',
      description: 'Inspect test coverage, logs, or failure summary report.',
      inputSchema: { type: 'object', properties: { run_id: { type: 'string' } } },
    }),
  },
  {
    id: 'build_project',
    category: CATEGORIES.BUILD_TEST,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'build_project',
      description: 'Compile or bundle the workspace project artifacts.',
      inputSchema: { type: 'object' },
    }),
  },
  {
    id: 'lint_code',
    category: CATEGORIES.BUILD_TEST,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'lint_code',
      description: 'Run linter checks across project source code.',
      inputSchema: { type: 'object' },
    }),
  },
  {
    id: 'typecheck_project',
    category: CATEGORIES.BUILD_TEST,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'typecheck_project',
      description: 'Run TypeScript compiler type-checking without emitting files.',
      inputSchema: { type: 'object' },
    }),
  },

  // Deployment & Infrastructure
  {
    id: 'deployment_status',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'deployment_status',
      description: 'Check status, health, and logs of service deployment.',
      inputSchema: { type: 'object', properties: { service_id: { type: 'string' } } },
    }),
  },
  {
    id: 'deploy_service',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
    document: JSON.stringify({
      name: 'deploy_service',
      description: 'Deploy service revision to staging or production environment.',
      inputSchema: {
        type: 'object',
        properties: { service_id: { type: 'string' }, image: { type: 'string' } },
        required: ['service_id'],
      },
    }),
  },
  {
    id: 'rollback_deployment',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.DESTRUCTIVE,
    document: JSON.stringify({
      name: 'rollback_deployment',
      description: 'Rollback service deployment to previous known healthy revision.',
      inputSchema: { type: 'object', properties: { service_id: { type: 'string' } }, required: ['service_id'] },
    }),
  },
  {
    id: 'publish_package',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
    document: JSON.stringify({
      name: 'publish_package',
      description: 'Publish built npm/pypi package to external artifact registry.',
      inputSchema: { type: 'object', properties: { package_name: { type: 'string' }, tag: { type: 'string' } } },
    }),
  },

  // MCP Namespaced Resource Tools
  {
    id: 'mcp__db__read_query',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'mcp__db__read_query',
      description: 'Execute read-only SQL SELECT query against database.',
      inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
    }),
  },
  {
    id: 'mcp__db__write_query',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.WRITE,
    document: JSON.stringify({
      name: 'mcp__db__write_query',
      description: 'Execute INSERT or UPDATE SQL mutation in database.',
      inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
    }),
  },
  {
    id: 'mcp__db__drop_table',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.DESTRUCTIVE,
    document: JSON.stringify({
      name: 'mcp__db__drop_table',
      description: 'Drop database table or database schema permanently.',
      inputSchema: { type: 'object', properties: { table_name: { type: 'string' } }, required: ['table_name'] },
    }),
  },
  {
    id: 'mcp__aws__s3_list',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'mcp__aws__s3_list',
      description: 'List objects in S3 bucket.',
      inputSchema: { type: 'object', properties: { bucket: { type: 'string' } } },
    }),
  },
  {
    id: 'mcp__aws__s3_delete',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.DESTRUCTIVE,
    document: JSON.stringify({
      name: 'mcp__aws__s3_delete',
      description: 'Delete object or key from S3 bucket.',
      inputSchema: {
        type: 'object',
        properties: { bucket: { type: 'string' }, key: { type: 'string' } },
        required: ['bucket', 'key'],
      },
    }),
  },
  {
    id: 'mcp__slack__send_message',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
    document: JSON.stringify({
      name: 'mcp__slack__send_message',
      description: 'Post a notification message to a Slack channel.',
      inputSchema: {
        type: 'object',
        properties: { channel: { type: 'string' }, text: { type: 'string' } },
        required: ['channel', 'text'],
      },
    }),
  },
  {
    id: 'mcp__slack__read_history',
    category: CATEGORIES.MCP_RESOURCE,
    actionType: ACTION_TYPES.READ,
    document: JSON.stringify({
      name: 'mcp__slack__read_history',
      description: 'Read recent messages from a Slack channel.',
      inputSchema: { type: 'object', properties: { channel: { type: 'string' } }, required: ['channel'] },
    }),
  },
];

// 150+ Queries covering exact actions, near neighbors, and adversarial informational queries
export const BENCHMARK_QUERIES = [
  // Filesystem Read / Info
  { query: 'Read package.json.', expected: 'read_file', actionType: ACTION_TYPES.READ },
  { query: 'Show me the contents of src/index.ts.', expected: 'read_file', actionType: ACTION_TYPES.READ },
  { query: 'Display configuration file tsconfig.json.', expected: 'read_file', actionType: ACTION_TYPES.READ },
  { query: 'Read README.md file in root folder.', expected: 'read_file', actionType: ACTION_TYPES.READ },
  { query: 'Inspect contents of Dockerfile.', expected: 'read_file', actionType: ACTION_TYPES.READ },
  { query: 'List files in current directory.', expected: 'list_directory', actionType: ACTION_TYPES.READ },
  { query: 'Show all files under deploy/needle.', expected: 'list_directory', actionType: ACTION_TYPES.READ },
  { query: 'Show contents of root directory.', expected: 'list_directory', actionType: ACTION_TYPES.READ },
  { query: 'List files in packages/trueforge-core.', expected: 'list_directory', actionType: ACTION_TYPES.READ },
  { query: 'Find files matching *.test.ts.', expected: 'search_files', actionType: ACTION_TYPES.READ },
  { query: 'Search workspace for markdown files.', expected: 'search_files', actionType: ACTION_TYPES.READ },
  { query: 'Find all json files in repository.', expected: 'search_files', actionType: ACTION_TYPES.READ },
  { query: 'Search for python scripts in deploy/', expected: 'search_files', actionType: ACTION_TYPES.READ },
  { query: 'Find definition of function createNeedleClient.', expected: 'find_symbol', actionType: ACTION_TYPES.READ },
  { query: 'Where is class SerializedGateway defined?', expected: 'find_symbol', actionType: ACTION_TYPES.READ },
  { query: 'Locate type RequestClassification in code.', expected: 'find_symbol', actionType: ACTION_TYPES.READ },
  { query: 'Find function runNeedleLiveEvaluation.', expected: 'find_symbol', actionType: ACTION_TYPES.READ },

  // Filesystem Write / Destructive
  { query: 'Write content to build.log.', expected: 'write_file', actionType: ACTION_TYPES.WRITE },
  { query: 'Create file output.json with results.', expected: 'write_file', actionType: ACTION_TYPES.WRITE },
  { query: 'Overwrite README.md with new instructions.', expected: 'write_file', actionType: ACTION_TYPES.WRITE },
  { query: 'Save JSON output to data.json.', expected: 'write_file', actionType: ACTION_TYPES.WRITE },
  { query: 'Write notes to notes.txt.', expected: 'write_file', actionType: ACTION_TYPES.WRITE },
  { query: 'Rename config.old to config.new.', expected: 'rename_file', actionType: ACTION_TYPES.WRITE },
  { query: 'Move file temp.txt to archive/temp.txt.', expected: 'rename_file', actionType: ACTION_TYPES.WRITE },
  { query: 'Rename file test.js to test.mjs.', expected: 'rename_file', actionType: ACTION_TYPES.WRITE },
  { query: 'Delete temp file scratch.tmp.', expected: 'delete_file', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Permanently remove build directory.', expected: 'delete_file', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Delete file obsolete.json.', expected: 'delete_file', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Delete this file.', expected: 'delete_file', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Remove unwanted file artifact.log.', expected: 'delete_file', actionType: ACTION_TYPES.DESTRUCTIVE },

  // Filesystem Adversarial
  {
    query: 'Tell me whether this directory is safe to delete.',
    expected: 'list_directory',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Check which file would be deleted by cleanup.',
    expected: 'search_files',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Read the configuration that controls package publishing.',
    expected: 'inspect_package_metadata',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Show me what file write_file would modify.',
    expected: 'read_file',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Check if delete_file is targeted at src/index.ts.',
    expected: 'read_file',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },

  // Git Read / Info
  { query: 'Show git status.', expected: 'git_status', actionType: ACTION_TYPES.READ },
  { query: 'What is current git working tree status?', expected: 'git_status', actionType: ACTION_TYPES.READ },
  { query: 'Show me modified and staged files.', expected: 'git_status', actionType: ACTION_TYPES.READ },
  { query: 'Check git status.', expected: 'git_status', actionType: ACTION_TYPES.READ },
  { query: 'Display uncommitted files.', expected: 'git_status', actionType: ACTION_TYPES.READ },
  { query: 'Show current checked out branch.', expected: 'git_current_branch', actionType: ACTION_TYPES.READ },
  { query: 'Which git branch am I currently on?', expected: 'git_current_branch', actionType: ACTION_TYPES.READ },
  { query: 'Get current active branch name.', expected: 'git_current_branch', actionType: ACTION_TYPES.READ },
  { query: 'Show diff for uncommitted changes.', expected: 'git_diff', actionType: ACTION_TYPES.READ },
  { query: 'View git diff between main and feature.', expected: 'git_diff', actionType: ACTION_TYPES.READ },
  { query: 'Show staged diff changes.', expected: 'git_diff', actionType: ACTION_TYPES.READ },
  { query: 'Show commit log history.', expected: 'git_log', actionType: ACTION_TYPES.READ },
  { query: 'List last 10 git commits.', expected: 'git_log', actionType: ACTION_TYPES.READ },
  { query: 'Show commit history for main branch.', expected: 'git_log', actionType: ACTION_TYPES.READ },
  { query: 'Show details of commit d6dc8cc.', expected: 'git_show_commit', actionType: ACTION_TYPES.READ },
  { query: 'Inspect commit hash e1f2a3.', expected: 'git_show_commit', actionType: ACTION_TYPES.READ },
  { query: 'Show changes introduced in last commit.', expected: 'git_show_commit', actionType: ACTION_TYPES.READ },

  // Git Write / Destructive / External
  { query: 'Create new branch feature/auth.', expected: 'git_create_branch', actionType: ACTION_TYPES.WRITE },
  { query: 'Checkout new branch fix-bug-123.', expected: 'git_create_branch', actionType: ACTION_TYPES.WRITE },
  { query: 'Create local branch refactor-core.', expected: 'git_create_branch', actionType: ACTION_TYPES.WRITE },
  { query: 'Delete local branch feature/old.', expected: 'git_delete_branch', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Delete branch fix/temp.', expected: 'git_delete_branch', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Delete the branch.', expected: 'git_delete_branch', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Reset current branch HEAD.', expected: 'git_reset', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Reset repository hard to HEAD~1.', expected: 'git_reset', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Reset the repository.', expected: 'git_reset', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'Commit staged changes with message fix bug.', expected: 'git_commit', actionType: ACTION_TYPES.WRITE },
  { query: 'Record commit for release v1.0.', expected: 'git_commit', actionType: ACTION_TYPES.WRITE },
  { query: 'Commit changes to git.', expected: 'git_commit', actionType: ACTION_TYPES.WRITE },
  { query: 'Push commits to origin main.', expected: 'git_push', actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT },
  {
    query: 'Push local branch to remote repository.',
    expected: 'git_push',
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
  },

  // Git Adversarial
  {
    query: 'Show me which branch would be deleted.',
    expected: 'git_current_branch',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Explain what git reset would change.',
    expected: 'git_diff',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Show unpushed commits before pushing.',
    expected: 'git_log',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Check whether branch feature/old exists before deleting.',
    expected: 'git_current_branch',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },

  // GitHub Read / Info
  { query: 'List open issues for repository.', expected: 'github_list_issues', actionType: ACTION_TYPES.READ },
  { query: 'Find open bug issues on GitHub.', expected: 'github_list_issues', actionType: ACTION_TYPES.READ },
  { query: 'Show all closed issues.', expected: 'github_list_issues', actionType: ACTION_TYPES.READ },
  { query: 'Get details for issue #42.', expected: 'github_get_issue', actionType: ACTION_TYPES.READ },
  { query: 'View comments on issue 101.', expected: 'github_get_issue', actionType: ACTION_TYPES.READ },
  { query: 'Read description of issue #12.', expected: 'github_get_issue', actionType: ACTION_TYPES.READ },
  { query: 'List open pull requests.', expected: 'github_list_pull_requests', actionType: ACTION_TYPES.READ },
  {
    query: 'Show active PRs for JsonLord/trueforge.',
    expected: 'github_list_pull_requests',
    actionType: ACTION_TYPES.READ,
  },
  { query: 'List merged PRs on GitHub.', expected: 'github_list_pull_requests', actionType: ACTION_TYPES.READ },
  { query: 'Get pull request #15.', expected: 'github_get_pull_request', actionType: ACTION_TYPES.READ },
  { query: 'Inspect files changed in PR 20.', expected: 'github_get_pull_request', actionType: ACTION_TYPES.READ },
  { query: 'Show diff for pull request 5.', expected: 'github_get_pull_request', actionType: ACTION_TYPES.READ },

  // GitHub Write / External / Destructive
  {
    query: 'Create pull request for feature branch.',
    expected: 'github_create_pull_request',
    actionType: ACTION_TYPES.WRITE,
  },
  { query: 'Open PR from fix/123 to main.', expected: 'github_create_pull_request', actionType: ACTION_TYPES.WRITE },
  {
    query: 'Merge pull request #15.',
    expected: 'github_merge_pull_request',
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
  },
  {
    query: 'Merge PR 99 on GitHub repository.',
    expected: 'github_merge_pull_request',
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
  },
  {
    query: 'Merge the pull request.',
    expected: 'github_merge_pull_request',
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
  },
  { query: 'Add comment LGTM on issue #42.', expected: 'github_comment', actionType: ACTION_TYPES.WRITE },
  { query: 'Comment on PR #10 with approval.', expected: 'github_comment', actionType: ACTION_TYPES.WRITE },
  { query: 'Close issue #30 as resolved.', expected: 'github_update_issue', actionType: ACTION_TYPES.WRITE },
  { query: 'Update issue #5 labels and status.', expected: 'github_update_issue', actionType: ACTION_TYPES.WRITE },
  { query: 'Delete issue #99 on GitHub.', expected: 'github_delete_issue', actionType: ACTION_TYPES.DESTRUCTIVE },

  // GitHub Adversarial
  {
    query: 'Show the pull request before I merge it.',
    expected: 'github_get_pull_request',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Check comments on issue before closing it.',
    expected: 'github_get_issue',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'View pull request status before merging.',
    expected: 'github_get_pull_request',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },

  // Repo Intel / Search
  { query: 'Find all usages of method classifyRequest.', expected: 'find_references', actionType: ACTION_TYPES.READ },
  { query: 'Search for references to NeedleBackend.', expected: 'find_references', actionType: ACTION_TYPES.READ },
  {
    query: 'Where is SerializedGateway referenced in tests?',
    expected: 'find_references',
    actionType: ACTION_TYPES.READ,
  },
  {
    query: 'Grep for requestClassificationEnabled in codebase.',
    expected: 'search_text',
    actionType: ACTION_TYPES.READ,
  },
  { query: 'Search text for error message string.', expected: 'search_text', actionType: ACTION_TYPES.READ },
  { query: 'Find occurrence of string runtime_unavailable.', expected: 'search_text', actionType: ACTION_TYPES.READ },
  {
    query: 'Inspect dependency version of cactus-needle.',
    expected: 'inspect_dependency',
    actionType: ACTION_TYPES.READ,
  },
  { query: 'Check package.json dependency tree.', expected: 'inspect_dependency', actionType: ACTION_TYPES.READ },
  { query: 'Check installed version of typescript.', expected: 'inspect_dependency', actionType: ACTION_TYPES.READ },
  {
    query: 'Inspect package manifest and publish config.',
    expected: 'inspect_package_metadata',
    actionType: ACTION_TYPES.READ,
  },
  {
    query: 'Read scripts section in package.json.',
    expected: 'inspect_package_metadata',
    actionType: ACTION_TYPES.READ,
  },

  // Build / Test
  { query: 'Run unit test suite.', expected: 'run_test', actionType: ACTION_TYPES.READ },
  { query: 'Run tests in test_service.py.', expected: 'run_test', actionType: ACTION_TYPES.READ },
  { query: 'Execute pnpm test.', expected: 'run_test', actionType: ACTION_TYPES.READ },
  { query: 'Inspect test failure report.', expected: 'inspect_test_result', actionType: ACTION_TYPES.READ },
  { query: 'Show test coverage report.', expected: 'inspect_test_result', actionType: ACTION_TYPES.READ },
  { query: 'Build project bundle.', expected: 'build_project', actionType: ACTION_TYPES.READ },
  { query: 'Compile workspace packages.', expected: 'build_project', actionType: ACTION_TYPES.READ },
  { query: 'Run linter check.', expected: 'lint_code', actionType: ACTION_TYPES.READ },
  { query: 'Check code formatting with linter.', expected: 'lint_code', actionType: ACTION_TYPES.READ },
  { query: 'Run TypeScript typecheck.', expected: 'typecheck_project', actionType: ACTION_TYPES.READ },
  { query: 'Verify type correctness across project.', expected: 'typecheck_project', actionType: ACTION_TYPES.READ },

  // Infra / Near-Neighbor
  { query: 'Check deployment status of auth service.', expected: 'deployment_status', actionType: ACTION_TYPES.READ },
  { query: 'Show service deployment health.', expected: 'deployment_status', actionType: ACTION_TYPES.READ },
  { query: 'Check running status of web service.', expected: 'deployment_status', actionType: ACTION_TYPES.READ },
  {
    query: 'Deploy service revision to production.',
    expected: 'deploy_service',
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
  },
  {
    query: 'Deploy container image to staging.',
    expected: 'deploy_service',
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
  },
  { query: 'Deploy the service.', expected: 'deploy_service', actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT },
  {
    query: 'Rollback deployment to previous version.',
    expected: 'rollback_deployment',
    actionType: ACTION_TYPES.DESTRUCTIVE,
  },
  { query: 'Rollback production release.', expected: 'rollback_deployment', actionType: ACTION_TYPES.DESTRUCTIVE },
  {
    query: 'Publish package to npm registry.',
    expected: 'publish_package',
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
  },
  { query: 'Publish the package.', expected: 'publish_package', actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT },

  // Infra Adversarial
  {
    query: 'Check whether the deployment was rolled back.',
    expected: 'deployment_status',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Show deployment logs before deploying.',
    expected: 'deployment_status',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  {
    query: 'Check package publishing settings before publishing.',
    expected: 'inspect_package_metadata',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },

  // MCP Resource Tools
  { query: 'Run SELECT query on users table.', expected: 'mcp__db__read_query', actionType: ACTION_TYPES.READ },
  { query: 'Query database for active sessions.', expected: 'mcp__db__read_query', actionType: ACTION_TYPES.READ },
  { query: 'Execute read-only SQL query.', expected: 'mcp__db__read_query', actionType: ACTION_TYPES.READ },
  { query: 'Insert new record into events table.', expected: 'mcp__db__write_query', actionType: ACTION_TYPES.WRITE },
  { query: 'Update user email in database.', expected: 'mcp__db__write_query', actionType: ACTION_TYPES.WRITE },
  { query: 'Drop table analytics_old.', expected: 'mcp__db__drop_table', actionType: ACTION_TYPES.DESTRUCTIVE },
  { query: 'List objects in s3 bucket backups.', expected: 'mcp__aws__s3_list', actionType: ACTION_TYPES.READ },
  { query: 'Show files stored in S3 bucket.', expected: 'mcp__aws__s3_list', actionType: ACTION_TYPES.READ },
  { query: 'Delete s3 object audit.log.', expected: 'mcp__aws__s3_delete', actionType: ACTION_TYPES.DESTRUCTIVE },
  {
    query: 'Post notification message to Slack channel #deploys.',
    expected: 'mcp__slack__send_message',
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
  },
  {
    query: 'Send alert to Slack channel.',
    expected: 'mcp__slack__send_message',
    actionType: ACTION_TYPES.EXTERNAL_SIDE_EFFECT,
  },
  {
    query: 'Read recent messages from Slack channel #general.',
    expected: 'mcp__slack__read_history',
    actionType: ACTION_TYPES.READ,
  },
  { query: 'Fetch Slack message history.', expected: 'mcp__slack__read_history', actionType: ACTION_TYPES.READ },
  {
    query: 'Search Slack history for error code 500.',
    expected: 'mcp__slack__read_history',
    actionType: ACTION_TYPES.READ,
  },
  { query: 'Check S3 bucket permissions.', expected: 'mcp__aws__s3_list', actionType: ACTION_TYPES.READ },
  { query: 'Check database schema for users table.', expected: 'mcp__db__read_query', actionType: ACTION_TYPES.READ },
  {
    query: 'Check if Slack channel #general is public before posting.',
    expected: 'mcp__slack__read_history',
    actionType: ACTION_TYPES.READ,
    adversarial: true,
  },
  { query: 'Read package.json dependencies.', expected: 'inspect_package_metadata', actionType: ACTION_TYPES.READ },
  { query: 'List pull requests assigned to me.', expected: 'github_list_pull_requests', actionType: ACTION_TYPES.READ },
  { query: 'Show diff between HEAD and origin/main.', expected: 'git_diff', actionType: ACTION_TYPES.READ },
  { query: 'Find class NeedleToolSelectorPolicy in project.', expected: 'find_symbol', actionType: ACTION_TYPES.READ },
  { query: 'List files in python directory.', expected: 'list_directory', actionType: ACTION_TYPES.READ },
];

export function getRegistrySubset(count) {
  return ALL_TOOLS.slice(0, Math.min(count, ALL_TOOLS.length));
}
