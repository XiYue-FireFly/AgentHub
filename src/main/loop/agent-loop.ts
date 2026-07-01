/**
 * Agent Loop - 多Agent协作自循环核心
 *
 * 架构：用户输入 → prompt优化器 → router → 各agent → 输出
 *
 * 支持两种模式：
 * 1. Auto 模式：自动路由到最合适的 Agent
 * 2. Single 模式：指定 Agent 直接执行（适合 API 密钥场景）
 *
 * 参照 kun 的 agent-loop 实现单 agent 自循环
 */

import { EventEmitter } from 'events'
import { resolveModelRoute, type ModelConfig, type RouteDecision } from './model-router'
import { buildPrompt, type PromptContext, type AgentInfo } from '../prompts/prompt-builder'

// ============================================================
// Types
// ============================================================

export type LoopMode = 'auto' | 'single'

export interface LoopConfig {
  maxSteps: number
  timeoutMs: number
  enableDelegation: boolean
  mode: LoopMode
  /** 单 agent 模式时指定的 agent ID */
  singleAgentId?: string
}

export interface LoopContext {
  threadId: string
  turnId: string
  prompt: string
  workspacePath?: string
  availableAgents: AgentConfig[]
  availableModels: ModelConfig[]
  tools: any[]
  signal: AbortSignal
  /** 指定单 agent 模式时使用的 API 配置 */
  apiConfig?: ApiConfig
}

export interface ApiConfig {
  providerId: string
  modelId: string
  apiKey: string
  baseUrl?: string
}

export interface AgentConfig {
  id: string
  name: string
  role: string
  model: ModelConfig
  tools: string[]  // 允许的工具列表
  capabilities: string[]
  systemPrompt?: string
  /** 是否为单 agent 模式 */
  isSingleMode?: boolean
}

export interface LoopResult {
  status: 'completed' | 'failed' | 'aborted'
  output: string
  steps: number
  agentResults: AgentStepResult[]
  durationMs: number
}

export interface AgentStepResult {
  step: number
  agentId: string
  agentName: string
  output: string
  toolCalls?: ToolCallResult[]
  durationMs: number
}

export interface ToolCallResult {
  name: string
  arguments: Record<string, unknown>
  result: string
  error?: string
}

// ============================================================
// Default Config
// ============================================================

const DEFAULT_CONFIG: LoopConfig = {
  maxSteps: 10,
  timeoutMs: 120000,
  enableDelegation: true,
  mode: 'auto'
}

// ============================================================
// Agent Loop Implementation
// ============================================================

export class AgentLoop extends EventEmitter {
  private config: LoopConfig
  private providerManager?: any

  constructor(config: Partial<LoopConfig> = {}, providerManager?: any) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.providerManager = providerManager
  }

  /**
   * 运行完整的 Agent 循环
   *
   * 支持两种模式：
   * - Auto 模式：prompt优化 → router → 各agent → 输出
   * - Single 模式：prompt优化 → 指定agent → 输出（参照 kun 的单 agent loop）
   */
  async run(context: LoopContext): Promise<LoopResult> {
    const startTime = Date.now()
    const { threadId, turnId, prompt, signal } = context

    this.emit('turn:start', { threadId, turnId, mode: this.config.mode })

    try {
      // Step 1: Prompt 优化
      this.emit('step:prompt-optimization', { threadId, turnId })
      const optimizedPrompt = await this.optimizePrompt(context)

      // Step 2: 根据模式选择 Agent
      let selectedAgent: AgentConfig | null = null

      if (this.config.mode === 'single') {
        // 单 Agent 模式：直接使用指定的 Agent 或 API 配置
        this.emit('step:single-agent', { threadId, turnId })
        selectedAgent = this.getSingleAgent(context)
      } else {
        // Auto 模式：智能路由
        this.emit('step:routing', { threadId, turnId })
        const routeDecision = await this.routeToAgent(optimizedPrompt, context)
        selectedAgent = this.selectAgent(routeDecision, context.availableAgents)
      }

      if (!selectedAgent) {
        return {
          status: 'failed',
          output: 'No suitable agent found',
          steps: 0,
          agentResults: [],
          durationMs: Date.now() - startTime
        }
      }

      this.emit('agent:selected', {
        threadId,
        turnId,
        agentId: selectedAgent.id,
        agentName: selectedAgent.name
      })

      // Step 4: Agent 自循环执行
      const result = await this.executeAgent(
        selectedAgent,
        optimizedPrompt,
        context
      )

      this.emit('turn:complete', {
        threadId,
        turnId,
        status: result.status,
        steps: result.steps
      })

      return {
        ...result,
        durationMs: Date.now() - startTime
      }
    } catch (error: any) {
      this.emit('turn:error', { threadId, turnId, error: error.message })
      return {
        status: 'failed',
        output: `Error: ${error.message}`,
        steps: 0,
        agentResults: [],
        durationMs: Date.now() - startTime
      }
    }
  }

  /**
   * 优化 Prompt
   */
  private async optimizePrompt(context: LoopContext): Promise<string> {
    const promptContext: PromptContext = {
      prompt: context.prompt,
      workspacePath: context.workspacePath,
      tools: context.tools,
      agents: context.availableAgents.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        capabilities: a.capabilities
      }))
    }

    return buildPrompt(promptContext)
  }

  /**
   * 智能路由 - 选择最合适的 Agent
   */
  private async routeToAgent(
    prompt: string,
    context: LoopContext
  ): Promise<RouteDecision> {
    return resolveModelRoute({
      prompt,
      availableAgents: context.availableAgents,
      availableModels: context.availableModels,
      workspacePath: context.workspacePath
    }, this.providerManager)
  }

  /**
   * 获取单 Agent 模式的 Agent
   *
   * 参照 kun 的单 agent loop 实现：
   * 1. 如果指定了 singleAgentId，使用该 Agent
   * 2. 如果有 apiConfig，创建一个使用 API 的虚拟 Agent
   * 3. 否则使用第一个可用的 Agent
   */
  private getSingleAgent(context: LoopContext): AgentConfig | null {
    const { availableAgents, apiConfig } = context

    // 1. 使用指定的 Agent ID
    if (this.config.singleAgentId) {
      const agent = availableAgents.find(a => a.id === this.config.singleAgentId)
      if (agent) return { ...agent, isSingleMode: true }
    }

    // 2. 使用 API 配置创建虚拟 Agent
    if (apiConfig) {
      return {
        id: 'api-direct',
        name: `${apiConfig.providerId} / ${apiConfig.modelId}`,
        role: 'implementer',
        model: {
          providerId: apiConfig.providerId,
          modelId: apiConfig.modelId,
          label: `${apiConfig.providerId} / ${apiConfig.modelId}`
        },
        tools: ['read', 'write', 'exec', 'search'],
        capabilities: ['coding', 'implementation'],
        isSingleMode: true
      }
    }

    // 3. 使用第一个可用的 Agent
    if (availableAgents.length > 0) {
      return { ...availableAgents[0], isSingleMode: true }
    }

    return null
  }

  /**
   * 根据路由决策选择 Agent
   */
  private selectAgent(
    route: RouteDecision,
    agents: AgentConfig[]
  ): AgentConfig | null {
    if (agents.length === 0) return null

    // 如果路由决策已经选择了 Agent，直接使用
    if (route.selectedAgent) {
      return route.selectedAgent
    }

    // 如果没有精确匹配，根据 reasoning 中的任务类型选择
    const lowerReasoning = route.reasoning.toLowerCase()

    if (lowerReasoning.includes('complex') || lowerReasoning.includes('architecture')) {
      // 复杂任务选择 Orchestrator 或 Implementer
      return agents.find(a => a.role === 'orchestrator' || a.role === 'implementer') || agents[0]
    }

    if (lowerReasoning.includes('search') || lowerReasoning.includes('explore') || lowerReasoning.includes('search')) {
      // 搜索任务选择 Explorer
      return agents.find(a => a.role === 'explorer') || agents[0]
    }

    if (lowerReasoning.includes('review') || lowerReasoning.includes('check')) {
      // 审查任务选择 Reviewer
      return agents.find(a => a.role === 'reviewer') || agents[0]
    }

    // 默认选择第一个 Agent
    return agents[0]
  }

  /**
   * 执行 Agent 自循环
   */
  private async executeAgent(
    agent: AgentConfig,
    prompt: string,
    context: LoopContext
  ): Promise<LoopResult> {
    const agentResults: AgentStepResult[] = []
    const { threadId, turnId, signal } = context
    const loopStartTime = Date.now()

    for (let step = 0; step < this.config.maxSteps; step++) {
      if (signal.aborted) {
        return {
          status: 'aborted',
          output: 'Aborted by user',
          steps: step,
          agentResults,
          durationMs: Date.now() - loopStartTime
        }
      }

      this.emit('agent:step:start', {
        threadId,
        turnId,
        agentId: agent.id,
        step
      })

      const stepStartTime = Date.now()

      // 调用 Agent
      const agentResponse = await this.callAgent(agent, prompt, context)

      const stepResult: AgentStepResult = {
        step,
        agentId: agent.id,
        agentName: agent.name,
        output: agentResponse.content,
        toolCalls: agentResponse.toolCalls,
        durationMs: Date.now() - stepStartTime
      }

      agentResults.push(stepResult)

      this.emit('agent:step:result', {
        threadId,
        turnId,
        agentId: agent.id,
        step,
        hasToolCalls: (agentResponse.toolCalls?.length || 0) > 0
      })

      // 判断是否继续
      if (!agentResponse.toolCalls || agentResponse.toolCalls.length === 0) {
        // 没有工具调用，Agent 完成
        return {
          status: 'completed',
          output: agentResponse.content,
          steps: step + 1,
          agentResults,
          durationMs: Date.now() - loopStartTime
        }
      }

      // 有工具调用，执行工具并将结果注入
      const toolResults = await this.executeTools(
        agentResponse.toolCalls,
        agent,
        context
      )

      prompt = this.buildContinuationPrompt(
        prompt,
        agentResponse.content,
        toolResults
      )

      this.emit('agent:tools:executed', {
        threadId,
        turnId,
        agentId: agent.id,
        toolCount: toolResults.length
      })
    }

    // 达到最大步数
    return {
      status: 'completed',
      output: 'Reached maximum steps',
      steps: this.config.maxSteps,
      agentResults,
      durationMs: Date.now() - loopStartTime
    }
  }

  /**
   * 调用 Agent
   */
  private async callAgent(
    agent: AgentConfig,
    prompt: string,
    context: LoopContext
  ): Promise<{ content: string; toolCalls?: ToolCallResult[] }> {
    const startTime = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      // 构建 Agent 系统提示词
      const systemPrompt = agent.systemPrompt || this.buildAgentSystemPrompt(agent)

      // TODO: 实际调用 Agent 模型 — 需要接入 ProviderManager
      // 当前 AgentLoop 的模型调用尚未实现，返回明确的未实现提示
      // 避免静默返回模拟数据导致下游逻辑混淆
      return {
        content: `[Not Implemented] AgentLoop callAgent not yet implemented for agent '${agent.name}'. Use the main Dispatcher for agent dispatching.`
      }
    } catch (error: any) {
      return {
        content: `Error from ${agent.name}: ${error.message}`
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * 构建 Agent 系统提示词
   */
  private buildAgentSystemPrompt(agent: AgentConfig): string {
    const basePrompt = `You are ${agent.name}, a specialized AI agent.

Role: ${agent.role}
Capabilities: ${agent.capabilities.join(', ')}

Available tools: ${agent.tools.join(', ')}

Instructions:
- Focus on your specialized role
- Use tools when necessary
- Provide clear, actionable output
- If the task is outside your capabilities, explain what would be needed`

    return basePrompt
  }

  /**
   * 执行工具调用
   */
  private async executeTools(
    toolCalls: ToolCallResult[],
    agent: AgentConfig,
    context: LoopContext
  ): Promise<ToolCallResult[]> {
    const results: ToolCallResult[] = []

    for (const toolCall of toolCalls) {
      // 检查 Agent 是否有权限使用该工具
      if (!agent.tools.includes(toolCall.name)) {
        results.push({
          ...toolCall,
          result: '',
          error: `Agent ${agent.name} does not have permission to use tool ${toolCall.name}`
        })
        continue
      }

      try {
        // TODO: 实际执行工具 — 需要接入 ToolHost
        // 当前 AgentLoop 的工具执行尚未实现，返回明确的未实现错误
        const result = ''
        results.push({ ...toolCall, result, error: `AgentLoop executeTools not yet implemented for tool '${toolCall.name}'.` })
      } catch (error: any) {
        results.push({
          ...toolCall,
          result: '',
          error: error.message
        })
      }
    }

    return results
  }

  /**
   * 构建继续执行的提示词
   */
  private buildContinuationPrompt(
    originalPrompt: string,
    agentOutput: string,
    toolResults: ToolCallResult[]
  ): string {
    const toolResultsText = toolResults.map(tr => {
      if (tr.error) {
        return `[${tr.name}] Error: ${tr.error}`
      }
      return `[${tr.name}] ${tr.result}`
    }).join('\n')

    return `${originalPrompt}

Agent Output:
${agentOutput}

Tool Results:
${toolResultsText}

Please continue based on the tool results above.`
  }
}

/**
 * 创建 Agent Loop 实例
 */
export function createAgentLoop(
  config?: Partial<LoopConfig>,
  providerManager?: any
): AgentLoop {
  return new AgentLoop(config, providerManager)
}
