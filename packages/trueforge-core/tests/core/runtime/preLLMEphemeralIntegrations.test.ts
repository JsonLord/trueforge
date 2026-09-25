import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import type { AgentCapability } from '../../../src/core/capabilities/AgentCapability';
import { shadowFastPathAdmission } from '../../../src/core/capabilities/FastPathAdmission';
import { headroom } from '../../../src/core/capabilities/builtins/Headroom';
import { EventType } from '../../../src/core/events/schema';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import type { ToolSource } from '../../../src/core/mcp/IMCPServer';
import { toolResultResponse } from '../../../src/core/mcp/IMCPServer';
import { needleToolSelection } from '../../../src/core/mcp/NeedleToolSelectorPolicy';
import { ToolSet } from '../../../src/core/mcp/ToolSet';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import type { AgentThreadSendBatch } from '../../../src/core/runtime/AgentThread.types';
import { AgentThreadOrchestrator } from '../../../src/core/runtime/AgentThreadOrchestrator';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import {
  llmCreateInputs,
  makeApprovalGatedWriteNoteToolSet,
  runTurn,
  textReplyStream,
  WRITE_NOTE_CALL_ID,
  writeNoteToolCallStream,
} from '../../orchestration/helpers/helpers';
import { makeMockILLM, makeMockIMCPServer, makeSilentLogger, OBJECT_INPUT_SCHEMA } from '../harnessMocks';

function createThread(params: {
  capabilities: AgentCapability[];
  modelClient: ReturnType<typeof makeMockILLM>;
  toolSets?: ReturnType<typeof makeMockIMCPServer>[] | undefined;
}): AgentThread {
  return new AgentThread({
    definition: {
      modelClient: params.modelClient,
      instruction: 'system instruction',
      messages: undefined,
      modelParams: undefined,
      responseFormat: undefined,
      iterationLimit: undefined,
      toolSets: params.toolSets,
    },
    threadId: 'main',
    title: 'ephemeral integrations',
    parent: undefined,
    agentInfo: undefined,
    context: undefined,
    currentContextUsage: undefined,
    preComputedCompletion: undefined,
    sandbox: undefined,
    capabilities: params.capabilities,
    capabilityState: undefined,
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  });
}

function orchestrator(thread: AgentThread): AgentThreadOrchestrator {
  return new AgentThreadOrchestrator({
    agentThreads: new Map([[thread.threadId, thread]]),
    createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  });
}

async function* listToolsCallStream() {
  await Promise.resolve();
  const toolCall = {
    id: 'call-list',
    type: 'function' as const,
    function: {
      name: 'list_tools',
      arguments: JSON.stringify({ mcp_server: 'github', query: 'find open pull requests' }),
    },
  };
  yield {
    id: 'chunk-list',
    object: 'chat.completion.chunk' as const,
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: { role: 'assistant' as const, tool_calls: [{ index: 0, ...toolCall }] } }],
  };
  return {
    output: { role: 'assistant' as const, content: null, tool_calls: [toolCall] },
    usage: getEmptyUsage(),
    finish_reason: 'tool_calls' as const,
  };
}

async function* gitStatusCallStream() {
  await Promise.resolve();
  const toolCall = {
    id: 'call-status',
    type: 'function' as const,
    function: { name: 'git_status', arguments: '{}' },
  };
  yield {
    id: 'chunk-status',
    object: 'chat.completion.chunk' as const,
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: { role: 'assistant' as const, tool_calls: [{ index: 0, ...toolCall }] } }],
  };
  return {
    output: { role: 'assistant' as const, content: null, tool_calls: [toolCall] },
    usage: getEmptyUsage(),
    finish_reason: 'tool_calls' as const,
  };
}

function makeGitStatusToolSet(): { toolSet: ToolSet; callTool: jest.Mock } {
  const callTool = jest.fn(() => Promise.resolve(toolResultResponse({ text: 'clean' })));
  const source: ToolSource = {
    name: 'git',
    id: 'git',
    listTools: () =>
      Promise.resolve({
        result: {
          tools: [
            {
              name: 'git_status',
              description: 'Show repository status',
              inputSchema: OBJECT_INPUT_SCHEMA,
              preload: true,
            },
          ],
        },
        wasInitialized: undefined,
      }),
    callTool,
    toolCallInfo: () =>
      Promise.resolve({
        type: 'mcp',
        mcp_server_id: 'git',
        mcp_server_name: 'git',
        original_tool_name: 'git_status',
      }),
  };
  return {
    toolSet: new ToolSet({
      source,
      selectors: {
        enableTools: ['@all'],
        disableTools: [],
        preloadTools: [],
        requireApprovalForTools: [],
      },
      preload: true,
    }),
    callTool,
  };
}

describe('preLLMEphemeral integrations', () => {
  test('shadow admission observes an eligible normal execution without changing behavior', async () => {
    const disabledTool = makeGitStatusToolSet();
    const enabledTool = makeGitStatusToolSet();
    const disabledModel = makeMockILLM({
      create: jest
        .fn()
        .mockImplementationOnce(() => gitStatusCallStream())
        .mockImplementationOnce(() => textReplyStream('done')),
    });
    const enabledModel = makeMockILLM({
      create: jest
        .fn()
        .mockImplementationOnce(() => gitStatusCallStream())
        .mockImplementationOnce(() => textReplyStream('done')),
    });
    const classificationCapability = () =>
      needleToolSelection({
        client: {
          embed: jest.fn(),
          classifyRequest: () => Promise.resolve({ complexity: 'simple', actionClass: 'read', confidence: 0.98 }),
        },
        logger: makeSilentLogger(),
        requestClassificationEnabled: true,
      });
    const disabledThread = createThread({
      modelClient: disabledModel,
      toolSets: [disabledTool.toolSet],
      capabilities: [classificationCapability(), shadowFastPathAdmission({ shadowEnabled: false })],
    });
    const enabledThread = createThread({
      modelClient: enabledModel,
      toolSets: [enabledTool.toolSet],
      capabilities: [
        classificationCapability(),
        shadowFastPathAdmission({
          shadowEnabled: true,
          eligibleTools: [{ serverId: 'git', toolName: 'git_status' }],
        }),
      ],
    });
    const sendBatch: AgentThreadSendBatch = [{ type: EventType.USER_MESSAGE, content: 'Show git status.' }];

    const disabledRun = await runTurn({ orchestrator: orchestrator(disabledThread), sendBatch });
    const enabledRun = await runTurn({ orchestrator: orchestrator(enabledThread), sendBatch });

    expect(llmCreateInputs(enabledModel)).toEqual(llmCreateInputs(disabledModel));
    expect(enabledRun.events.map(event => event.type)).toEqual(disabledRun.events.map(event => event.type));
    expect(enabledRun.result).toMatchObject({
      required_actions: disabledRun.result.required_actions,
      root_agent_error: disabledRun.result.root_agent_error,
      output: expect.objectContaining({ content: 'done' }),
    });
    expect(
      enabledRun.events.filter(event => event.type === EventType.TOOL_RESPONSE).map(event => event.content),
    ).toEqual(disabledRun.events.filter(event => event.type === EventType.TOOL_RESPONSE).map(event => event.content));
    expect(enabledThread.toSnapshot()).toEqual(disabledThread.toSnapshot());
    expect(enabledTool.callTool.mock.calls).toEqual(disabledTool.callTool.mock.calls);
    expect(enabledTool.callTool).toHaveBeenCalledTimes(1);
    expect(disabledThread.getRequestMetadata().fastPathAdmission).toBeUndefined();
    expect(enabledThread.getRequestMetadata()).toEqual({
      classification: { complexity: 'simple', actionClass: 'read', confidence: 0.98 },
      fastPathAdmission: { evaluated: true, eligible: true, reasons: ['eligible'] },
    });
  });

  test('classification is request metadata only and leaves otherwise identical runs unchanged', async () => {
    const disabledModel = makeMockILLM({ create: jest.fn(() => textReplyStream('done')) });
    const enabledModel = makeMockILLM({ create: jest.fn(() => textReplyStream('done')) });
    const disabledClassifier = jest.fn(() =>
      Promise.resolve({ complexity: 'simple', actionClass: 'read', confidence: 0.95 }),
    );
    const disabledThread = createThread({
      modelClient: disabledModel,
      capabilities: [
        needleToolSelection({
          client: { embed: jest.fn(), classifyRequest: disabledClassifier },
          logger: makeSilentLogger(),
        }),
      ],
    });
    const enabledThread = createThread({
      modelClient: enabledModel,
      capabilities: [
        needleToolSelection({
          client: {
            embed: jest.fn(),
            classifyRequest: () => Promise.resolve({ complexity: 'simple', actionClass: 'read', confidence: 0.95 }),
          },
          logger: makeSilentLogger(),
          requestClassificationEnabled: true,
        }),
      ],
    });
    const sendBatch: AgentThreadSendBatch = [{ type: EventType.USER_MESSAGE, content: 'Show git status.' }];

    const disabledRun = await runTurn({ orchestrator: orchestrator(disabledThread), sendBatch });
    const enabledRun = await runTurn({ orchestrator: orchestrator(enabledThread), sendBatch });

    expect(llmCreateInputs(enabledModel)).toEqual(llmCreateInputs(disabledModel));
    expect(enabledRun.events.map(event => event.type)).toEqual(disabledRun.events.map(event => event.type));
    expect(enabledRun.result).toMatchObject({
      required_actions: disabledRun.result.required_actions,
      root_agent_error: disabledRun.result.root_agent_error,
      output: expect.objectContaining({ content: 'done' }),
    });
    expect(enabledThread.toSnapshot()).toEqual(disabledThread.toSnapshot());
    expect(disabledThread.getRequestMetadata()).toEqual({
      classification: undefined,
      fastPathAdmission: undefined,
    });
    expect(disabledClassifier).not.toHaveBeenCalled();
    expect(enabledThread.getRequestMetadata()).toEqual({
      classification: { complexity: 'simple', actionClass: 'read', confidence: 0.95 },
      fastPathAdmission: undefined,
    });
  });

  test.each([
    ['transport error', () => Promise.reject(new Error('offline'))],
    ['timeout', () => new Promise<unknown>(() => undefined)],
  ])('classification %s preserves the normal model flow', async (_name, classifyRequest) => {
    const modelClient = makeMockILLM({ create: jest.fn(() => textReplyStream('done')) });
    const thread = createThread({
      modelClient,
      capabilities: [
        needleToolSelection({
          client: { embed: jest.fn(), classifyRequest },
          logger: makeSilentLogger(),
          requestClassificationEnabled: true,
          timeoutMs: 1,
        }),
      ],
    });

    const result = await runTurn({
      orchestrator: orchestrator(thread),
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'Show git status.' }],
    });

    expect(result.result.root_agent_error).toBeUndefined();
    expect(llmCreateInputs(modelClient)).toHaveLength(1);
    expect(thread.getRequestMetadata()).toEqual({
      classification: { complexity: 'unknown', actionClass: 'unknown', confidence: 0 },
      fastPathAdmission: undefined,
    });
  });

  test('mixes synchronous and asynchronous processors in order after a fail-open Headroom processor', async () => {
    const order: string[] = [];
    const modelClient = makeMockILLM({ create: jest.fn(() => textReplyStream('done')) });
    const thread = createThread({
      modelClient,
      capabilities: [
        {
          preLLMEphemeralProcessors: [
            {
              processPreLLMEphemeral: input => {
                order.push('sync');
                return [...input, { role: 'user', content: 'sync' }];
              },
            },
          ],
        },
        headroom({
          client: {
            optimize: () => {
              order.push('headroom');
              return Promise.reject(new Error('offline'));
            },
          },
          enabled: true,
          logger: makeSilentLogger(),
          minInputTokens: 0,
        }),
        {
          preLLMEphemeralProcessors: [
            {
              processPreLLMEphemeral: async input => {
                await Promise.resolve();
                order.push('async');
                return [...input, { role: 'user', content: 'async' }];
              },
            },
          ],
        },
      ],
    });

    await runTurn({
      orchestrator: orchestrator(thread),
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'original' }],
    });

    expect(order).toEqual(['sync', 'headroom', 'async']);
    expect(llmCreateInputs(modelClient)[0]).toMatchObject({
      messages: expect.arrayContaining([
        { role: 'user', content: 'sync' },
        { role: 'user', content: 'async' },
      ]),
    });
    expect(thread.toSnapshot().context).not.toEqual(
      expect.arrayContaining([
        { role: 'user', content: 'sync' },
        { role: 'user', content: 'async' },
      ]),
    );
  });

  test('runs Needle discovery and Headroom optimization without changing canonical history or execution policy', async () => {
    const server = makeMockIMCPServer({
      name: 'github',
      preload: false,
      tools: [
        {
          name: 'list_pull_requests',
          description: 'Find open pull requests',
          inputSchema: OBJECT_INPUT_SCHEMA,
          preload: false,
        },
        { name: 'weather', description: 'Read weather', inputSchema: OBJECT_INPUT_SCHEMA, preload: false },
      ],
    });
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
    const extractToolArguments = jest.fn(() =>
      Promise.resolve({
        arguments: { mcp_server: 'github', query: 'open pull requests' },
        confidence: 0.99,
      }),
    );
    const classifyRequest = jest.fn(() =>
      Promise.resolve({ complexity: 'simple', actionClass: 'read', confidence: 0.96 }),
    );
    const optimize = jest.fn((input: { messages: ChatCompletionMessageParam[] }) =>
      Promise.resolve({
        messages: input.messages.map(message =>
          message.role === 'user' ? { ...message, content: 'compressed request' } : message,
        ),
      }),
    );
    const modelClient = makeMockILLM({
      create: jest
        .fn()
        .mockImplementationOnce(() => listToolsCallStream())
        .mockImplementationOnce(() => textReplyStream('done')),
    });
    const thread = createThread({
      modelClient,
      toolSets: [server],
      capabilities: [
        needleToolSelection({
          client: { embed, extractToolArguments, classifyRequest },
          enabled: true,
          argumentExtractionEnabled: true,
          requestClassificationEnabled: true,
          logger: makeSilentLogger(),
          topK: 1,
        }),
        headroom({
          client: { optimize },
          enabled: true,
          logger: makeSilentLogger(),
          minInputTokens: 0,
          protectRecentTurns: 0,
        }),
        shadowFastPathAdmission({
          shadowEnabled: true,
          eligibleTools: [{ serverId: 'deferred-tools', toolName: 'list_tools' }],
        }),
      ],
    });

    await runTurn({
      orchestrator: orchestrator(thread),
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'find open pull requests in this repository' }],
    });

    const requests = llmCreateInputs(modelClient);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toContain('list_pull_requests');
    expect(JSON.stringify(requests[1])).not.toContain('weather');
    expect(JSON.stringify(requests[1])).toContain('compressed request');
    expect(JSON.stringify(requests[1])).toContain('call-list');
    expect(extractToolArguments).toHaveBeenCalledTimes(1);
    expect(classifyRequest).toHaveBeenCalledWith({
      query: 'find open pull requests in this repository',
      toolsAvailable: true,
    });
    expect(thread.getRequestMetadata()).toEqual({
      classification: { complexity: 'simple', actionClass: 'read', confidence: 0.96 },
      fastPathAdmission: { evaluated: true, eligible: true, reasons: ['eligible'] },
    });
    expect(JSON.stringify(thread.toSnapshot().context)).toContain('open pull requests');
    expect(thread.toSnapshot().context).toEqual(
      expect.arrayContaining([{ role: 'user', content: 'find open pull requests in this repository' }]),
    );
    expect(JSON.stringify(thread.toSnapshot().context)).not.toContain('compressed request');
    expect(server.callTool).not.toHaveBeenCalled();
  });

  test('persists validated extracted arguments before approval and executes exactly those arguments after allow', async () => {
    const { toolSet, callTool } = makeApprovalGatedWriteNoteToolSet();
    const extractToolArguments = jest.fn(() =>
      Promise.resolve({ arguments: { text: 'extracted text' }, confidence: 0.99 }),
    );
    const classifyRequest = jest.fn(() =>
      Promise.resolve({ complexity: 'simple', actionClass: 'read', confidence: 0.99 }),
    );
    const modelClient = makeMockILLM({
      create: jest
        .fn()
        .mockImplementationOnce(() => writeNoteToolCallStream())
        .mockImplementationOnce(() => textReplyStream('done')),
    });
    const thread = createThread({
      modelClient,
      toolSets: [toolSet],
      capabilities: [
        needleToolSelection({
          client: { embed: jest.fn(), extractToolArguments, classifyRequest },
          argumentExtractionEnabled: true,
          requestClassificationEnabled: true,
          logger: makeSilentLogger(),
        }),
        shadowFastPathAdmission({
          shadowEnabled: true,
          eligibleTools: [{ serverId: 'notes', toolName: 'write_note' }],
        }),
      ],
    });
    const threadOrchestrator = orchestrator(thread);

    await runTurn({
      orchestrator: threadOrchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'write the extracted text' }],
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(thread.getRequestMetadata()).toEqual({
      classification: { complexity: 'simple', actionClass: 'read', confidence: 0.99 },
      fastPathAdmission: { evaluated: true, eligible: false, reasons: ['approval_required'] },
    });
    expect(thread.toSnapshot().context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          tool_calls: expect.arrayContaining([
            expect.objectContaining({
              function: expect.objectContaining({ arguments: JSON.stringify({ text: 'extracted text' }) }),
            }),
          ]),
        }),
      ]),
    );

    await runTurn({
      orchestrator: threadOrchestrator,
      sendBatch: [
        {
          type: EventType.USER_TOOL_APPROVAL,
          thread_id: thread.threadId,
          tool_call_id: WRITE_NOTE_CALL_ID,
          approval: { status: 'allow' },
        },
      ],
    });
    expect(extractToolArguments).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(
      { name: 'write_note', arguments: { text: 'extracted text' } },
      { status: 'allow' },
    );
  });
});
