/**
 * Agent Router - 智能 Agent 路由
 *
 * 架构：用户输入 → prompt优化器 → router → 各agent → 输出
 *
 * 参照 kun 的 auto-model-router 设计
 * 负责根据用户输入选择最合适的 Agent
 */

// ============================================================
// Types
// ============================================================

export interface ModelConfig {
  providerId: string
  modelId: string
  label: string
}

export interface AgentConfig {
  id: string
  name: string
  role: string
  model: ModelConfig
  tools: string[]
  capabilities: string[]
  systemPrompt?: string
}

export interface RouteDecision {
  selectedAgent: AgentConfig | null
  reasoning: string
  confidence: number
  alternativeAgents?: AgentConfig[]
}

export interface RouteContext {
  prompt: string
  availableAgents: AgentConfig[]
  availableModels: ModelConfig[]
  workspacePath?: string
  recentHistory?: Array<{ role: string; content: string }>
}

// ============================================================
// Constants
// ============================================================

const ROUTER_TIMEOUT_MS = 4000

// 任务类型关键词映射
const TASK_KEYWORDS = {
  search: ['find', 'search', 'locate', 'where', 'look', 'explore', 'grep', '查找', '搜索', '探索'],
  review: ['review', 'check', 'audit', 'inspect', 'analyze', '审查', '检查', '分析'],
  implement: ['implement', 'create', 'build', 'write', 'add', 'fix', '实现', '创建', '编写', '修复'],
  optimize: ['optimize', 'improve', 'refactor', 'performance', '优化', '改进', '重构'],
  architecture: ['architect', 'design', 'system', 'structure', '架构', '设计', '系统']
}

// ============================================================
// Router Implementation
// ============================================================

/**
 * 智能 Agent 路由
 *
 * 根据用户输入选择最合适的 Agent
 */
export async function resolveModelRoute(
  context: RouteContext,
  providerManager?: any
): Promise<RouteDecision> {
  const { prompt, availableAgents } = context

  if (availableAgents.length === 0) {
    return {
      selectedAgent: null,
      reasoning: 'No available agents',
      confidence: 0
    }
  }

  if (availableAgents.length === 1) {
    return {
      selectedAgent: availableAgents[0],
      reasoning: 'Only one agent available',
      confidence: 1.0
    }
  }

  // 1. 尝试 LLM 路由器
  try {
    const route = await llmRouter(context, providerManager)
    if (route) return route
  } catch (error) {
    console.warn('LLM router failed, falling back to heuristic:', error)
  }

  // 2. 启发式回退
  return heuristicRouter(context)
}

/**
 * LLM 路由器 - 使用快速模型进行路由决策
 */
async function llmRouter(
  context: RouteContext,
  providerManager?: any
): Promise<RouteDecision | null> {
  if (!providerManager) return null

  const { prompt, availableAgents, recentHistory } = context

  // 构建路由器提示词
  const routerPrompt = buildRouterPrompt(prompt, recentHistory, availableAgents)

  // 调用快速模型（超时 4 秒）
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ROUTER_TIMEOUT_MS)

  try {
    // TODO: 实际调用快速模型 — 需要接入 ProviderManager
    // 当前 LLM 路由器尚未实现，返回 null 降级到启发式路由
    // 这不会导致错误，只是路由精度较低
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 启发式路由器
 */
function heuristicRouter(context: RouteContext): RouteDecision {
  const { prompt, availableAgents } = context

  // 分析任务类型
  const taskType = analyzeTaskType(prompt)

  // 根据任务类型选择 Agent
  const selectedAgent = selectAgentByTaskType(taskType, availableAgents)

  // 计算置信度
  const confidence = calculateConfidence(taskType, selectedAgent, availableAgents)

  // 获取备选 Agent
  const alternativeAgents = availableAgents
    .filter(a => a.id !== selectedAgent?.id)
    .slice(0, 2)

  return {
    selectedAgent,
    reasoning: `Task type: ${taskType}, Selected: ${selectedAgent?.name || 'none'}`,
    confidence,
    alternativeAgents
  }
}

/**
 * 分析任务类型
 */
function analyzeTaskType(prompt: string): string {
  const lowerPrompt = prompt.toLowerCase()

  // 计算每个任务类型的匹配分数
  const scores: Record<string, number> = {}

  for (const [type, keywords] of Object.entries(TASK_KEYWORDS)) {
    scores[type] = keywords.filter(kw => lowerPrompt.includes(kw)).length
  }

  // 找到最高分的任务类型
  let maxScore = 0
  let taskType = 'general'

  for (const [type, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score
      taskType = type
    }
  }

  // 如果没有匹配的关键词，根据提示词长度判断
  if (maxScore === 0) {
    if (prompt.length < 100) return 'simple'
    if (prompt.length > 500) return 'complex'
    return 'general'
  }

  return taskType
}

/**
 * 根据任务类型选择 Agent
 */
function selectAgentByTaskType(
  taskType: string,
  agents: AgentConfig[]
): AgentConfig | null {
  if (agents.length === 0) return null

  // 根据任务类型选择最合适的 Agent 角色
  const roleMapping: Record<string, string[]> = {
    search: ['explorer', 'search', 'research'],
    review: ['reviewer', 'audit', 'quality'],
    implement: ['implementer', 'developer', 'coder'],
    optimize: ['optimizer', 'performance'],
    architecture: ['architect', 'designer', 'orchestrator'],
    simple: ['explorer', 'assistant'],
    complex: ['orchestrator', 'implementer'],
    general: ['orchestrator', 'assistant']
  }

  const preferredRoles = roleMapping[taskType] || ['orchestrator']

  // 查找匹配的 Agent
  for (const role of preferredRoles) {
    const agent = agents.find(a =>
      a.role.toLowerCase().includes(role) ||
      a.name.toLowerCase().includes(role)
    )
    if (agent) return agent
  }

  // 如果没有匹配，返回第一个
  return agents[0]
}

/**
 * 计算置信度
 */
function calculateConfidence(
  taskType: string,
  selectedAgent: AgentConfig | null,
  allAgents: AgentConfig[]
): number {
  if (!selectedAgent) return 0
  if (allAgents.length === 1) return 1.0

  // 基础置信度
  let confidence = 0.6

  // 如果有明确的任务类型，增加置信度
  if (taskType !== 'general' && taskType !== 'simple') {
    confidence += 0.2
  }

  // 如果 Agent 角色匹配，增加置信度
  const roleMatch = selectedAgent.role.toLowerCase().includes(taskType)
  if (roleMatch) {
    confidence += 0.1
  }

  return Math.min(confidence, 1.0)
}

/**
 * 构建路由器提示词
 */
function buildRouterPrompt(
  prompt: string,
  history?: Array<{ role: string; content: string }>,
  agents?: AgentConfig[]
): string {
  const agentsList = agents?.map(a =>
    `- ${a.id} (${a.role}): ${a.capabilities.join(', ')}`
  ).join('\n') || ''

  const recentContext = history?.slice(-6).map(h =>
    `${h.role}: ${h.content.slice(0, 900)}`
  ).join('\n') || 'No history'

  return `You are an agent router. Select the best agent for this task.

Available agents:
${agentsList}

Recent context:
${recentContext}

Current request:
${prompt.slice(0, 2000)}

Respond with JSON: {"agent": "agent-id", "reason": "brief explanation"}`
}

/**
 * 解析路由器响应
 */
function parseRouteResponse(response: string, agents: AgentConfig[]): RouteDecision | null {
  try {
    const parsed = JSON.parse(response)
    const selected = agents.find(a => a.id === parsed.agent)

    if (selected) {
      return {
        selectedAgent: selected,
        reasoning: parsed.reason || 'LLM router decision',
        confidence: 0.8
      }
    }
  } catch {
    // 解析失败
  }
  return null
}

/**
 * 为并行执行选择多个 Agent
 */
export function selectAgentsForParallel(
  context: RouteContext,
  maxAgents: number = 3
): AgentConfig[] {
  const { availableAgents } = context

  if (availableAgents.length <= maxAgents) {
    return availableAgents
  }

  // 选择不同角色的 Agent 以获得多样性
  const selected: AgentConfig[] = []
  const roles = new Set<string>()

  for (const agent of availableAgents) {
    if (!roles.has(agent.role) && selected.length < maxAgents) {
      selected.push(agent)
      roles.add(agent.role)
    }
  }

  // 如果还不够，添加剩余 Agent
  for (const agent of availableAgents) {
    if (selected.length >= maxAgents) break
    if (!selected.includes(agent)) {
      selected.push(agent)
    }
  }

  return selected
}
