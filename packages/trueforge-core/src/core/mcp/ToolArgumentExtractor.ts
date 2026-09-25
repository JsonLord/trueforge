import type { Logger } from 'winston';
import type { RawAssistantMessage } from '../llm/LLMTypes';
import { extractErrorLogFields } from '../util/errorLogFields';
import type { MappedMCPTool } from './convertMCPServers';
import type { AgentToolSchema } from './IMCPServer';
import { validateToolArguments } from './ToolArgumentValidation';

export interface ToolArgumentExtractor {
  extract(input: {
    query: string;
    tool: AgentToolSchema;
    currentArguments: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined>;
}

function parseArguments(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function applyToolArgumentExtraction(params: {
  assistantMessage: RawAssistantMessage;
  toolMapping: Map<string, MappedMCPTool>;
  extractor: ToolArgumentExtractor | undefined;
  query: string | undefined;
  logger: Logger;
}): Promise<RawAssistantMessage> {
  if (!params.extractor || !params.query || !params.assistantMessage.tool_calls) {
    return params.assistantMessage;
  }
  const extractor = params.extractor;
  const query = params.query;

  const toolCalls = await Promise.all(
    params.assistantMessage.tool_calls.map(async toolCall => {
      const mapped = params.toolMapping.get(toolCall.function.name);
      if (!mapped) {
        return toolCall;
      }
      try {
        const extracted = await extractor.extract({
          query,
          tool: mapped.schema,
          currentArguments: parseArguments(toolCall.function.arguments),
        });
        if (!extracted || !validateToolArguments({ schema: mapped.schema.inputSchema, value: extracted })) {
          return toolCall;
        }
        return { ...toolCall, function: { ...toolCall.function, arguments: JSON.stringify(extracted) } };
      } catch (error) {
        params.logger.warn('Tool argument extraction failed open', {
          ...extractErrorLogFields(error),
          serverName: mapped.toolSet.name,
          toolName: mapped.originalToolName,
        });
        return toolCall;
      }
    }),
  );
  return { ...params.assistantMessage, tool_calls: toolCalls };
}
