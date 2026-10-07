import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { AgentSpec } from '../../server/types.js';

/** Catalog attach key may sit on `id`; wire Skill is name-only. See builder getSkills. */
export type HarnessSkillMount = TrueForgeApi.Skill & { id?: string };
export type HarnessMcpServerMount = TrueForgeApi.McpServer;

export interface HarnessAgentSpec
  extends
    AgentSpec<TrueForgeApi.Model, HarnessSkillMount, HarnessMcpServerMount, TrueForgeApi.RuntimeConfig>,
    Omit<TrueForgeApi.AgentSpec, 'skills'> {}

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
