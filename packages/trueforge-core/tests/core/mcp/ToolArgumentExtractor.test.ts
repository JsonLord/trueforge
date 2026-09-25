import type { RawAssistantMessage } from '../../../src/core/llm/LLMTypes';
import type { MappedMCPTool } from '../../../src/core/mcp/convertMCPServers';
import { applyToolArgumentExtraction, type ToolArgumentExtractor } from '../../../src/core/mcp/ToolArgumentExtractor';
import { makeMockIMCPServer, makeSilentLogger } from '../harnessMocks';

const assistantMessage: RawAssistantMessage = {
  role: 'assistant',
  content: null,
  tool_calls: [
    {
      id: 'call-search',
      type: 'function',
      function: { name: 'search', arguments: JSON.stringify({ query: 'main model value' }) },
    },
  ],
};

function mapping(): Map<string, MappedMCPTool> {
  const toolSet = makeMockIMCPServer({ name: 'search-server', preload: true });
  return new Map([
    [
      'search',
      {
        toolSet,
        originalToolName: 'search',
        schema: {
          name: 'search',
          description: 'Search documents',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
          preload: true,
        },
      },
    ],
  ]);
}

async function apply(extractor: ToolArgumentExtractor): Promise<RawAssistantMessage> {
  return applyToolArgumentExtraction({
    assistantMessage,
    toolMapping: mapping(),
    extractor,
    query: 'find the release notes',
    logger: makeSilentLogger(),
  });
}

describe('applyToolArgumentExtraction', () => {
  test('accepts a schema-valid proposal before the tool call is persisted', async () => {
    const result = await apply({ extract: () => Promise.resolve({ query: 'release notes' }) });
    expect(result.tool_calls?.[0]?.function.arguments).toBe(JSON.stringify({ query: 'release notes' }));
  });

  test.each([
    ['missing required field', {}],
    ['wrong field type', { query: 42 }],
    ['additional field', { query: 'release notes', unsafe: true }],
  ])('keeps the main-model arguments for a proposal with %s', async (_name, arguments_) => {
    const result = await apply({ extract: () => Promise.resolve(arguments_) });
    expect(result).toEqual(assistantMessage);
  });

  test('fails open when extraction rejects', async () => {
    const result = await apply({ extract: () => Promise.reject(new Error('offline')) });
    expect(result).toEqual(assistantMessage);
  });
});
