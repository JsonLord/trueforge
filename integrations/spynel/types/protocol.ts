export interface SpynelMessage {
  channel: 'cli';
  conversation: string;
  source_message_id: string;
  sender: 'trueforge';
  followup_only: boolean;
  text: string;
}

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

export interface SpynelEventEnvelope {
  schema: 'spynel.events/v1';
  event?: SpynelConversationEvent;
  cursor?: string;
  error?: string;
  code?: string;
}

export interface SpynelConversationSnapshot {
  schema: 'spynel.events/v1';
  events: SpynelConversationEvent[];
  cursor: string;
  bounded: boolean;
}

export interface SpynelStatus {
  [key: string]: unknown;
}

export interface AppliedSpynelEvents {
  events: SpynelConversationEvent[];
  cursor: string;
}

export const SYSTEM_SPYNEL_AGENT_ID = 'system-spynel';
export const SYSTEM_SPYNEL_AGENT_NAME = 'Spynel';
export const SYSTEM_SPYNEL_DESCRIPTION = 'Persistent orchestration control plane';

export function isSpynelAgent(agentIdOrName: string | undefined | null): boolean {
  if (agentIdOrName === undefined || agentIdOrName === null) return false;
  const trimmed = agentIdOrName.trim();
  return trimmed === SYSTEM_SPYNEL_AGENT_ID || trimmed.toLowerCase() === SYSTEM_SPYNEL_AGENT_NAME.toLowerCase();
}

export function isSpynelSession(
  session: { agentName?: string | null; agentId?: string | null; id?: string | null } | string | undefined | null,
): boolean {
  if (session === undefined || session === null) return false;
  if (typeof session === 'string') {
    return session.startsWith('spynel-') || isSpynelAgent(session);
  }
  if (session.id && session.id.startsWith('spynel-')) return true;
  if (session.agentId && isSpynelAgent(session.agentId)) return true;
  if (session.agentName && isSpynelAgent(session.agentName)) return true;
  return false;
}
