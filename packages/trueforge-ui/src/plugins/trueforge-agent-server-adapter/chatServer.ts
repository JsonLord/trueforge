/**
 * Harness `AgentChatServer` adapter for @truefoundry/trueforge-ui.
 *
 * Runtime contract: opaque mounts (`object`), flat `ListResult` (`data` +
 * `nextPageToken`), and `null` normalized to absent. Harness keys MCP mounts by
 * name and returns `null` for optional fields — the maps below bridge both.
 *
 * Skills are name (+ optional preload) refs on the wire (`Skill`).
 *
 * Session create takes `{ name }` or `{ spec }`; reads carry the
 * `reference`/`inline` discriminator, with reference rows already naming their
 * agent. The UI filters with registry `agentId`.
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { readSessionIsCreateAgent } from '../../atoms/lib/sessionCreateAgent.js';
import type {
  AgentChatServer,
  CreateSessionRequest,
  ListResult,
  Session,
  Turn,
  TurnInputItem,
  TurnStreamingEvent,
  UserMessageContent,
} from '../../server/types.js';
import { createTrueForgeClient, type CreateTrueForgeClientOptions } from './client.js';
import { DirectSpynelChatAdapter } from './spynelAdapter.js';
import { toUiEventItem, toUiStreamingEvent, toUiTurnState } from './toUiTurnState.js';
import {
  isSpynelAgent,
  isSpynelSession,
  SYSTEM_SPYNEL_AGENT_ID,
  SYSTEM_SPYNEL_AGENT_NAME,
  type HarnessAgentSpec,
  type HarnessMcpServerMount,
  type HarnessSkillMount,
} from './types.js';

export type { HarnessAgentSpec, HarnessMcpServerMount, HarnessSkillMount } from './types.js';
export type CreateHarnessChatServerOptions = CreateTrueForgeClientOptions & {
  /** Injected client — skips creating one from options. */
  client?: TrueForge;
};

/** UI session with create-agent intent for resume chrome. */
export type HarnessUiSession = Session<HarnessAgentSpec> & { isCreateAgent: boolean };

export type HarnessCreateSessionRequest = CreateSessionRequest<HarnessAgentSpec> & {
  metadata?: Record<string, string>;
};

function toUiMcpServer(server: TrueForgeApi.McpServer): HarnessMcpServerMount {
  return server;
}

function toUiSkill(skill: TrueForgeApi.Skill): HarnessSkillMount {
  return { name: skill.name, preload: skill.preload === true };
}

function toHarnessSkill(skill: HarnessSkillMount): TrueForgeApi.Skill {
  // Picker `id` is AvailableSkill.name (attach key); `name` is display — see builder getSkills.
  return { name: skill.id ?? skill.name, preload: skill.preload === true };
}

/** Drop UI draft `id` before admission; Harness MCP mounts are name-keyed. */
export function toHarnessAgentSpec(spec: HarnessAgentSpec): TrueForgeApi.AgentSpec {
  const { skills, mcpServers, ...rest } = spec;
  return {
    ...rest,
    ...(mcpServers === undefined
      ? {}
      : {
          mcpServers: mcpServers.map(server => {
            // Draft picker may round-trip mounts as `{ id, name, ... }`; strip UI-only `id`.
            if ('id' in server) {
              const { id, ...mount } = server;
              void id;
              return mount;
            }
            return server;
          }),
        }),
    ...(skills === undefined ? {} : { skills: skills.map(toHarnessSkill) }),
  };
}

export function toUiAgentSpec(spec: TrueForgeApi.AgentSpec): HarnessAgentSpec {
  const { mcpServers, skills, ...rest } = spec;
  return {
    ...rest,
    ...(mcpServers ? { mcpServers: mcpServers.map(toUiMcpServer) } : {}),
    ...(skills ? { skills: skills.map(toUiSkill) } : {}),
  };
}

function toUiSession(session: TrueForgeApi.Session): HarnessUiSession {
  return {
    id: session.id,
    isMutable: session.agent.type === 'inline',
    isCreateAgent: readSessionIsCreateAgent(session.metadata),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.title === null ? {} : { title: session.title }),
    // `name` is a create-time snapshot, so references whose agent predates it stay
    // unlabelled; `isMutable` alone keeps them out of the composer.
    ...(session.agent.type === 'reference' && session.agent.name !== null ? { agentName: session.agent.name } : {}),
    ...(session.agent.type === 'inline' ? { agentSpec: toUiAgentSpec(session.agent.spec) } : {}),
  };
}

function createSessionMetadata(request: HarnessCreateSessionRequest): Record<string, string> | undefined {
  if (request.metadata === undefined) return undefined;
  return request.metadata;
}

/** Spread drops the interface identity, which is what makes the SDK's index-signature part type accept it. */
function toUiContent(content: TrueForgeApi.UserMessageContent): UserMessageContent {
  return typeof content === 'string' ? content : content.map(part => ({ ...part }));
}

function toUiInput(input: TrueForgeApi.TurnInputItem[]): TurnInputItem[] {
  return input.map(item => (item.type === 'user.message' ? { ...item, content: toUiContent(item.content) } : item));
}

function toUiTurn(turn: TrueForgeApi.Turn): Turn {
  const { previousTurnId, input, state, ...rest } = turn;
  return {
    ...rest,
    state: toUiTurnState(state),
    ...(previousTurnId === null ? {} : { previousTurnId }),
    ...(input === undefined ? {} : { input: toUiInput(input) }),
  };
}

export interface HarnessPageSource<T> {
  data: T[];
  response: { pagination: TrueForgeApi.TokenPagination };
}

export function toListResult<TSource, TResult>(
  page: HarnessPageSource<TSource>,
  map: (item: TSource) => TResult | undefined,
): ListResult<TResult> {
  const data: TResult[] = [];
  for (const item of page.data) {
    const mapped = map(item);
    if (mapped !== undefined) data.push(mapped);
  }
  const token = page.response.pagination.nextPageToken;
  return {
    data,
    ...(token === undefined ? {} : { nextPageToken: token }),
  };
}

function sequenceNumber(id: string | undefined, fallback: number): number {
  if (id === undefined) return fallback;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function toHarnessContent(content: UserMessageContent): TrueForgeApi.UserMessageContent {
  if (typeof content === 'string') return content;
  return content.map(part => {
    if (part.type === 'text') return part;
    const { name, data } = part;
    if (typeof name !== 'string' || typeof data !== 'string') {
      throw new Error('File attachment must carry a string `name` and a data-URI `data`');
    }
    return { type: 'file', name, data };
  });
}

function toHarnessInput(input: TurnInputItem[]): TrueForgeApi.TurnInputItem[] {
  return input.map(item =>
    item.type === 'user.message' ? { ...item, content: toHarnessContent(item.content) } : item,
  );
}

export function createHarnessChatServer(
  options: CreateHarnessChatServerOptions = {},
): AgentChatServer<HarnessAgentSpec, HarnessUiSession, HarnessCreateSessionRequest> {
  const client = options.client ?? createTrueForgeClient(options);
  const spynelAdapter = new DirectSpynelChatAdapter();
  const spynelSessions = new Map<string, HarnessUiSession>();

  return {
    async downloadSandboxFile({ sessionId, turnId, path }) {
      if (isSpynelSession(sessionId)) {
        throw new Error('Sandbox downloads are not applicable for Spynel sessions');
      }
      const response = await client.sessions.downloadSandboxFile(sessionId, turnId, { path });
      return response.blob();
    },

    async createSession(request) {
      if (isSpynelAgent(request.agentName)) {
        const id = `spynel-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const now = new Date().toISOString();
        const session: HarnessUiSession = {
          id,
          agentName: SYSTEM_SPYNEL_AGENT_NAME,
          isMutable: false,
          isCreateAgent: false,
          createdAt: now,
          updatedAt: now,
          title: 'Spynel Control Plane',
        };
        spynelSessions.set(id, session);
        return session;
      }

      const metadata = createSessionMetadata(request);
      if (request.agentName !== undefined && request.agentName.length > 0) {
        const created = await client.sessions.create({
          agent: { name: request.agentName },
          ...(metadata === undefined ? {} : { metadata }),
        });
        return toUiSession(created.data);
      }
      if (request.agentSpec !== undefined) {
        const created = await client.sessions.create({
          agent: { spec: toHarnessAgentSpec(request.agentSpec) },
          ...(metadata === undefined ? {} : { metadata }),
        });
        return toUiSession(created.data);
      }
      throw new Error('createSession requires agentName or agentSpec');
    },

    async listSessions(request = {}) {
      const nativePage = await client.sessions.list({
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.order === undefined ? {} : { order: request.order }),
        ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
        ...(request.agentId === undefined || request.agentId.length === 0 ? {} : { agentId: request.agentId }),
        ...(request.createdByMe === undefined ? {} : { createdByMe: request.createdByMe }),
      });
      const nativeResult = toListResult(nativePage, toUiSession);
      if (request.agentId === SYSTEM_SPYNEL_AGENT_ID || request.agentId === SYSTEM_SPYNEL_AGENT_NAME) {
        return { data: Array.from(spynelSessions.values()) };
      }
      return {
        data: [...Array.from(spynelSessions.values()), ...nativeResult.data],
        ...(nativeResult.nextPageToken ? { nextPageToken: nativeResult.nextPageToken } : {}),
      };
    },

    async getSession({ sessionId }) {
      if (isSpynelSession(sessionId)) {
        const existing = spynelSessions.get(sessionId);
        if (existing) return existing;
        const now = new Date().toISOString();
        const session: HarnessUiSession = {
          id: sessionId,
          agentName: SYSTEM_SPYNEL_AGENT_NAME,
          isMutable: false,
          isCreateAgent: false,
          createdAt: now,
          updatedAt: now,
          title: 'Spynel Control Plane',
        };
        spynelSessions.set(sessionId, session);
        return session;
      }
      const response = await client.sessions.get(sessionId);
      return toUiSession(response.data);
    },

    async deleteSession({ sessionId }) {
      if (isSpynelSession(sessionId)) {
        spynelSessions.delete(sessionId);
        return;
      }
      await client.sessions.delete(sessionId);
    },

    async updateSession({ sessionId, agentSpec }) {
      if (isSpynelSession(sessionId)) {
        throw new Error('System agent Spynel session is not editable');
      }
      const response = await client.sessions.update(sessionId, {
        ...(agentSpec === undefined ? {} : { agent: { spec: toHarnessAgentSpec(agentSpec) } }),
      });
      return toUiSession(response.data);
    },

    async *createTurn({
      sessionId,
      input,
      previousTurnId,
    }: {
      sessionId: string;
      input?: TurnInputItem[];
      previousTurnId?: string;
    }) {
      if (isSpynelSession(sessionId)) {
        let userText = '';
        if (input !== undefined) {
          for (const item of input) {
            if (item.type === 'user.message') {
              if (typeof item.content === 'string') {
                userText += item.content;
              } else if (Array.isArray(item.content)) {
                for (const part of item.content) {
                  if (part.type === 'file') {
                    throw new Error('Attachments are not supported for Spynel sessions');
                  }
                  if (part.type === 'text') {
                    userText += part.text;
                  }
                }
              }
            }
          }
        }

        const sourceMessageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await spynelAdapter.send({
          sessionId,
          sourceMessageId,
          text: userText,
        });

        const historyResult = await spynelAdapter.history(sessionId);
        const lastEvent = historyResult.events[historyResult.events.length - 1];
        const responseText = lastEvent?.final_text ?? lastEvent?.text ?? 'Spynel operation completed.';

        const now = new Date().toISOString();
        yield {
          sequenceNumber: 0,
          event: {
            id: `evt-created-${Date.now()}`,
            type: 'thread.created',
            threadId: sessionId,
            title: 'Spynel',
            agentInfo: { name: SYSTEM_SPYNEL_AGENT_NAME, input: SYSTEM_SPYNEL_AGENT_NAME },
            createdAt: now,
          } as TurnStreamingEvent,
        };

        yield {
          sequenceNumber: 1,
          event: {
            id: `evt-delta-${Date.now()}`,
            type: 'model.message.delta',
            threadId: sessionId,
            delta: {
              content: responseText,
            },
            createdAt: now,
          } as TurnStreamingEvent,
        };

        yield {
          sequenceNumber: 2,
          event: {
            id: `evt-done-${Date.now()}`,
            type: 'thread.done',
            threadId: sessionId,
            state: { status: 'done', completedAt: now },
            createdAt: now,
          } as TurnStreamingEvent,
        };
        return;
      }

      const stream = await client.sessions.createTurnStream(sessionId, {
        ...(input === undefined ? {} : { input: toHarnessInput(input) }),
        ...(previousTurnId === undefined ? {} : { previousTurnId }),
      });
      let fallbackSequence = 0;
      for await (const item of stream.withMetadata()) {
        const event = toUiStreamingEvent(item.data);
        if (event !== undefined) {
          yield {
            sequenceNumber: sequenceNumber(item.id, fallbackSequence),
            event,
          };
        }
        fallbackSequence += 1;
      }
    },

    async *subscribeToTurn({
      sessionId,
      turnId,
      afterSequenceNumber,
    }: {
      sessionId: string;
      turnId: string;
      afterSequenceNumber?: number;
    }) {
      if (isSpynelSession(sessionId)) {
        const now = new Date().toISOString();
        yield {
          sequenceNumber: 0,
          event: {
            id: `evt-done-${Date.now()}`,
            type: 'thread.done',
            threadId: sessionId,
            state: { status: 'done', completedAt: now },
            createdAt: now,
          } as TurnStreamingEvent,
        };
        return;
      }

      const stream = await client.sessions.subscribeToTurn(sessionId, turnId, {
        ...(afterSequenceNumber === undefined ? {} : { afterSequenceNumber }),
      });
      let fallbackSequence = 0;
      for await (const item of stream.withMetadata()) {
        const event = toUiStreamingEvent(item.data);
        if (event !== undefined) {
          yield {
            sequenceNumber: sequenceNumber(item.id, fallbackSequence),
            event,
          };
        }
        fallbackSequence += 1;
      }
    },

    async cancelSession({ sessionId }) {
      if (isSpynelSession(sessionId)) {
        const sourceMessageId = `stop-${Date.now()}`;
        await spynelAdapter.stop({ sessionId, sourceMessageId });
        return;
      }
      await client.sessions.cancel(sessionId);
    },

    async listTurns({ sessionId, limit, pageToken }) {
      if (isSpynelSession(sessionId)) {
        const historyResult = await spynelAdapter.history(sessionId);
        const turns: Turn[] = historyResult.events.map(event => ({
          id: event.id,
          turnId: event.id,
          sessionId,
          createdAt: event.at,
          state: event.done ? { status: 'done', completedAt: event.at } : { status: 'running' },
          input: event.text ? [{ type: 'user.message', content: event.text }] : [],
        }));
        return { data: turns };
      }
      const page = await client.sessions.listTurns(sessionId, {
        ...(limit === undefined ? {} : { limit }),
        ...(pageToken === undefined ? {} : { pageToken }),
      });
      return toListResult(page, toUiTurn);
    },

    async getTurn({ sessionId, turnId }) {
      if (isSpynelSession(sessionId)) {
        const historyResult = await spynelAdapter.history(sessionId);
        const event = historyResult.events.find(e => e.id === turnId);
        if (!event) throw new Error(`Turn not found: ${turnId}`);
        return {
          id: event.id,
          turnId: event.id,
          sessionId,
          createdAt: event.at,
          state: event.done ? { status: 'done', completedAt: event.at } : { status: 'running' },
          input: event.text ? [{ type: 'user.message', content: event.text }] : [],
        };
      }
      const response = await client.sessions.getTurn(sessionId, turnId);
      return toUiTurn(response.data);
    },

    async listEvents({ sessionId, pageToken, lastTurnId, limit }) {
      if (isSpynelSession(sessionId)) {
        return { data: [] };
      }
      const page = await client.sessions.listEvents(sessionId, {
        ...(pageToken === undefined ? {} : { pageToken }),
        ...(lastTurnId === undefined ? {} : { lastTurnId }),
        ...(limit === undefined ? {} : { limit }),
      });
      return toListResult(page, toUiEventItem);
    },
  };
}
