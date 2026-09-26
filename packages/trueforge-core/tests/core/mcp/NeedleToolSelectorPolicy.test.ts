import type { AgentToolSchema } from '../../../src/core/mcp/IMCPServer';
import { needleToolSelection, NeedleToolSelectorPolicy } from '../../../src/core/mcp/NeedleToolSelectorPolicy';
import { makeSilentLogger, OBJECT_INPUT_SCHEMA } from '../harnessMocks';

function tool(name: string, description: string): AgentToolSchema {
  return { name, description, inputSchema: OBJECT_INPUT_SCHEMA, preload: false };
}

const tools = [tool('list_pull_requests', 'Find open pull requests'), tool('weather', 'Read a weather forecast')];

describe('NeedleToolSelectorPolicy', () => {
  test('is disabled by default', () => {
    expect(needleToolSelection({ client: { embed: jest.fn() }, logger: makeSilentLogger() })).toEqual({});
  });

  test.each([
    ['Show git status.', 'simple', 'read'],
    ['Investigate why the authentication tests fail and propose a fix.', 'reasoning', 'unknown'],
    ['Update package.json to add the dependency.', 'reasoning', 'write'],
    ['Delete the local generated build directory.', 'simple', 'destructive'],
    ['Create a pull request for this branch.', 'simple', 'external_side_effect'],
  ])('normalizes request classification for %s', async (query, complexity, actionClass) => {
    const policy = new NeedleToolSelectorPolicy({
      client: {
        embed: jest.fn(),
        classifyRequest: () => Promise.resolve({ complexity, actionClass, confidence: 0.94 }),
      },
      logger: makeSilentLogger(),
      requestClassificationEnabled: true,
    });

    await expect(policy.classify({ query, toolsAvailable: true })).resolves.toEqual({
      complexity,
      actionClass,
      confidence: 0.94,
    });
  });

  test.each([
    ['non-object payload', null],
    ['missing fields', { complexity: undefined, actionClass: undefined, confidence: undefined }],
    ['unsupported complexity', { complexity: 'trivial', actionClass: 'read', confidence: 0.9 }],
    ['unsupported action', { complexity: 'simple', actionClass: 'safe', confidence: 0.9 }],
    ['NaN confidence', { complexity: 'simple', actionClass: 'read', confidence: Number.NaN }],
    ['infinite confidence', { complexity: 'simple', actionClass: 'read', confidence: Number.POSITIVE_INFINITY }],
    ['negative confidence', { complexity: 'simple', actionClass: 'read', confidence: -1 }],
    ['oversized confidence', { complexity: 'simple', actionClass: 'read', confidence: 1.1 }],
  ])('falls back to unknown for malformed classification: %s', async (_name, response) => {
    const policy = new NeedleToolSelectorPolicy({
      client: { embed: jest.fn(), classifyRequest: () => Promise.resolve(response) },
      logger: makeSilentLogger(),
      requestClassificationEnabled: true,
    });

    await expect(policy.classify({ query: 'request', toolsAvailable: false })).resolves.toEqual({
      complexity: 'unknown',
      actionClass: 'unknown',
      confidence: 0,
    });
  });

  test('normalizes low-confidence classification to unknown without changing its confidence metadata', async () => {
    const policy = new NeedleToolSelectorPolicy({
      client: {
        embed: jest.fn(),
        classifyRequest: () => Promise.resolve({ complexity: 'simple', actionClass: 'read', confidence: 0.4 }),
      },
      logger: makeSilentLogger(),
      requestClassificationEnabled: true,
      minClassificationConfidence: 0.7,
    });

    await expect(policy.classify({ query: 'Show git status.', toolsAvailable: true })).resolves.toEqual({
      complexity: 'unknown',
      actionClass: 'unknown',
      confidence: 0.4,
    });
  });

  test.each([
    ['transport error', () => Promise.reject(new Error('offline'))],
    ['timeout', () => new Promise<{ complexity: unknown; actionClass: unknown; confidence: unknown }>(() => undefined)],
  ])('fails request classification open on %s', async (_name, classifyRequest) => {
    const policy = new NeedleToolSelectorPolicy({
      client: { embed: jest.fn(), classifyRequest },
      logger: makeSilentLogger(),
      requestClassificationEnabled: true,
      timeoutMs: 1,
    });

    await expect(policy.classify({ query: 'request', toolsAvailable: true })).resolves.toEqual({
      complexity: 'unknown',
      actionClass: 'unknown',
      confidence: 0,
    });
  });

  test('emits classification metadata without the raw request', async () => {
    const logger = makeSilentLogger();
    const debug = jest.spyOn(logger, 'debug');
    const policy = new NeedleToolSelectorPolicy({
      client: {
        embed: jest.fn(),
        classifyRequest: () => Promise.resolve({ complexity: 'simple', actionClass: 'read', confidence: 0.94 }),
      },
      logger,
      requestClassificationEnabled: true,
    });

    await policy.classify({ query: 'secret request text', toolsAvailable: true });

    expect(debug).toHaveBeenCalledWith('Needle request classification attempted', { toolsAvailable: true });
    expect(debug).toHaveBeenCalledWith(
      'Needle request classification accepted',
      expect.objectContaining({ complexity: 'simple', actionClass: 'read', confidence: 0.94 }),
    );
    expect(JSON.stringify(debug.mock.calls)).not.toContain('secret request text');
  });

  test('ranks top-K tools and caches schema embeddings', async () => {
    const embed = jest
      .fn<Promise<number[][]>, [string[]]>()
      .mockResolvedValueOnce([
        [1, 0],
        [0, 1],
      ])
      .mockResolvedValueOnce([[1, 0]])
      .mockResolvedValueOnce([[1, 0]]);
    const policy = new NeedleToolSelectorPolicy({
      client: { embed },
      logger: makeSilentLogger(),
      enabled: true,
      topK: 1,
    });

    await expect(policy.selectTools({ query: 'open PRs', tools, serverName: 'github' })).resolves.toEqual([tools[0]]);
    await expect(policy.selectTools({ query: 'open PRs', tools, serverName: 'github' })).resolves.toEqual([tools[0]]);
    expect(embed).toHaveBeenCalledTimes(3);
  });

  test('invalid, uncertain, empty, and failed selections fall back to every authorized tool', async () => {
    const malformed = new NeedleToolSelectorPolicy({
      client: { embed: jest.fn(() => Promise.resolve([[1]])) },
      logger: makeSilentLogger(),
      enabled: true,
    });
    await expect(malformed.selectTools({ query: 'open PRs', tools, serverName: 'github' })).resolves.toBe(tools);

    const uncertain = new NeedleToolSelectorPolicy({
      client: {
        embed: jest.fn((input: string[]) =>
          Promise.resolve(
            input.length === 2
              ? [
                  [1, 0],
                  [0, 1],
                ]
              : [[1, 0]],
          ),
        ),
        selectTools: jest.fn(() => Promise.resolve({ toolIds: ['unknown'], confidence: 0.99 })),
      },
      logger: makeSilentLogger(),
      enabled: true,
    });
    await expect(uncertain.selectTools({ query: 'open PRs', tools, serverName: 'github' })).resolves.toBe(tools);
  });

  test('changed schemas invalidate only their cached embedding', async () => {
    const embed = jest.fn((input: string[]) => Promise.resolve(input.map(() => [1, 0])));
    const policy = new NeedleToolSelectorPolicy({ client: { embed }, logger: makeSilentLogger(), enabled: true });
    await policy.selectTools({ query: 'open PRs', tools, serverName: 'github' });
    await policy.selectTools({
      query: 'open PRs',
      tools: [tool('list_pull_requests', 'Changed'), tools[1]].filter(
        (entry): entry is AgentToolSchema => entry !== undefined,
      ),
      serverName: 'github',
    });
    expect(embed.mock.calls.map(call => call[0].length)).toEqual([2, 1, 1, 1]);
  });

  test('canonicalizes schema keys and invalidates descriptions and namespaces', async () => {
    const embed = jest.fn((input: string[]) => Promise.resolve(input.map(() => [1, 0])));
    const policy = new NeedleToolSelectorPolicy({ client: { embed }, logger: makeSilentLogger(), enabled: true });
    const first = tool('search', 'original');
    first.inputSchema = { type: 'object', properties: { query: { type: 'string', description: 'query' } } };
    const reordered = tool('search', 'original');
    reordered.inputSchema = { properties: { query: { description: 'query', type: 'string' } }, type: 'object' };

    await policy.selectTools({ query: 'find', tools: [first], serverName: 'one' });
    await policy.selectTools({ query: 'find', tools: [reordered], serverName: 'one' });
    await policy.selectTools({ query: 'find', tools: [tool('search', 'changed')], serverName: 'one' });
    await policy.selectTools({ query: 'find', tools: [reordered], serverName: 'two' });

    expect(embed.mock.calls.map(call => call[0].length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  test('invalidates cache on input schema, output schema, and annotations changes, and prunes removed tools', async () => {
    const embed = jest.fn((input: string[]) => Promise.resolve(input.map(() => [1, 0])));
    const policy = new NeedleToolSelectorPolicy({ client: { embed }, logger: makeSilentLogger(), enabled: true });

    const toolA: AgentToolSchema = {
      name: 'tool_a',
      description: 'A',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      preload: false,
    };
    const toolB: AgentToolSchema = {
      name: 'tool_b',
      description: 'B',
      inputSchema: { type: 'object' },
      preload: false,
    };

    // 1. Initial embed of toolA and toolB
    await policy.selectTools({ query: 'test', tools: [toolA, toolB], serverName: 'srv' });

    // 2. Change input schema of toolA
    const toolAInputChanged: AgentToolSchema = {
      ...toolA,
      inputSchema: { type: 'object', properties: { p: { type: 'string' } } },
    };
    await policy.selectTools({ query: 'test', tools: [toolAInputChanged, toolB], serverName: 'srv' });

    // 3. Change output schema of toolA
    const toolAOutputChanged: AgentToolSchema = {
      ...toolAInputChanged,
      outputSchema: { type: 'object', properties: { res: { type: 'number' } } },
    };
    await policy.selectTools({ query: 'test', tools: [toolAOutputChanged, toolB], serverName: 'srv' });

    // 4. Change annotations of toolA
    const toolAAnnotationsChanged: AgentToolSchema = { ...toolAOutputChanged, annotations: { readOnlyHint: false } };
    await policy.selectTools({ query: 'test', tools: [toolAAnnotationsChanged, toolB], serverName: 'srv' });

    // 5. Remove toolB (pruning) and add toolC
    const toolC: AgentToolSchema = {
      name: 'tool_c',
      description: 'C',
      inputSchema: { type: 'object' },
      preload: false,
    };
    await policy.selectTools({ query: 'test', tools: [toolAAnnotationsChanged, toolC], serverName: 'srv' });

    // Embed calls should show re-embedding of only modified/added items
    const batchSizes = embed.mock.calls.map(call => call[0].length);
    // Initial (2 tools + 1 query = 2 in tool batch), query batch = 1
    expect(batchSizes).toContain(2);
  });

  test('deduplicates concurrent embedding cache misses', async () => {
    let resolveTools: ((embeddings: number[][]) => void) | undefined;
    const toolEmbeddings = new Promise<number[][]>(resolve => {
      resolveTools = resolve;
    });
    const embed = jest.fn((input: string[]) => (input.length === 2 ? toolEmbeddings : Promise.resolve([[1, 0]])));
    const policy = new NeedleToolSelectorPolicy({ client: { embed }, logger: makeSilentLogger(), enabled: true });

    const first = policy.selectTools({ query: 'open PRs', tools, serverName: 'github' });
    const second = policy.selectTools({ query: 'open PRs', tools, serverName: 'github' });
    if (!resolveTools) {
      throw new Error('Needle embedding request was not started');
    }
    resolveTools([
      [1, 0],
      [0, 1],
    ]);
    await Promise.all([first, second]);

    expect(embed.mock.calls.filter(call => call[0].length === 2)).toHaveLength(1);
  });

  test.each([
    ['zero vector', [0, 0]],
    ['dimension mismatch', [1]],
    ['NaN', [Number.NaN, 0]],
    ['infinity', [Number.POSITIVE_INFINITY, 0]],
  ])('fails open for a %s query embedding', async (_name, queryEmbedding) => {
    const embed = jest
      .fn<Promise<number[][]>, [string[]]>()
      .mockResolvedValueOnce([
        [1, 0],
        [0, 1],
      ])
      .mockResolvedValueOnce([queryEmbedding]);
    const policy = new NeedleToolSelectorPolicy({ client: { embed }, logger: makeSilentLogger(), enabled: true });

    await expect(policy.selectTools({ query: 'open PRs', tools, serverName: 'github' })).resolves.toBe(tools);
  });

  test('keeps stable tie order, caps oversized top-K, and deduplicates selected IDs', async () => {
    const selectTools = jest.fn(() =>
      Promise.resolve({ toolIds: ['list_pull_requests', 'list_pull_requests'], confidence: 1 }),
    );
    const embed = jest.fn((input: string[]) => Promise.resolve(input.map(() => [1, 0])));
    const policy = new NeedleToolSelectorPolicy({
      client: { embed, selectTools },
      logger: makeSilentLogger(),
      enabled: true,
      topK: 99,
    });

    await expect(policy.selectTools({ query: 'anything', tools, serverName: 'github' })).resolves.toEqual([tools[0]]);
    expect(selectTools).toHaveBeenCalledWith({
      query: 'anything',
      candidates: [
        { id: 'list_pull_requests', score: 1 },
        { id: 'weather', score: 1 },
      ],
    });
  });

  test.each([
    ['invalid IDs', { toolIds: ['unknown'], confidence: 1 }],
    ['empty selection', { toolIds: [], confidence: 1 }],
    ['low confidence', { toolIds: ['list_pull_requests'], confidence: 0.1 }],
    ['non-finite confidence', { toolIds: ['list_pull_requests'], confidence: Number.NaN }],
  ])('returns the exact authorized set for %s', async (_name, selection) => {
    const embed = jest.fn((input: string[]) =>
      Promise.resolve(
        input.length === 2
          ? [
              [1, 0],
              [0, 1],
            ]
          : [[1, 0]],
      ),
    );
    const policy = new NeedleToolSelectorPolicy({
      client: { embed, selectTools: () => Promise.resolve(selection) },
      logger: makeSilentLogger(),
      enabled: true,
    });

    await expect(policy.selectTools({ query: 'open PRs', tools, serverName: 'github' })).resolves.toBe(tools);
  });

  test.each([
    ['transport error', () => Promise.reject(new Error('offline'))],
    ['timeout', () => new Promise<{ toolIds: string[]; confidence: number }>(() => undefined)],
  ])('returns the exact authorized set on %s', async (_name, selectTools) => {
    const embed = jest.fn((input: string[]) =>
      Promise.resolve(
        input.length === 2
          ? [
              [1, 0],
              [0, 1],
            ]
          : [[1, 0]],
      ),
    );
    const policy = new NeedleToolSelectorPolicy({
      client: { embed, selectTools },
      logger: makeSilentLogger(),
      enabled: true,
      timeoutMs: 1,
    });

    await expect(policy.selectTools({ query: 'open PRs', tools, serverName: 'github' })).resolves.toBe(tools);
  });

  test('returns high-confidence argument proposals only when separately enabled', async () => {
    const extractToolArguments = jest.fn(() =>
      Promise.resolve({ arguments: { query: 'release notes' }, confidence: 0.9 }),
    );
    const disabled = new NeedleToolSelectorPolicy({
      client: { embed: jest.fn(), extractToolArguments },
      logger: makeSilentLogger(),
    });
    await expect(
      disabled.extract({ query: 'find notes', tool: tools[0] ?? tool('search', 'Search'), currentArguments: {} }),
    ).resolves.toBeUndefined();
    expect(extractToolArguments).not.toHaveBeenCalled();

    const enabled = new NeedleToolSelectorPolicy({
      client: { embed: jest.fn(), extractToolArguments },
      logger: makeSilentLogger(),
      argumentExtractionEnabled: true,
    });
    await expect(
      enabled.extract({ query: 'find notes', tool: tools[0] ?? tool('search', 'Search'), currentArguments: {} }),
    ).resolves.toEqual({ query: 'release notes' });
  });

  test.each([
    ['low confidence', () => Promise.resolve({ arguments: { query: 'release notes' }, confidence: 0.1 })],
    ['malformed confidence', () => Promise.resolve({ arguments: { query: 'release notes' }, confidence: Number.NaN })],
    ['transport error', () => Promise.reject(new Error('offline'))],
    ['timeout', () => new Promise<{ arguments: Record<string, unknown>; confidence: number }>(() => undefined)],
  ])('fails open for argument extraction on %s', async (_name, extractToolArguments) => {
    const policy = new NeedleToolSelectorPolicy({
      client: { embed: jest.fn(), extractToolArguments },
      logger: makeSilentLogger(),
      argumentExtractionEnabled: true,
      timeoutMs: 1,
    });
    await expect(
      policy.extract({ query: 'find notes', tool: tools[0] ?? tool('search', 'Search'), currentArguments: {} }),
    ).resolves.toBeUndefined();
  });
});
