/**
 * Agent Capability Profile: describe what each agent can do.
 *
 * Combines static manifest data (from agents.ts) with runtime detection
 * results (from agent-detector.ts / agent-locator.ts) and provider
 * binding info to build a complete profile per agent.
 */

import type { AgentBinaryCandidate } from '../hub/agent-locator'

export type AgentProtocol = 'stdio' | 'http' | 'acp'
export type AgentStatus = 'available' | 'detected' | 'unavailable' | 'needs-login' | 'desktop-only'

export interface AgentCapabilityProfile {
  id: string
  name: string
  /** What this agent is good at */
  capabilities: string[]
  /** Communication protocol */
  protocol: AgentProtocol
  /** Current availability status */
  status: AgentStatus
  /** Binary path if detected */
  binaryPath?: string
  /** Version string if detected */
  version?: string
  /** Whether this agent supports tool calling */
  supportsTools: boolean
  /** Whether this agent supports file operations */
  supportsFileOps: boolean
  /** Whether this agent supports command execution */
  supportsExec: boolean
  /** Source: how this agent was discovered */
  source: 'builtin' | 'path' | 'desktop' | 'env' | 'acp' | 'manual'
  /** Provider binding (if using HTTP/API direct) */
  providerBinding?: { providerId: string; modelId: string }
  /** Risk level for approval system */
  defaultApprovalRisk: 'low' | 'medium' | 'high'
  /** Additional notes */
  notes?: string
}

/** Static capability data for known agent types. */
const AGENT_CAPS: Record<string, { capabilities: string[]; supportsTools: boolean; supportsFileOps: boolean; supportsExec: boolean }> = {
  codex: { capabilities: ['coding', 'debug', 'refactor', 'api', 'file-ops', 'exec'], supportsTools: true, supportsFileOps: true, supportsExec: true },
  claude: { capabilities: ['analysis', 'writing', 'translation', 'research', 'coding', 'reasoning'], supportsTools: true, supportsFileOps: true, supportsExec: true },
  'minimax-code': { capabilities: ['coding', 'cli', 'file-ops'], supportsTools: true, supportsFileOps: true, supportsExec: true },
  openclaw: { capabilities: ['automation', 'deploy', 'pipeline', 'script'], supportsTools: true, supportsFileOps: true, supportsExec: true },
  hermes: { capabilities: ['coding', 'analysis'], supportsTools: false, supportsFileOps: false, supportsExec: false },
  marvis: { capabilities: ['analysis', 'research'], supportsTools: false, supportsFileOps: false, supportsExec: false },
  gemini: { capabilities: ['analysis', 'coding', 'research'], supportsTools: true, supportsFileOps: true, supportsExec: false },
  codebuddy: { capabilities: ['coding', 'cli'], supportsTools: false, supportsFileOps: false, supportsExec: false }
}

/**
 * Build a capability profile from detection results.
 */
export function buildAgentProfile(
  agentId: string,
  candidates: AgentBinaryCandidate[],
  binding?: { providerId: string; modelId: string }
): AgentCapabilityProfile {
  const caps = AGENT_CAPS[agentId] || { capabilities: ['general'], supportsTools: false, supportsFileOps: false, supportsExec: false }
  const bestCandidate = candidates.find(c => c.verification !== 'manual') || candidates[0]

  let status: AgentStatus = 'unavailable'
  let source: AgentCapabilityProfile['source'] = 'builtin'

  if (binding) {
    status = 'available'
    source = 'builtin'
  } else if (bestCandidate) {
    if (bestCandidate.kind === 'desktop-candidate' || bestCandidate.verification === 'manual') {
      status = 'desktop-only'
      source = 'desktop'
    } else {
      status = 'detected'
      source = bestCandidate.source === 'desktop' ? 'desktop' : 'path'
    }
  }

  const protocol: AgentProtocol = binding ? 'http' : bestCandidate?.source === 'desktop' ? 'stdio' : 'stdio'

  return {
    id: agentId,
    name: agentId.charAt(0).toUpperCase() + agentId.slice(1).replace(/-/g, ' '),
    capabilities: caps.capabilities,
    protocol,
    status,
    binaryPath: bestCandidate?.path,
    version: bestCandidate?.note,
    supportsTools: caps.supportsTools,
    supportsFileOps: caps.supportsFileOps,
    supportsExec: caps.supportsExec,
    source,
    providerBinding: binding,
    defaultApprovalRisk: caps.supportsExec ? 'medium' : 'low'
  }
}

/**
 * Filter profiles to only those that are truly usable (not desktop-only or unavailable).
 */
export function usableProfiles(profiles: AgentCapabilityProfile[]): AgentCapabilityProfile[] {
  return profiles.filter(p => p.status === 'available' || p.status === 'detected')
}
