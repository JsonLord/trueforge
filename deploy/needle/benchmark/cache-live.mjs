import { performance } from 'node:perf_hooks';
import { NeedleToolSelectorPolicy } from '../../../packages/trueforge-core/dist/core/index.mjs';

function makeSilentLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

export async function runCacheLiveVerification(clientOverride) {
  const embedCounts = [];
  const client = clientOverride ?? {
    embed: async inputs => {
      embedCounts.push(inputs.length);
      return inputs.map(() => [1, 0, 0]);
    },
  };

  const policy = new NeedleToolSelectorPolicy({
    client,
    logger: makeSilentLogger(),
    enabled: true,
  });

  const toolA = {
    name: 'tool_a',
    description: 'A',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  };

  const toolB = {
    name: 'tool_b',
    description: 'B',
    inputSchema: { type: 'object' },
  };

  const report = [];

  // 1. Initial registry (2 tools)
  embedCounts.length = 0;
  const startInitial = performance.now();
  await policy.selectTools({ query: 'test query', tools: [toolA, toolB], serverName: 'test_srv' });
  const costInitial = performance.now() - startInitial;
  // Note: embed is called twice in selectTools: once for missing tools (batch size 2), once for query (batch size 1)
  const initialToolEmbeds = embedCounts[0] ?? 0;
  report.push({
    operation: 'Initial registry',
    expectedReEmbeddings: '2 tools',
    actualReEmbeddings: initialToolEmbeds,
  });

  // 2. Identical registry
  embedCounts.length = 0;
  const startIdentical = performance.now();
  await policy.selectTools({ query: 'test query 2', tools: [toolA, toolB], serverName: 'test_srv' });
  const costIdentical = performance.now() - startIdentical;
  const identicalToolEmbeds = embedCounts.length > 1 ? embedCounts[0] : 0; // only query was embedded if tools hit cache
  report.push({ operation: 'Identical registry', expectedReEmbeddings: '0', actualReEmbeddings: identicalToolEmbeds });

  // 3. Description change
  embedCounts.length = 0;
  const toolADesc = { ...toolA, description: 'A modified description' };
  const startDesc = performance.now();
  await policy.selectTools({ query: 'test query 3', tools: [toolADesc, toolB], serverName: 'test_srv' });
  const costDesc = performance.now() - startDesc;
  const descToolEmbeds = embedCounts[0] ?? 0;
  report.push({
    operation: 'Description change',
    expectedReEmbeddings: '1 (affected tool)',
    actualReEmbeddings: descToolEmbeds,
  });

  // 4. Input schema change
  embedCounts.length = 0;
  const toolAInput = { ...toolADesc, inputSchema: { type: 'object', properties: { field: { type: 'string' } } } };
  await policy.selectTools({ query: 'test query 4', tools: [toolAInput, toolB], serverName: 'test_srv' });
  const inputToolEmbeds = embedCounts[0] ?? 0;
  report.push({
    operation: 'Input schema change',
    expectedReEmbeddings: '1 (affected tool)',
    actualReEmbeddings: inputToolEmbeds,
  });

  // 5. Output schema change
  embedCounts.length = 0;
  const toolAOutput = { ...toolAInput, outputSchema: { type: 'object', properties: { res: { type: 'number' } } } };
  await policy.selectTools({ query: 'test query 5', tools: [toolAOutput, toolB], serverName: 'test_srv' });
  const outputToolEmbeds = embedCounts[0] ?? 0;
  report.push({
    operation: 'Output schema change',
    expectedReEmbeddings: '1 (affected tool)',
    actualReEmbeddings: outputToolEmbeds,
  });

  // 6. Annotation change
  embedCounts.length = 0;
  const toolAAnnot = { ...toolAOutput, annotations: { readOnlyHint: false } };
  await policy.selectTools({ query: 'test query 6', tools: [toolAAnnot, toolB], serverName: 'test_srv' });
  const annotToolEmbeds = embedCounts[0] ?? 0;
  report.push({
    operation: 'Annotation change',
    expectedReEmbeddings: '1 (affected tool)',
    actualReEmbeddings: annotToolEmbeds,
  });

  // 7. Remove tool (pruning)
  embedCounts.length = 0;
  await policy.selectTools({ query: 'test query 7', tools: [toolAAnnot], serverName: 'test_srv' });
  const removeToolEmbeds = embedCounts.length > 1 ? embedCounts[0] : 0;
  report.push({ operation: 'Remove tool', expectedReEmbeddings: '0 (pruned)', actualReEmbeddings: removeToolEmbeds });

  // 8. Add tool
  embedCounts.length = 0;
  const toolC = { name: 'tool_c', description: 'C', inputSchema: { type: 'object' } };
  await policy.selectTools({ query: 'test query 8', tools: [toolAAnnot, toolC], serverName: 'test_srv' });
  const addToolEmbeds = embedCounts[0] ?? 0;
  report.push({ operation: 'Add tool', expectedReEmbeddings: '1 (new tool)', actualReEmbeddings: addToolEmbeds });

  return {
    operationsTable: report,
    costsMs: {
      coldRegistryEmbeddingCostMs: costInitial,
      warmUnchangedRegistryCostMs: costIdentical,
      singleToolInvalidationCostMs: costDesc,
    },
  };
}

if (process.argv[1]?.endsWith('cache-live.mjs')) {
  runCacheLiveVerification().then(res => {
    console.log(JSON.stringify(res, null, 2));
  });
}
