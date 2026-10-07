const MAX_DESCRIPTOR_BYTES = 4096;

export interface SpynelConversationEvent {
  id: string;
  cursor: string;
  at: string;
  kind: string;
  text?: string;
  request_id?: string;
  final_text?: string;
  done?: boolean;
  continues?: boolean;
}

export interface SpynelConversationSnapshot {
  schema: 'spynel.events/v1';
  events: SpynelConversationEvent[];
  cursor: string;
  bounded: boolean;
}

interface PersistedSession {
  conversation: string;
  cursor: string;
  event_ids: string[];
}

interface PersistedMappings {
  schema: 'trueforge.spynel-sessions/v1';
  sessions: Record<string, PersistedSession>;
}

function emptyMappings(): PersistedMappings {
  return { schema: 'trueforge.spynel-sessions/v1', sessions: {} };
}

export async function conversationForSession(sessionId: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const encoder = new TextEncoder();
    const data = encoder.encode(sessionId);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `trueforge-${hex.slice(0, 32)}`;
  }
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash << 5) - hash + sessionId.charCodeAt(i);
    hash |= 0;
  }
  return `trueforge-${Math.abs(hash).toString(16).padStart(32, '0')}`;
}

async function readDescriptor(socketPath: string): Promise<{ token: string }> {
  const fs = await import('node:fs');
  const descriptorPath = `${socketPath}.json`;
  const socket = fs.lstatSync(socketPath);
  const descriptor = fs.lstatSync(descriptorPath);
  if (
    !socket.isSocket() ||
    !descriptor.isFile() ||
    (socket.mode & 0o777) !== 0o600 ||
    (descriptor.mode & 0o777) !== 0o600
  ) {
    throw new Error('Spynel socket and descriptor must be private files');
  }
  if (descriptor.size > MAX_DESCRIPTOR_BYTES) {
    throw new Error('Spynel socket descriptor exceeds its size limit');
  }
  const value: unknown = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  if (typeof value !== 'object' || value === null || !('token' in value) || typeof value.token !== 'string') {
    throw new Error('Invalid Spynel socket descriptor');
  }
  return { token: value.token };
}

export class DirectSpynelClient {
  readonly socketPath: string;

  constructor(socketPath?: string) {
    this.socketPath =
      socketPath ?? (typeof process !== 'undefined' ? process.env?.SPYNEL_SOCKET : undefined) ?? '/run/spynel/api.sock';
  }

  private async request(options: { method: 'GET' | 'POST'; path: string; body?: unknown }): Promise<any> {
    const http = await import('node:http');
    const { token } = await readDescriptor(this.socketPath);
    const encoded = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: options.method,
          path: options.path,
          socketPath: this.socketPath,
          headers: {
            authorization: `Bearer ${token}`,
            ...(encoded === undefined
              ? {}
              : { 'content-type': 'application/json', 'content-length': String(encoded.length) }),
          },
        },
        resolve,
      );
      req.on('error', reject);
      if (encoded !== undefined) req.write(encoded);
      req.end();
    });
  }

  async conversation(conversation: string): Promise<SpynelConversationSnapshot> {
    const response = await this.request({
      method: 'GET',
      path: `/v1/conversation?conversation=${encodeURIComponent(conversation)}`,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of response) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async send(options: { conversation: string; sourceMessageId: string; text: string }): Promise<void> {
    const response = await this.request({
      method: 'POST',
      path: '/v1/message',
      body: {
        channel: 'cli',
        conversation: options.conversation,
        source_message_id: options.sourceMessageId,
        sender: 'trueforge',
        followup_only: false,
        text: options.text,
      },
    });
    for await (const _ of response) {
      // drain response
    }
  }
}

export class DirectSpynelChatAdapter {
  private readonly client: DirectSpynelClient;
  private readonly statePath: string;

  constructor(options?: { client?: DirectSpynelClient; statePath?: string }) {
    this.client = options?.client ?? new DirectSpynelClient();
    this.statePath =
      options?.statePath ??
      (typeof process !== 'undefined' ? process.env?.SPYNEL_STATE_PATH : undefined) ??
      '/data/trueforge/state/spynel-sessions.json';
  }

  private async load(): Promise<PersistedMappings> {
    try {
      const fsPromises = await import('node:fs/promises');
      const parsed: unknown = JSON.parse(await fsPromises.readFile(this.statePath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || !('sessions' in parsed)) {
        return emptyMappings();
      }
      return parsed as PersistedMappings;
    } catch {
      return emptyMappings();
    }
  }

  private async save(mappings: PersistedMappings): Promise<void> {
    try {
      const fsPromises = await import('node:fs/promises');
      const pathModule = await import('node:path');
      await fsPromises.mkdir(pathModule.dirname(this.statePath), { recursive: true, mode: 0o700 });
      const temporary = `${this.statePath}.${process.pid}.tmp`;
      await fsPromises.writeFile(temporary, `${JSON.stringify(mappings)}\n`, { mode: 0o600 });
      await fsPromises.rename(temporary, this.statePath);
    } catch {
      // ignore state path persistence errors in memory fallbacks
    }
  }

  private async session(sessionId: string): Promise<{ mappings: PersistedMappings; state: PersistedSession }> {
    const mappings = await this.load();
    const current = mappings.sessions[sessionId];
    if (current !== undefined) return { mappings, state: current };
    const conversation = await conversationForSession(sessionId);
    const state = { conversation, cursor: '', event_ids: [] };
    mappings.sessions[sessionId] = state;
    await this.save(mappings);
    return { mappings, state };
  }

  async send(options: { sessionId: string; sourceMessageId: string; text: string }): Promise<void> {
    const { state } = await this.session(options.sessionId);
    await this.client.send({
      conversation: state.conversation,
      sourceMessageId: options.sourceMessageId,
      text: options.text,
    });
  }

  async stop(options: { sessionId: string; sourceMessageId: string }): Promise<void> {
    await this.send({
      sessionId: options.sessionId,
      sourceMessageId: options.sourceMessageId,
      text: '/stop',
    });
  }

  async history(sessionId: string): Promise<{ events: SpynelConversationEvent[]; cursor: string }> {
    const { mappings, state } = await this.session(sessionId);
    try {
      const snapshot = await this.client.conversation(state.conversation);
      state.cursor = snapshot.cursor;
      state.event_ids = snapshot.events.map(e => e.id).slice(-512);
      await this.save(mappings);
      return { events: snapshot.events, cursor: snapshot.cursor };
    } catch {
      return { events: [], cursor: state.cursor };
    }
  }
}
