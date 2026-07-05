import { getAgentLoopIntegration } from '../hub/agent-loop-integration'
import { detectAgentsAsync, type DetectedAgent } from '../hub/agent-detector'
import type { AgentRegistry } from '../hub/registry'
import { typedHandle } from './typed-ipc'

const AGENT_ROLES: Record<string, { role: string; capabilities: string[] }> = {
  codex: { role: 'implementer', capabilities: ['coding', 'implementation', 'debug'] },
  claude: { role: 'orchestrator', capabilities: ['planning', 'delegation', 'analysis'] },
  hermes: { role: 'explorer', capabilities: ['code-search', 'analysis', 'tools'] },
  openclaw: { role: 'implementer', capabilities: ['coding', 'automation', 'deploy'] },
  marvis: { role: 'explorer', capabilities: ['knowledge', 'browser', 'office'] },
  'minimax-code': { role: 'implementer', capabilities: ['coding', 'agentic', 'tools'] },
  gemini: { role: 'explorer', capabilities: ['analysis', 'research', 'coding'] },
  codebuddy: { role: 'implementer', capabilities: ['coding', 'debugging', 'assistant'] },
  aider: { role: 'implementer', capabilities: ['coding', 'pair-programming'] },
  goose: { role: 'implementer', capabilities: ['automation', 'coding'] },
  mimocode: { role: 'implementer', capabilities: ['coding', 'cli'] },
  zcode: { role: 'implementer', capabilities: ['coding', 'cli'] },
  reasonix: { role: 'explorer', capabilities: ['reasoning', 'cli'] },
  copilot: { role: 'implementer', capabilities: ['coding', 'cli'] }
}

let cachedAgents: DetectedAgent[] | null = null
let lastDetectionTime = 0
const CACHE_DURATION_MS = 60_000

function toAgentLoopAgents(agents: DetectedAgent[]) {
  return agents
    .filter(agent => agent.found)
    .map(agent => {
      const roleInfo = AGENT_ROLES[agent.id] || { role: 'implementer', capabilities: agent.capabilities }
      return {
        id: agent.id,
        name: agent.name,
        role: roleInfo.role,
        capabilities: roleInfo.capabilities,
        version: agent.version,
        path: agent.path
      }
    })
}

async function getCachedDetectedAgents(): Promise<DetectedAgent[]> {
  const now = Date.now()
  if (!cachedAgents || now - lastDetectionTime > CACHE_DURATION_MS) {
    try {
      cachedAgents = await detectAgentsAsync()
      lastDetectionTime = now
    } catch {
      if (!cachedAgents) cachedAgents = []
    }
  }
  return cachedAgents
}

function routePrompt(prompt: string) {
  const lowerPrompt = prompt.toLowerCase()
  let taskType = 'general'
  let selectedAgent = 'claude'
  let confidence = 0.5
  let suggestedRole = 'orchestrator'

  if (
    lowerPrompt.includes('find') ||
    lowerPrompt.includes('search') ||
    lowerPrompt.includes('explore') ||
    lowerPrompt.includes('查找') ||
    lowerPrompt.includes('搜索')
  ) {
    taskType = 'search'
    selectedAgent = 'hermes'
    suggestedRole = 'explorer'
    confidence = 0.8
  } else if (
    lowerPrompt.includes('review') ||
    lowerPrompt.includes('check') ||
    lowerPrompt.includes('audit') ||
    lowerPrompt.includes('审查') ||
    lowerPrompt.includes('检查')
  ) {
    taskType = 'review'
    selectedAgent = 'claude'
    suggestedRole = 'reviewer'
    confidence = 0.7
  } else if (
    lowerPrompt.includes('implement') ||
    lowerPrompt.includes('create') ||
    lowerPrompt.includes('build') ||
    lowerPrompt.includes('write') ||
    lowerPrompt.includes('实现') ||
    lowerPrompt.includes('创建')
  ) {
    taskType = 'implement'
    selectedAgent = 'codex'
    suggestedRole = 'implementer'
    confidence = 0.7
  } else if (
    lowerPrompt.includes('optimize') ||
    lowerPrompt.includes('refactor') ||
    lowerPrompt.includes('improve') ||
    lowerPrompt.includes('优化') ||
    lowerPrompt.includes('重构')
  ) {
    taskType = 'optimize'
    selectedAgent = 'codex'
    suggestedRole = 'optimizer'
    confidence = 0.7
  } else if (
    lowerPrompt.includes('design') ||
    lowerPrompt.includes('architect') ||
    lowerPrompt.includes('设计') ||
    lowerPrompt.includes('架构')
  ) {
    taskType = 'architecture'
    selectedAgent = 'claude'
    suggestedRole = 'orchestrator'
    confidence = 0.7
  }

  return {
    taskType,
    selectedAgent,
    confidence,
    suggestedRole,
    reasoning: `Task type: ${taskType}, selected agent: ${selectedAgent}, suggested role: ${suggestedRole}`
  }
}

export function registerAgentLoopIpc(registry: AgentRegistry): void {
  getAgentLoopIntegration(registry)

  typedHandle("agentLoop:getConfig", () => ({
    maxSteps: 10,
    timeoutMs: 120000,
    enableDelegation: true,
    mode: 'auto' as const
  }))

  typedHandle("agentLoop:getStatus", () => ({
    available: true,
    activeTasks: 0
  }))

  typedHandle("agentLoop:getAgents", async () => {
    const agents = await getCachedDetectedAgents()
    return toAgentLoopAgents(agents)
  })

  typedHandle("agentLoop:refreshAgents", async () => {
    cachedAgents = null
    lastDetectionTime = 0
    cachedAgents = await detectAgentsAsync()
    lastDetectionTime = Date.now()
    return toAgentLoopAgents(cachedAgents)
  })

  typedHandle("agentLoop:getRouteInfo", (_event, prompt) => routePrompt(prompt))
}
