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
