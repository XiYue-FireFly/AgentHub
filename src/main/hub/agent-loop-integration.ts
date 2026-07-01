/**
 * Agent Loop Integration
 *
 * 将 AgentLoop 集成到 Dispatcher 系统
 * 架构：用户输入 → prompt优化器 → router → 各agent → 输出
 *
 * 支持两种模式：
 * - Auto 模式：自动路由
 * - Single 模式：单 Agent 直接执行
 */

import { EventEmitter } from 'events'
import { AgentLoop, createAgentLoop, type LoopConfig, type LoopContext, type LoopResult, type AgentConfig, type LoopMode, type ApiConfig } from '../loop/agent-loop'
import type { ModelConfig } from '../loop/model-router'
import { AgentRegistry } from './registry'
import { getProviderManager } from '../providers/manager'

// ============================================================
// Types
// ============================================================

export interface AgentLoopDispatchOptions {
  threadId: string
  turnId: string
  workspacePath?: string
  maxSteps?: number
  timeoutMs?: number
  signal?: AbortSignal
  /** 执行模式 */
  mode?: LoopMode
  /** 单 agent 模式时指定的 agent ID */
  singleAgentId?: string
  /** 单 agent 模式时使用的 API 配置 */
  apiConfig?: ApiConfig
}

export interface AgentLoopDispatchResult {
  taskId: string
  result: LoopResult
}

// ============================================================
// Agent Loop Integration
// ============================================================

export class AgentLoopIntegration extends EventEmitter {
  private agentLoop: AgentLoop
  private registry: AgentRegistry
  private providerManager: any

  constructor(registry: AgentRegistry) {
    super()
    this.registry = registry
    this.providerManager = getProviderManager()
    this.agentLoop = createAgentLoop({
      maxSteps: 10,
      timeoutMs: 120000,
      enableDelegation: true,
      mode: 'auto'
    }, this.providerManager)

    // 转发事件
    this.agentLoop.on('turn:start', (data) => this.emit('turn:start', data))
    this.agentLoop.on('step:routing', (data) => this.emit('step:routing', data))
    this.agentLoop.on('agent:selected', (data) => this.emit('agent:selected', data))
    this.agentLoop.on('agent:step:start', (data) => this.emit('agent:step:start', data))
    this.agentLoop.on('agent:step:result', (data) => this.emit('agent:step:result', data))
    this.agentLoop.on('agent:tools:executed', (data) => this.emit('agent:tools:executed', data))
    this.agentLoop.on('turn:complete', (data) => this.emit('turn:complete', data))
    this.agentLoop.on('turn:error', (data) => this.emit('turn:error', data))
  }

  /**
   * 使用 AgentLoop 执行任务
   */
  async dispatch(
    prompt: string,
    options: AgentLoopDispatchOptions
  ): Promise<AgentLoopDispatchResult> {
    const { threadId, turnId, workspacePath, signal, mode, singleAgentId, apiConfig } = options

    // 根据模式配置 AgentLoop
    if (mode === 'single' || singleAgentId || apiConfig) {
      // 单 Agent 模式：重新创建 AgentLoop 实例
      this.agentLoop = createAgentLoop({
        maxSteps: options.maxSteps || 10,
        timeoutMs: options.timeoutMs || 120000,
        enableDelegation: false, // 单 agent 模式不启用委托
        mode: 'single',
        singleAgentId
      }, this.providerManager)
    }

    // 获取可用的 Agents
    const availableAgents = this.getAvailableAgents()

    // 获取可用的 Models
    const availableModels = this.getAvailableModels()

    // 获取可用的 Tools
    const tools = this.getAvailableTools()

    // 构建 LoopContext
    const context: LoopContext = {
      threadId,
      turnId,
      prompt,
      workspacePath,
      availableAgents,
      availableModels,
      tools,
      signal: signal || new AbortController().signal,
      apiConfig
    }

    // 执行 AgentLoop
    const result = await this.agentLoop.run(context)

    return {
      taskId: `${threadId}-${turnId}`,
      result
    }
  }

  /**
   * 获取可用的 Agents
   */
  private getAvailableAgents(): AgentConfig[] {
    const agents: AgentConfig[] = []

    // 从 registry 获取所有 agent
    const agentIds = ['codex', 'claude', 'hermes', 'openclaw', 'marvis', 'minimax-code', 'gemini', 'codebuddy']

    for (const agentId of agentIds) {
      const agentInfo = this.registry.get(agentId)
      if (agentInfo && agentInfo.status !== 'offline') {
        agents.push({
          id: agentId,
          name: agentInfo.name || agentId,
          role: this.getAgentRole(agentId),
          model: this.getAgentModel(agentId),
          tools: this.getAgentTools(agentId),
          capabilities: agentInfo.capabilities || []
        })
      }
    }

    // 如果没有可用的 agent，添加默认的
    if (agents.length === 0) {
      agents.push({
        id: 'default',
        name: 'Default Agent',
        role: 'orchestrator',
        model: { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' },
        tools: ['read', 'write', 'exec', 'search'],
        capabilities: ['planning', 'implementation']
      })
    }

    return agents
  }

  /**
   * 获取 Agent 角色
   */
  private getAgentRole(agentId: string): string {
    const roleMapping: Record<string, string> = {
      codex: 'implementer',
      claude: 'orchestrator',
      hermes: 'explorer',
      openclaw: 'implementer',
      marvis: 'explorer',
      'minimax-code': 'implementer',
      gemini: 'explorer',
      codebuddy: 'implementer'
    }
    return roleMapping[agentId] || 'orchestrator'
  }

  /**
   * 获取 Agent 模型
   */
  private getAgentModel(agentId: string): ModelConfig {
    const modelMapping: Record<string, ModelConfig> = {
      codex: { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' },
      claude: { providerId: 'anthropic', modelId: 'claude-3-opus', label: 'Claude 3 Opus' },
      hermes: { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' },
      openclaw: { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' },
      marvis: { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' },
      'minimax-code': { providerId: 'minimax', modelId: 'minimax-code', label: 'MiniMax Code' },
      gemini: { providerId: 'google', modelId: 'gemini-pro', label: 'Gemini Pro' },
      codebuddy: { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' }
    }
    return modelMapping[agentId] || { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' }
  }

  /**
   * 获取 Agent 工具
   */
  private getAgentTools(agentId: string): string[] {
    const toolMapping: Record<string, string[]> = {
      codex: ['read', 'write', 'exec', 'search'],
      claude: ['read', 'write', 'exec', 'search'],
      hermes: ['read', 'search'],
      openclaw: ['read', 'write', 'exec', 'search'],
      marvis: ['read', 'search'],
      'minimax-code': ['read', 'write', 'exec', 'search'],
      gemini: ['read', 'search'],
      codebuddy: ['read', 'write', 'exec', 'search']
    }
    return toolMapping[agentId] || ['read', 'write', 'exec', 'search']
  }

  /**
   * 获取可用的 Models
   */
  private getAvailableModels(): ModelConfig[] {
    try {
      const providers = this.providerManager.getProviders()
      const models: ModelConfig[] = []

      for (const provider of providers) {
        if (provider.enabled && provider.apiKey) {
          for (const model of provider.models || []) {
            models.push({
              providerId: provider.id,
              modelId: model.id,
              label: `${provider.name} / ${model.label || model.id}`
            })
          }
        }
      }

      return models.length > 0 ? models : [
        { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' }
      ]
    } catch {
      return [{ providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' }]
    }
  }

  /**
   * 获取可用的 Tools
   */
  private getAvailableTools(): Array<{ name: string; description: string }> {
    return [
      { name: 'read', description: 'Read a file' },
      { name: 'write', description: 'Write a file' },
      { name: 'exec', description: 'Execute a command' },
      { name: 'search', description: 'Search code' },
      { name: 'grep', description: 'Grep files' },
      { name: 'find', description: 'Find files' }
    ]
  }
}

/**
 * 创建 AgentLoopIntegration 实例
 */
let agentLoopIntegration: AgentLoopIntegration | null = null

export function getAgentLoopIntegration(registry?: AgentRegistry): AgentLoopIntegration {
  if (!agentLoopIntegration && registry) {
    agentLoopIntegration = new AgentLoopIntegration(registry)
  }
  return agentLoopIntegration!
}
