import { performance } from 'node:perf_hooks';

function cosine(left, right) {
  if (left.length === 0 || left.length !== right.length) return undefined;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (!Number.isFinite(l) || !Number.isFinite(r)) return undefined;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator === 0 ? undefined : dot / denominator;
}

export async function benchmarkRetrieval({ client, fixtures, tools, topK }) {
  const startedAt = performance.now();
  let errors = 0;
  let top1 = 0;
  let top3 = 0;
  let configured = 0;
  try {
    const toolVectors = await client.embed(tools.map(tool => tool.document));
    for (const fixture of fixtures) {
      try {
        const [queryVector] = await client.embed([fixture.query]);
        const ranked = tools
          .map((tool, index) => ({ id: tool.id, score: cosine(queryVector, toolVectors[index]) }))
          .filter(entry => entry.score !== undefined)
          .sort((left, right) => right.score - left.score)
          .map(entry => entry.id);
        if (ranked[0] === fixture.expected) top1 += 1;
        if (ranked.slice(0, 3).includes(fixture.expected)) top3 += 1;
        if (ranked.slice(0, topK).includes(fixture.expected)) configured += 1;
      } catch {
        errors += 1;
      }
    }
  } catch {
    errors = fixtures.length;
  }
  const total = fixtures.length;
  return {
    top1Accuracy: top1 / total,
    top3Recall: top3 / total,
    configuredTopKRecall: configured / total,
    embeddingErrors: errors,
    latencyMs: performance.now() - startedAt,
  };
}

export const retrievalFixtures = [
  { query: 'Show git status.', expected: 'git_status' },
  { query: 'Read package.json.', expected: 'read_file' },
  { query: 'Show the current branch.', expected: 'git_current_branch' },
  { query: 'List open pull requests.', expected: 'github_list_pull_requests' },
];

export const retrievalTools = [
  { id: 'git_status', document: 'Show repository working tree status and changes.' },
  { id: 'read_file', document: 'Read a file such as package.json.' },
  { id: 'git_current_branch', document: 'Show the currently checked out git branch.' },
  { id: 'github_list_pull_requests', document: 'List pull requests for a GitHub repository.' },
  { id: 'delete_file', document: 'Delete a file.' },
  { id: 'publish_package', document: 'Publish a package to a registry.' },
  { id: 'deploy_revision', document: 'Deploy a revision to production.' },
  { id: 'create_issue', document: 'Create a GitHub issue.' },
];
