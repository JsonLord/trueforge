import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SpynelClient } from '../client/SpynelClient.js';
import type { AppliedSpynelEvents, SpynelConversationEvent, SpynelEventEnvelope } from '../types/protocol.js';

interface PersistedSession {
  conversation: string;
  cursor: string;
  event_ids: string[];
}

interface PersistedMappings {
  schema: 'trueforge.spynel-sessions/v1';
  sessions: Record<string, PersistedSession>;
}

interface AdapterOptions {
  client: SpynelClient;
  statePath: string;
}

function emptyMappings(): PersistedMappings {
  return { schema: 'trueforge.spynel-sessions/v1', sessions: {} };
}

export function conversationForSession(sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 32);
  return `trueforge-${digest}`;
}

export class SpynelChatAdapter {
  private readonly client: SpynelClient;
  private readonly statePath: string;

  constructor(options: AdapterOptions) {
    this.client = options.client;
    this.statePath = options.statePath;
  }

  private async load(): Promise<PersistedMappings> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.statePath, 'utf8'));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('schema' in parsed) ||
        parsed.schema !== 'trueforge.spynel-sessions/v1'
      ) {
        throw new Error('unsupported Spynel session mapping schema');
      }
      if (!('sessions' in parsed) || typeof parsed.sessions !== 'object' || parsed.sessions === null) {
        throw new Error('invalid Spynel session mappings');
      }
      const sessions: Record<string, PersistedSession> = {};
      for (const [key, value] of Object.entries(parsed.sessions)) {
        if (typeof value !== 'object' || value === null) throw new Error('invalid Spynel session mapping');
        if (!('conversation' in value) || typeof value.conversation !== 'string')
          throw new Error('invalid conversation');
        if (!('cursor' in value) || typeof value.cursor !== 'string') throw new Error('invalid cursor');
        if (
          !('event_ids' in value) ||
          !Array.isArray(value.event_ids) ||
          !value.event_ids.every((id: unknown) => typeof id === 'string')
        ) {
          throw new Error('invalid event IDs');
        }
        sessions[key] = { conversation: value.conversation, cursor: value.cursor, event_ids: value.event_ids };
      }
      return { schema: 'trueforge.spynel-sessions/v1', sessions };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return emptyMappings();
      throw new Error('Unable to load Spynel session mappings', { cause: error });
    }
  }

  private async save(mappings: PersistedMappings): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(mappings)}\n`, { mode: 0o600 });
    await rename(temporary, this.statePath);
  }

  private async session(sessionId: string): Promise<{ mappings: PersistedMappings; state: PersistedSession }> {
    const mappings = await this.load();
    const current = mappings.sessions[sessionId];
    if (current !== undefined) return { mappings, state: current };
    const state = { conversation: conversationForSession(sessionId), cursor: '', event_ids: [] };
    mappings.sessions[sessionId] = state;
    await this.save(mappings);
    return { mappings, state };
  }

  async send(options: { sessionId: string; sourceMessageId: string; text: string }): Promise<void> {
    const { state } = await this.session(options.sessionId);
    await this.client.send({
      channel: 'cli',
      conversation: state.conversation,
      source_message_id: options.sourceMessageId,
      sender: 'trueforge',
      followup_only: false,
      text: options.text,
    });
  }

  async stop(options: { sessionId: string; sourceMessageId: string }): Promise<void> {
    const { state } = await this.session(options.sessionId);
    await this.client.send({
      channel: 'cli',
      conversation: state.conversation,
      source_message_id: options.sourceMessageId,
      sender: 'trueforge',
      followup_only: false,
      text: '/stop',
    });
  }

  async history(sessionId: string): Promise<AppliedSpynelEvents> {
    const { mappings, state } = await this.session(sessionId);
    const snapshot = await this.client.conversation(state.conversation);
    state.cursor = snapshot.cursor;
    state.event_ids = snapshot.events.map(event => event.id).slice(-512);
    await this.save(mappings);
    return { events: snapshot.events, cursor: snapshot.cursor };
  }

  async applyEnvelope(options: {
    sessionId: string;
    envelope: SpynelEventEnvelope;
    apply: (event: SpynelConversationEvent) => Promise<void>;
  }): Promise<void> {
    const { mappings, state } = await this.session(options.sessionId);
    const event = options.envelope.event;
    if (event !== undefined && !state.event_ids.includes(event.id)) {
      await options.apply(event);
      state.event_ids = [...state.event_ids, event.id].slice(-512);
    }
    if (options.envelope.cursor !== undefined) state.cursor = options.envelope.cursor;
    await this.save(mappings);
  }
}
