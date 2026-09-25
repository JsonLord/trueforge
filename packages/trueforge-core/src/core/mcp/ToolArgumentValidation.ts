import { z } from 'zod';
import type { AgentToolSchema } from './IMCPServer';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonSchema(value: unknown): value is z.core.JSONSchema.JSONSchema {
  return typeof value === 'boolean' || isJsonObject(value);
}

export function validateToolArguments(params: {
  schema: AgentToolSchema['inputSchema'];
  value: Record<string, unknown>;
}): boolean {
  try {
    return isJsonSchema(params.schema) && z.fromJSONSchema(params.schema).safeParse(params.value).success;
  } catch {
    return false;
  }
}

export function parseAndValidateToolArguments(params: {
  schema: AgentToolSchema['inputSchema'];
  serializedArguments: string | undefined;
}): boolean {
  try {
    const value: unknown = JSON.parse(params.serializedArguments ?? '{}');
    return isJsonObject(value) && validateToolArguments({ schema: params.schema, value });
  } catch {
    return false;
  }
}
