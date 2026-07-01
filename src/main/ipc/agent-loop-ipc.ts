/**
 * Agent Loop IPC handlers
 *
 * 添加 AgentLoop 的 IPC 接口
 * 使用真实 agent 检测，只返回本地可用的 Agent
 */

import { ipcMain } from 'electron'
import { getAgentLoopIntegration } from '../hub/agent-loop-integration'
import { detectAgentsAsync, type DetectedAgent } from '../hub/agent-detector'
import type { AgentRegistry } from '../hub/registry'

// Agent 角色映射
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

// 缓存检测结果
let cachedAgents: DetectedAgent[] | null = null
let lastDetectionTime = 0
const CACHE_DURATION_MS = 60_000 // 1 分钟缓存

export function registerAgentLoopIpc(registry: AgentRegistry): void {
  // 获取 AgentLoop 集成实例
  const agentLoop = getAgentLoopIntegration(registry)

  // AgentLoop 配置
  ipcMain.handle("agentLoop:getConfig", () => {
    return {
      maxSteps: 10,
      timeoutMs: 120000,
      enableDelegation: true,
      defaultMode: 'auto'
    }
  })

  // AgentLoop 状态
  ipcMain.handle("agentLoop:getStatus", () => {
    return {
      available: true,
      activeTasks: 0
    }
  })

  // 获取可用 Agents - 使用真实检测，只返回本地可用的
  ipcMain.handle("agentLoop:getAgents", async () => {
    const now = Date.now()

    // 使用缓存或重新检测
    if (!cachedAgents || now - lastDetectionTime > CACHE_DURATION_MS) {
      try {
        cachedAgents = await detectAgentsAsync()
        lastDetectionTime = now
      } catch {
        // 检测失败时使用空列表
        if (!cachedAgents) cachedAgents = []
      }
    }

    // 只返回 found=true 的 agent，并添加角色信息
    const availableAgents = cachedAgents
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

    return availableAgents
  })

  // 强制刷新 Agent 检测
  ipcMain.handle("agentLoop:refreshAgents", async () => {
    cachedAgents = null
    lastDetectionTime = 0
    // 触发重新检测
    const agents = await detectAgentsAsync()
    cachedAgents = agents
    lastDetectionTime = Date.now()

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
  })

  // 获取路由信息
  ipcMain.handle("agentLoop:getRouteInfo", (_event, prompt: string) => {
    const lowerPrompt = prompt.toLowerCase()
    let taskType = 'general'
    let selectedAgent = 'claude'
    let confidence = 0.5
    let suggestedRole = 'orchestrator'

    if (lowerPrompt.includes('find') || lowerPrompt.includes('search') || lowerPrompt.includes('explore') || lowerPrompt.includes('查找') || lowerPrompt.includes('搜索')) {
      taskType = 'search'
      selectedAgent = 'hermes'
      suggestedRole = 'explorer'
      confidence = 0.8
    } else if (lowerPrompt.includes('review') || lowerPrompt.includes('check') || lowerPrompt.includes('audit') || lowerPrompt.includes('审查') || lowerPrompt.includes('检查')) {
      taskType = 'review'
      selectedAgent = 'claude'
      suggestedRole = 'reviewer'
      confidence = 0.7
    } else if (lowerPrompt.includes('implement') || lowerPrompt.includes('create') || lowerPrompt.includes('build') || lowerPrompt.includes('write') || lowerPrompt.includes('实现') || lowerPrompt.includes('创建')) {
      taskType = 'implement'
      selectedAgent = 'codex'
      suggestedRole = 'implementer'
      confidence = 0.7
    } else if (lowerPrompt.includes('optimize') || lowerPrompt.includes('refactor') || lowerPrompt.includes('improve') || lowerPrompt.includes('优化') || lowerPrompt.includes('重构')) {
      taskType = 'optimize'
      selectedAgent = 'codex'
      suggestedRole = 'optimizer'
      confidence = 0.7
    } else if (lowerPrompt.includes('design') || lowerPrompt.includes('architect') || lowerPrompt.includes('设计') || lowerPrompt.includes('架构')) {
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
      reasoning: `任务类型: ${taskType}, 选择 Agent: ${selectedAgent}, 建议身份: ${suggestedRole}`
    }
  })
}
