import { createHash } from 'node:crypto';
import type { Logger } from 'winston';
import type {
  RequestActionClass,
  RequestClassification,
  RequestClassifier,
  RequestComplexity,
} from '../capabilities/RequestClassifier';
import { extractErrorLogFields } from '../util/errorLogFields';
import { PromiseTimeoutError, withTimeout } from '../util/promiseUtils';
import type { AgentToolSchema } from './IMCPServer';
import type { ToolArgumentExtractor } from './ToolArgumentExtractor';
import type { DeferredToolSelectorPolicy } from './ToolSelectorPolicy';

export interface NeedleClient {
  embed(input: string[]): Promise<number[][]>;
  selectTools?(input: { query: string; candidates: { id: string; score: number }[] }): Promise<{
    toolIds: string[];
    confidence: number;
  }>;
  extractToolArguments?(input: {
    query: string;
    tool: { name: string; description: string | undefined; inputSchema: AgentToolSchema['inputSchema'] };
    currentArguments: Record<string, unknown>;
  }): Promise<{ arguments: Record<string, unknown>; confidence: number }>;
  classifyRequest?(input: { query: string; toolsAvailable: boolean }): Promise<unknown>;
}

export interface NeedleToolSelectorOptions {
  client: NeedleClient;
  logger: Logger;
  enabled?: boolean | undefined;
  topK?: number | undefined;
  minConfidence?: number | undefined;
  timeoutMs?: number | undefined;
  argumentExtractionEnabled?: boolean | undefined;
  minArgumentConfidence?: number | undefined;
  requestClassificationEnabled?: boolean | undefined;
  minClassificationConfidence?: number | undefined;
}

const REQUEST_COMPLEXITIES: readonly RequestComplexity[] = ['simple', 'reasoning', 'unknown'];
const REQUEST_ACTION_CLASSES: readonly RequestActionClass[] = [
  'read',
  'write',
  'destructive',
  'external_side_effect',
  'unknown',
];

const UNKNOWN_CLASSIFICATION: RequestClassification = {
  complexity: 'unknown',
  actionClass: 'unknown',
  confidence: 0,
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestComplexity(value: unknown): value is RequestComplexity {
  return typeof value === 'string' && REQUEST_COMPLEXITIES.some(candidate => candidate === value);
}

function isRequestActionClass(value: unknown): value is RequestActionClass {
  return typeof value === 'string' && REQUEST_ACTION_CLASSES.some(candidate => candidate === value);
}

function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function toolDocument(tool: AgentToolSchema): string {
  return canonicalJson({
    annotations: tool.annotations,
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
    outputSchema: tool.outputSchema,
  });
}

function fingerprint(document: string): string {
  return createHash('sha256').update(document).digest('hex');
}

function toolCacheKey(params: { serverName: string; toolName: string }): string {
  return canonicalJson([params.serverName, params.toolName]);
}

function cosine(left: number[], right: number[]): number | undefined {
  if (
    left.length === 0 ||
    left.length !== right.length ||
    left.some(value => !Number.isFinite(value)) ||
    right.some(value => !Number.isFinite(value))
  ) {
    return undefined;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) {
      return undefined;
    }
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? undefined : dot / denominator;
}

export class NeedleToolSelectorPolicy implements DeferredToolSelectorPolicy, ToolArgumentExtractor, RequestClassifier {
  private readonly cache = new Map<string, { serverName: string; fingerprint: string; embedding: number[] }>();
  private readonly inFlight = new Map<
    string,
    { serverName: string; fingerprint: string; embedding: Promise<number[] | undefined> }
  >();

  constructor(private readonly options: NeedleToolSelectorOptions) {}

  async classify(input: { query: string; toolsAvailable: boolean }): Promise<RequestClassification> {
    if (this.options.requestClassificationEnabled !== true || !this.options.client.classifyRequest) {
      return UNKNOWN_CLASSIFICATION;
    }
    const startedAt = Date.now();
    this.options.logger.debug('Needle request classification attempted', { toolsAvailable: input.toolsAvailable });
    try {
      const result = await withTimeout(
        this.options.client.classifyRequest(input),
        this.options.timeoutMs ?? 3000,
        'Needle request classification',
      );
      if (!isJsonObject(result)) {
        this.logClassificationRejected({ startedAt, fallbackReason: 'malformed' });
        return UNKNOWN_CLASSIFICATION;
      }
      const confidence = result['confidence'];
      const complexity = result['complexity'];
      const actionClass = result['actionClass'];
      const validConfidence =
        typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
      if (!validConfidence || !isRequestComplexity(complexity) || !isRequestActionClass(actionClass)) {
        this.logClassificationRejected({ startedAt, fallbackReason: 'malformed' });
        return UNKNOWN_CLASSIFICATION;
      }
      if (confidence < (this.options.minClassificationConfidence ?? 0.7)) {
        this.logClassificationRejected({ startedAt, fallbackReason: 'low_confidence', confidence });
        return { ...UNKNOWN_CLASSIFICATION, confidence };
      }
      const classification: RequestClassification = {
        complexity,
        actionClass,
        confidence,
      };
      this.options.logger.debug('Needle request classification accepted', {
        accepted: true,
        ...classification,
        latencyMs: Date.now() - startedAt,
      });
      return classification;
    } catch (error) {
      this.logClassificationRejected({
        startedAt,
        fallbackReason: error instanceof PromiseTimeoutError ? 'timeout' : 'transport_error',
      });
      return UNKNOWN_CLASSIFICATION;
    }
  }

  private logClassificationRejected(params: {
    startedAt: number;
    fallbackReason: 'low_confidence' | 'malformed' | 'timeout' | 'transport_error';
    confidence?: number | undefined;
  }): void {
    this.options.logger.debug('Needle request classification rejected', {
      accepted: false,
      complexity: 'unknown',
      actionClass: 'unknown',
      confidence: params.confidence ?? 0,
      fallbackReason: params.fallbackReason,
      latencyMs: Date.now() - params.startedAt,
    });
  }

  async extract(input: {
    query: string;
    tool: AgentToolSchema;
    currentArguments: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    if (this.options.argumentExtractionEnabled !== true || !this.options.client.extractToolArguments) {
      return undefined;
    }
    const startedAt = Date.now();
    try {
      const result = await withTimeout(
        this.options.client.extractToolArguments({
          query: input.query,
          tool: { name: input.tool.name, description: input.tool.description, inputSchema: input.tool.inputSchema },
          currentArguments: input.currentArguments,
        }),
        this.options.timeoutMs ?? 3000,
        'Needle tool argument extraction',
      );
      if (!Number.isFinite(result.confidence) || result.confidence < (this.options.minArgumentConfidence ?? 0.7)) {
        return undefined;
      }
      this.options.logger.debug('Needle tool argument extraction completed', {
        serverToolName: input.tool.name,
        confidence: result.confidence,
        latencyMs: Date.now() - startedAt,
      });
      return result.arguments;
    } catch (error) {
      this.options.logger.warn('Needle tool argument extraction failed open', {
        ...extractErrorLogFields(error),
        toolName: input.tool.name,
        latencyMs: Date.now() - startedAt,
      });
      return undefined;
    }
  }

  async selectTools(input: {
    query: string;
    tools: AgentToolSchema[];
    serverName: string;
  }): Promise<AgentToolSchema[]> {
    if (this.options.enabled !== true || input.tools.length === 0) {
      return input.tools;
    }
    const startedAt = Date.now();
    try {
      const documents = input.tools.map(toolDocument);
      const currentKeys = new Set(
        input.tools.map(tool => toolCacheKey({ serverName: input.serverName, toolName: tool.name })),
      );
      for (const [key, cached] of this.cache) {
        if (cached.serverName === input.serverName && !currentKeys.has(key)) {
          this.cache.delete(key);
        }
      }
      const missingIndexes = documents.flatMap((document, index) => {
        const tool = input.tools[index];
        if (!tool) {
          return [];
        }
        const key = toolCacheKey({ serverName: input.serverName, toolName: tool.name });
        const documentFingerprint = fingerprint(document);
        const cached = this.cache.get(key);
        const pending = this.inFlight.get(key);
        return cached?.fingerprint === documentFingerprint || pending?.fingerprint === documentFingerprint
          ? []
          : [index];
      });
      if (missingIndexes.length > 0) {
        const batch = withTimeout(
          this.options.client.embed(missingIndexes.map(index => documents[index] ?? '')),
          this.options.timeoutMs ?? 3000,
          'Needle tool embeddings',
        );
        missingIndexes.forEach((toolIndex, embeddingIndex) => {
          const tool = input.tools[toolIndex];
          const document = documents[toolIndex];
          if (tool && document) {
            const key = toolCacheKey({ serverName: input.serverName, toolName: tool.name });
            const documentFingerprint = fingerprint(document);
            const embedding = batch.then(embeddings =>
              embeddings.length === missingIndexes.length ? embeddings[embeddingIndex] : undefined,
            );
            this.inFlight.set(key, { serverName: input.serverName, fingerprint: documentFingerprint, embedding });
            const clearPending = () => {
              if (this.inFlight.get(key)?.embedding === embedding) {
                this.inFlight.delete(key);
              }
            };
            void embedding.then(clearPending, clearPending);
          }
        });
      }
      for (let index = 0; index < input.tools.length; index++) {
        const tool = input.tools[index];
        const document = documents[index];
        if (!tool || !document) {
          return input.tools;
        }
        const key = toolCacheKey({ serverName: input.serverName, toolName: tool.name });
        const documentFingerprint = fingerprint(document);
        if (this.cache.get(key)?.fingerprint === documentFingerprint) {
          continue;
        }
        const pending = this.inFlight.get(key);
        if (pending?.fingerprint !== documentFingerprint) {
          return input.tools;
        }
        const embedding = await pending.embedding;
        if (!embedding) {
          return input.tools;
        }
        this.cache.set(key, { serverName: input.serverName, fingerprint: documentFingerprint, embedding });
      }
      const queryEmbeddings = await withTimeout(
        this.options.client.embed([input.query]),
        this.options.timeoutMs ?? 3000,
        'Needle query embedding',
      );
      const queryEmbedding = queryEmbeddings[0];
      if (!queryEmbedding) {
        return input.tools;
      }
      const ranked = input.tools
        .flatMap(tool => {
          const key = toolCacheKey({ serverName: input.serverName, toolName: tool.name });
          const score = cosine(queryEmbedding, this.cache.get(key)?.embedding ?? []);
          return score === undefined ? [] : [{ tool, score }];
        })
        .sort((left, right) => right.score - left.score);
      if (ranked.length !== input.tools.length) {
        return input.tools;
      }
      const candidates = ranked.slice(0, Math.max(1, this.options.topK ?? 8));
      let selected = candidates;
      let confidence = candidates[0]?.score ?? 0;
      if (this.options.client.selectTools) {
        const response = await withTimeout(
          this.options.client.selectTools({
            query: input.query,
            candidates: candidates.map(({ tool, score }) => ({ id: tool.name, score })),
          }),
          this.options.timeoutMs ?? 3000,
          'Needle tool selection',
        );
        const ids = new Set(response.toolIds);
        selected = candidates.filter(candidate => ids.has(candidate.tool.name));
        confidence = response.confidence;
      }
      if (selected.length === 0 || !Number.isFinite(confidence) || confidence < (this.options.minConfidence ?? 0.35)) {
        return input.tools;
      }
      this.options.logger.debug('Needle tool selection completed', {
        serverName: input.serverName,
        beforeCount: input.tools.length,
        afterCount: selected.length,
        confidence,
        cacheMisses: missingIndexes.length,
        latencyMs: Date.now() - startedAt,
      });
      return selected.map(candidate => candidate.tool);
    } catch (error) {
      this.options.logger.warn('Needle tool selection failed open', {
        ...extractErrorLogFields(error),
        serverName: input.serverName,
        latencyMs: Date.now() - startedAt,
      });
      return input.tools;
    }
  }
}

export function needleToolSelection(
  options: NeedleToolSelectorOptions,
): import('../capabilities/AgentCapability').AgentCapability {
  options.logger.debug(
    options.requestClassificationEnabled === true
      ? 'Needle request classification enabled'
      : 'Needle request classification disabled',
  );
  if (
    options.enabled !== true &&
    options.argumentExtractionEnabled !== true &&
    options.requestClassificationEnabled !== true
  ) {
    return {};
  }
  const policy = new NeedleToolSelectorPolicy(options);
  return {
    ...(options.enabled === true ? { deferredToolSelectorPolicy: policy } : {}),
    ...(options.argumentExtractionEnabled === true ? { toolArgumentExtractor: policy } : {}),
    ...(options.requestClassificationEnabled === true ? { requestClassifier: policy } : {}),
  };
}
