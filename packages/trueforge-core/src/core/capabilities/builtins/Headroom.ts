import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../../util/errorLogFields';
import { withTimeout } from '../../util/promiseUtils';
import type { AgentCapability } from '../AgentCapability';
import type { PreLLMEphemeralAgentContextProcessor } from '../AgentContextProcessor';

export interface HeadroomOptimizeInput {
  messages: ChatCompletionMessageParam[];
  mode: 'cache' | 'token';
  protectedMessageIndexes: number[];
}

export interface HeadroomOptimizeResult {
  messages: ChatCompletionMessageParam[];
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}

export interface HeadroomClient {
  optimize(input: HeadroomOptimizeInput): Promise<HeadroomOptimizeResult>;
}

export interface HeadroomOptions {
  client: HeadroomClient;
  logger: Logger;
  enabled?: boolean | undefined;
  mode?: 'cache' | 'token' | undefined;
  minInputTokens?: number | undefined;
  protectRecentTurns?: number | undefined;
  timeoutMs?: number | undefined;
}

function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

function cloneMessages(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  return structuredClone(messages);
}

function protectedIndexes(messages: ChatCompletionMessageParam[], recentCount: number): number[] {
  const firstRecent = Math.max(0, messages.length - recentCount);
  return messages.flatMap((message, index) =>
    message.role === 'system' || message.role === 'tool' || 'tool_calls' in message || index >= firstRecent
      ? [index]
      : [],
  );
}

function toolInteractionBlocks(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[][] {
  const blocks: ChatCompletionMessageParam[][] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message || !('tool_calls' in message)) {
      continue;
    }
    const block: ChatCompletionMessageParam[] = [message];
    let resultIndex = index + 1;
    while (messages[resultIndex]?.role === 'tool') {
      const result = messages[resultIndex];
      if (result) {
        block.push(result);
      }
      resultIndex++;
    }
    blocks.push(block);
  }
  return blocks;
}

function containsContiguousBlock(messages: ChatCompletionMessageParam[], block: ChatCompletionMessageParam[]): boolean {
  const serializedBlock = block.map(message => JSON.stringify(message));
  return messages.some((_, start) =>
    serializedBlock.every((serialized, offset) => JSON.stringify(messages[start + offset]) === serialized),
  );
}

function preservesProtectedMessages(params: {
  original: ChatCompletionMessageParam[];
  optimized: ChatCompletionMessageParam[];
  protectedMessageIndexes: number[];
}): boolean {
  const originalStructured = params.original.filter(
    message => message.role === 'system' || message.role === 'tool' || 'tool_calls' in message,
  );
  const optimizedStructured = params.optimized.filter(
    message => message.role === 'system' || message.role === 'tool' || 'tool_calls' in message,
  );
  if (JSON.stringify(originalStructured) !== JSON.stringify(optimizedStructured)) {
    return false;
  }
  if (!toolInteractionBlocks(params.original).every(block => containsContiguousBlock(params.optimized, block))) {
    return false;
  }

  let optimizedIndex = 0;
  for (const originalIndex of params.protectedMessageIndexes) {
    const original = params.original[originalIndex];
    if (!original) {
      return false;
    }
    const serialized = JSON.stringify(original);
    while (
      optimizedIndex < params.optimized.length &&
      JSON.stringify(params.optimized[optimizedIndex]) !== serialized
    ) {
      optimizedIndex++;
    }
    if (optimizedIndex === params.optimized.length) {
      return false;
    }
    optimizedIndex++;
  }
  return true;
}

class HeadroomContextProcessor implements PreLLMEphemeralAgentContextProcessor {
  constructor(
    private readonly options: Required<Pick<HeadroomOptions, 'client' | 'logger'>> & {
      mode: 'cache' | 'token';
      minInputTokens: number;
      protectRecentTurns: number;
      timeoutMs: number;
    },
  ) {}

  async processPreLLMEphemeral(input: ChatCompletionMessageParam[]): Promise<ChatCompletionMessageParam[]> {
    const inputTokens = estimateTokens(input);
    if (inputTokens < this.options.minInputTokens) {
      return input;
    }
    const startedAt = Date.now();
    const protectedMessageIndexes = protectedIndexes(input, this.options.protectRecentTurns);
    try {
      // The adapter receives and returns isolated values so timeout races cannot mutate the active request.
      const adapterInput = cloneMessages(input);
      const result = await withTimeout(
        this.options.client.optimize({
          messages: adapterInput,
          mode: this.options.mode,
          protectedMessageIndexes: [...protectedMessageIndexes],
        }),
        this.options.timeoutMs,
        'Headroom optimization',
      );
      const optimized = cloneMessages(result.messages);
      if (!preservesProtectedMessages({ original: input, optimized, protectedMessageIndexes })) {
        this.options.logger.warn('Headroom returned context that changed protected messages; using original context');
        return input;
      }
      this.options.logger.debug('Headroom context optimization completed', {
        inputTokens: result.inputTokens ?? inputTokens,
        outputTokens: result.outputTokens ?? estimateTokens(optimized),
        latencyMs: Date.now() - startedAt,
        mode: this.options.mode,
      });
      return optimized;
    } catch (error) {
      this.options.logger.warn('Headroom context optimization failed open', {
        ...extractErrorLogFields(error),
        latencyMs: Date.now() - startedAt,
      });
      return input;
    }
  }
}

export function headroom(options: HeadroomOptions): AgentCapability {
  if (options.enabled !== true) {
    return {};
  }
  return {
    preLLMEphemeralProcessors: [
      new HeadroomContextProcessor({
        client: options.client,
        logger: options.logger.child({ module: 'Headroom' }),
        mode: options.mode ?? 'cache',
        minInputTokens: options.minInputTokens ?? 4000,
        protectRecentTurns: options.protectRecentTurns ?? 4,
        timeoutMs: options.timeoutMs ?? 3000,
      }),
    ],
  };
}
