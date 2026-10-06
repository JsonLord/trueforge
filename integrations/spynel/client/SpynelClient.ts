import { lstatSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { Readable } from 'node:stream';

import type {
  SpynelConversationSnapshot,
  SpynelEventEnvelope,
  SpynelMessage,
  SpynelStatus,
} from '../types/protocol.js';

const MAX_DESCRIPTOR_BYTES = 4096;
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

export class SpynelTransportError extends Error {}
export class SpynelAmbiguousMessageError extends SpynelTransportError {}
export class SpynelCursorError extends SpynelTransportError {
  constructor(public readonly code: string) {
    super(`Spynel event cursor requires resynchronization: ${code}`);
  }
}

interface ClientOptions {
  socketPath: string;
  maxBodyBytes?: number;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  body?: SpynelMessage;
  signal?: AbortSignal;
}

function readDescriptor(socketPath: string): { token: string } {
  const descriptorPath = `${socketPath}.json`;
  const socket = lstatSync(socketPath);
  const descriptor = lstatSync(descriptorPath);
  if (
    !socket.isSocket() ||
    !descriptor.isFile() ||
    (socket.mode & 0o777) !== 0o600 ||
    (descriptor.mode & 0o777) !== 0o600
  ) {
    throw new SpynelTransportError('Spynel socket and descriptor must be private files');
  }
  if (descriptor.size > MAX_DESCRIPTOR_BYTES) {
    throw new SpynelTransportError('Spynel socket descriptor exceeds its size limit');
  }
  const value: unknown = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schema' in value) ||
    value.schema !== 'spynel.socket/v1' ||
    !('workspace_id' in value) ||
    typeof value.workspace_id !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.workspace_id) ||
    !('token' in value) ||
    typeof value.token !== 'string' ||
    value.token.length < 32 ||
    value.token.length > 128
  ) {
    throw new SpynelTransportError('Invalid Spynel socket descriptor');
  }
  return { token: value.token };
}

function parseEventEnvelope(value: unknown): SpynelEventEnvelope {
  if (typeof value !== 'object' || value === null || !('schema' in value) || value.schema !== 'spynel.events/v1') {
    throw new SpynelTransportError('Unsupported Spynel event schema');
  }
  const cursor = 'cursor' in value && typeof value.cursor === 'string' ? value.cursor : undefined;
  const error = 'error' in value && typeof value.error === 'string' ? value.error : undefined;
  const code = 'code' in value && typeof value.code === 'string' ? value.code : undefined;
  if ('event' in value && value.event !== undefined) {
    const event = value.event;
    if (
      typeof event !== 'object' ||
      event === null ||
      !('id' in event) ||
      typeof event.id !== 'string' ||
      !('cursor' in event) ||
      typeof event.cursor !== 'string' ||
      !('at' in event) ||
      typeof event.at !== 'string' ||
      !('kind' in event) ||
      typeof event.kind !== 'string'
    ) {
      throw new SpynelTransportError('Invalid Spynel event');
    }
    const text = 'text' in event && typeof event.text === 'string' ? event.text : undefined;
    const requestId = 'request_id' in event && typeof event.request_id === 'string' ? event.request_id : undefined;
    const finalText = 'final_text' in event && typeof event.final_text === 'string' ? event.final_text : undefined;
    const done = 'done' in event && typeof event.done === 'boolean' ? event.done : undefined;
    const continues = 'continues' in event && typeof event.continues === 'boolean' ? event.continues : undefined;
    return {
      schema: 'spynel.events/v1',
      event: {
        id: event.id,
        cursor: event.cursor,
        at: event.at,
        kind: event.kind,
        ...(text === undefined ? {} : { text }),
        ...(requestId === undefined ? {} : { request_id: requestId }),
        ...(finalText === undefined ? {} : { final_text: finalText }),
        ...(done === undefined ? {} : { done }),
        ...(continues === undefined ? {} : { continues }),
      },
      ...(cursor === undefined ? {} : { cursor }),
      ...(error === undefined ? {} : { error }),
      ...(code === undefined ? {} : { code }),
    };
  }
  return {
    schema: 'spynel.events/v1',
    ...(cursor === undefined ? {} : { cursor }),
    ...(error === undefined ? {} : { error }),
    ...(code === undefined ? {} : { code }),
  };
}

async function readBounded(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) {
      stream.destroy();
      throw new SpynelTransportError('Spynel response exceeds its size limit');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export class SpynelClient {
  readonly socketPath: string;
  readonly maxBodyBytes: number;

  constructor(options: ClientOptions) {
    if (!options.socketPath.startsWith('/')) {
      throw new SpynelTransportError('Spynel socket path must be absolute');
    }
    this.socketPath = options.socketPath;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  private request(options: RequestOptions): Promise<http.IncomingMessage> {
    const { token } = readDescriptor(this.socketPath);
    const encoded = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          method: options.method,
          path: options.path,
          socketPath: this.socketPath,
          signal: options.signal,
          headers: {
            authorization: `Bearer ${token}`,
            ...(encoded === undefined
              ? {}
              : { 'content-type': 'application/json', 'content-length': String(encoded.length) }),
          },
        },
        resolve,
      );
      request.on('error', reject);
      if (encoded !== undefined) request.write(encoded);
      request.end();
    });
  }

  private async json<T>(options: RequestOptions): Promise<T> {
    const response = await this.request(options);
    const body = await readBounded(response, this.maxBodyBytes);
    if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
      throw new SpynelTransportError(`Spynel API returned HTTP ${String(response.statusCode ?? 'unknown')}`);
    }
    try {
      return JSON.parse(body.toString('utf8'));
    } catch (error) {
      throw new SpynelTransportError('Spynel API returned invalid JSON', { cause: error });
    }
  }

  async health(): Promise<boolean> {
    const response = await this.request({ method: 'GET', path: '/v1/health' });
    await readBounded(response, 1024);
    return response.statusCode === 204;
  }

  status(conversation: string): Promise<SpynelStatus> {
    return this.json({ method: 'GET', path: `/v1/status?conversation=${encodeURIComponent(conversation)}` });
  }

  conversation(conversation: string): Promise<SpynelConversationSnapshot> {
    return this.json({ method: 'GET', path: `/v1/conversation?conversation=${encodeURIComponent(conversation)}` });
  }

  async send(message: SpynelMessage, signal?: AbortSignal): Promise<void> {
    let response: http.IncomingMessage;
    try {
      response = await this.request({
        method: 'POST',
        path: '/v1/message',
        body: message,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      throw new SpynelAmbiguousMessageError('Spynel message outcome is unknown; reconcile by source message ID', {
        cause: error,
      });
    }
    let terminal = false;
    const decoder = response.setEncoding('utf8');
    let pending = '';
    try {
      for await (const chunk of decoder) {
        pending += chunk;
        if (pending.length > this.maxBodyBytes)
          throw new SpynelTransportError('Spynel response exceeds its size limit');
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === '') continue;
          const envelope: unknown = JSON.parse(line);
          if (typeof envelope === 'object' && envelope !== null && 'handled' in envelope && envelope.handled === true) {
            terminal = true;
          }
          if (typeof envelope === 'object' && envelope !== null && 'event' in envelope) {
            const event = envelope.event;
            if (typeof event === 'object' && event !== null && 'done' in event && event.done === true) terminal = true;
          }
        }
      }
    } catch (error) {
      throw new SpynelAmbiguousMessageError('Spynel message stream was interrupted; reconcile before retrying', {
        cause: error,
      });
    }
    if (!terminal) throw new SpynelAmbiguousMessageError('Spynel message stream ended before a terminal event');
  }

  async events(options: {
    conversation: string;
    after: string;
    signal: AbortSignal;
    apply: (envelope: SpynelEventEnvelope) => Promise<void>;
  }): Promise<never> {
    const query = new URLSearchParams({ conversation: options.conversation, after: options.after });
    const response = await this.request({
      method: 'GET',
      path: `/v1/events?${query.toString()}`,
      signal: options.signal,
    });
    if (response.statusCode !== 200) {
      await readBounded(response, this.maxBodyBytes);
      throw new SpynelTransportError(`Spynel events returned HTTP ${String(response.statusCode ?? 'unknown')}`);
    }
    let pending = '';
    for await (const chunk of response.setEncoding('utf8')) {
      pending += chunk;
      if (pending.length > this.maxBodyBytes)
        throw new SpynelTransportError('Spynel event frame exceeds its size limit');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        const envelope = parseEventEnvelope(JSON.parse(line));
        await options.apply(envelope);
        if (envelope.error !== undefined) throw new SpynelCursorError(envelope.code ?? 'history_unavailable');
      }
    }
    throw new SpynelTransportError('Spynel event stream ended unexpectedly');
  }
}
