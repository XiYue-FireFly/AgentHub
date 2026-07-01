import { AGENTS } from "../hub/agents"
import { isUsableLocalAgentStatus, type LocalAgentStatus } from "./local-agents"

export interface AgentOption {
  agentId: string
  label: string
  status: "idle" | "busy" | "error" | "off"
  installed: boolean
  configured: boolean
}

export function buildAgentOptions(localAgents: LocalAgentStatus[] = []): AgentOption[] {
  const localById = new Map(localAgents.map(agent => [agent.agentId, agent]))
  const ids = new Set<string>(localAgents
    .filter(isUsableLocalAgentStatus)
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
