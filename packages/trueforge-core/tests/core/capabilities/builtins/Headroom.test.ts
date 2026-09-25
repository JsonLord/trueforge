import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import { headroom, type HeadroomClient } from '../../../../src/core/capabilities/builtins/Headroom';
import { makeSilentLogger } from '../../harnessMocks';

const messages: ChatCompletionMessageParam[] = [
  { role: 'system', content: 'protected' },
  { role: 'user', content: 'old repeated context' },
  { role: 'assistant', content: 'recent answer' },
];

function getProcessor(
  client: HeadroomClient,
  overrides: {
    protectRecentTurns?: number;
    timeoutMs?: number;
    logger?: ReturnType<typeof makeSilentLogger>;
  } = {},
) {
  const processor = headroom({
    client,
    logger: overrides.logger ?? makeSilentLogger(),
    enabled: true,
    minInputTokens: 0,
    protectRecentTurns: overrides.protectRecentTurns ?? 1,
    timeoutMs: overrides.timeoutMs,
  }).preLLMEphemeralProcessors?.[0];
  if (!processor) {
    throw new Error('Headroom processor was not configured');
  }
  return processor;
}

describe('Headroom', () => {
  test('is disabled by default', () => {
    const capability = headroom({ client: { optimize: jest.fn() }, logger: makeSilentLogger() });
    expect(capability.preLLMEphemeralProcessors).toBeUndefined();
  });

  test('optimizes only the ephemeral value while preserving protected messages', async () => {
    const optimized = [messages[0], { role: 'user', content: 'short' }, messages[2]].filter(
      (message): message is ChatCompletionMessageParam => message !== undefined,
    );
    const processor = getProcessor({ optimize: jest.fn(() => Promise.resolve({ messages: optimized })) });
    const original = structuredClone(messages);

    await expect(processor.processPreLLMEphemeral(messages)).resolves.toEqual(optimized);
    expect(messages).toEqual(original);
  });

  test('fails open on errors and protected-message changes', async () => {
    const failing = getProcessor({ optimize: jest.fn(() => Promise.reject(new Error('offline'))) });
    await expect(failing.processPreLLMEphemeral(messages)).resolves.toBe(messages);

    const malformed = getProcessor({
      optimize: jest.fn(() => Promise.resolve({ messages: [{ role: 'system', content: 'changed' }] })),
    });
    await expect(malformed.processPreLLMEphemeral(messages)).resolves.toBe(messages);
  });

  test('keeps tool calls and results together even when only the result is recent', async () => {
    const toolMessages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'old request' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'result' },
    ];
    const separated = [toolMessages[0], toolMessages[1], { role: 'user', content: 'inserted' }, toolMessages[2]].filter(
      (message): message is ChatCompletionMessageParam => message !== undefined,
    );
    const processor = getProcessor(
      { optimize: jest.fn(() => Promise.resolve({ messages: separated })) },
      { protectRecentTurns: 1 },
    );

    await expect(processor.processPreLLMEphemeral(toolMessages)).resolves.toBe(toolMessages);
  });

  test('isolates adapter mutation before and after a timeout', async () => {
    let adapterMessages: ChatCompletionMessageParam[] | undefined;
    let resolveOptimization: ((result: { messages: ChatCompletionMessageParam[] }) => void) | undefined;
    const optimization = new Promise<{ messages: ChatCompletionMessageParam[] }>(resolve => {
      resolveOptimization = resolve;
    });
    const logger = makeSilentLogger();
    const warn = jest.spyOn(logger, 'warn');
    const debug = jest.spyOn(logger, 'debug');
    const processor = getProcessor(
      {
        optimize: jest.fn(input => {
          adapterMessages = input.messages;
          const first = input.messages[0];
          if (first) {
            first.content = 'mutated before timeout';
          }
          return optimization;
        }),
      },
      { timeoutMs: 1, logger },
    );
    const original = structuredClone(messages);

    await expect(processor.processPreLLMEphemeral(messages)).resolves.toBe(messages);
    expect(messages).toEqual(original);

    const lateMessages = adapterMessages;
    if (!lateMessages || !resolveOptimization) {
      throw new Error('Headroom adapter was not invoked');
    }
    resolveOptimization({ messages: lateMessages });
    const lateFirst = lateMessages[0];
    if (lateFirst) {
      lateFirst.content = 'mutated after timeout';
    }
    await Promise.resolve();
    expect(messages).toEqual(original);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Headroom context optimization failed open',
      expect.not.objectContaining({ messages: expect.anything() }),
    );
    expect(debug).not.toHaveBeenCalled();
  });
});
