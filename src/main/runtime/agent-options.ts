import { AGENTS } from "../hub/agents"
import { getProviderManager } from "../providers/manager"
import type { LocalAgentStatus } from "./local-agents"

export interface AgentOption {
  agentId: string
  label: string
  status: "idle" | "busy" | "error" | "off"
  installed: boolean
  configured: boolean
}

export function buildAgentOptions(localAgents: LocalAgentStatus[] = []): AgentOption[] {
  const bindings = getProviderManager().getBindings()
  const localById = new Map(localAgents.map(agent => [agent.agentId, agent]))
  const ids = new Set<string>(localAgents
    .filter(agent => agent.configured || agent.installed)
    .map(agent => agent.agentId))
  return [...ids].map(agentId => {
    const meta = AGENTS.find(agent => agent.id === agentId)
    const local = localById.get(agentId)
    const installed = !!local?.installed
    const configured = !!local?.configured
    return {
      agentId,
      label: local?.label || (agentId === "minimax-code" ? "OpenCode" : meta?.name || agentId),
      installed,
      configured,
      status: configured || installed ? "idle" : "off"
    }
  })
}
