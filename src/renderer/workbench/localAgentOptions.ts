import { AGENT_META } from '../glass/meta'

export function isUsableLocalAgent(agent: LocalAgentStatus): boolean {
  return !!agent.agentId && agent.configured && agent.loginState !== 'needs-login'
}

export function localAgentOptions(localAgents: LocalAgentStatus[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const agent of localAgents) {
    if (!isUsableLocalAgent(agent) || seen.has(agent.agentId)) continue
    seen.add(agent.agentId)
    ids.push(agent.agentId)
  }
  return ids
}

export function localAgentLabel(agentId: string): string {
  if (agentId === 'minimax-code') return 'OpenCode'
  return (AGENT_META[agentId]?.name || agentId).replace(' CLI', '').replace(' Code', '')
}

export function localAgentStatus(localAgents: LocalAgentStatus[], agentId: string): LocalAgentStatus | undefined {
  return localAgents.find(agent => agent.agentId === agentId)
}
