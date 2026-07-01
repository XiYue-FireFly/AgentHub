import { AGENT_META } from '../glass/meta'

export function isUsableLocalAgent(agent: LocalAgentStatus): boolean {
  if (!agent.agentId || (!agent.configured && !agent.installed)) return false
  if (agent.loginState === 'needs-login' || agent.loginState === 'not-installed') return false
  if (agent.configured && (agent.protocol === 'stdio-plain' || agent.protocol === 'acp') && !agent.binary?.trim()) return false
  if (agent.manualOnly && agent.requiresPromptArg && agent.protocol !== 'acp' && !/\{prompt\}/i.test(agent.args || '')) return false
  return true
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
