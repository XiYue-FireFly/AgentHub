import { AgentInfo } from './registry'
import { AGENTS } from './agents'

interface RouteRule {
  patterns: string[]
  targetId: string
  priority: number
}

export interface WeightedRouteInput {
  text: string
  recentUserMessages?: string[]
  availableAgents: AgentInfo[]
  memories?: Array<{ content?: string; summary?: string; tags?: string[]; category?: string }>
  stats?: Record<string, { success?: number; failure?: number; avgDurationMs?: number }>
}

export interface WeightedRouteScore {
  id: string
  score: number
  reasons: string[]
}

export interface RouteDecision {
  selectedAgentId: string | null
  state: "chat" | "write" | "code" | "git" | "browser" | "terminal" | "review" | "memory"
  scores: WeightedRouteScore[]
  reasons: string[]
  recentUserMessages: string[]
}

export class KeywordRouter {
  private rules: RouteRule[] = []

  constructor() {
    this.initDefaultRules()
  }

  private initDefaultRules(): void {
    // 路由关键词派生自 agents manifest（单一事实源，自动覆盖全部 agent）
    for (const a of AGENTS) {
      if (a.routeKeywords.length) {
        this.addRule({ patterns: a.routeKeywords, targetId: a.id, priority: 10 })
      }
    }
  }

  addRule(rule: RouteRule): void {
    this.rules.push(rule)
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  /**
   * 智能路由：按任务类型给每个可用 agent 打分，选最高分者（而非首个关键词命中）。
   * 评分 = 命中关键词数（每个 +1）+ 关键词长度微权重（越具体越高，仅用于同分微调）。
   * 同分时保留 rules 中更靠前者（更高 priority / manifest 顺序），结果确定。
   */
  route(text: string, availableAgents: AgentInfo[]): string | null {
    const best = this.routeScores(text, availableAgents)[0]
    if (best) return best.id
    const healthy = availableAgents.find(a => a.status !== 'error')
    return healthy?.id || availableAgents[0]?.id || null
  }

  /** 返回各可用 agent 的得分（降序，仅含命中者）；供路由决策与调试/可视化。 */
  routeScores(text: string, availableAgents: AgentInfo[]): Array<{ id: string; score: number }> {
    const lowerText = text.toLowerCase()
    const availableIds = new Set(availableAgents.map(a => a.id))
    const scored: Array<{ id: string; score: number; order: number }> = []

    this.rules.forEach((rule, order) => {
      if (!availableIds.has(rule.targetId)) return
      let score = 0
      for (const pattern of rule.patterns) {
        const p = pattern.toLowerCase()
        if (p && lowerText.includes(p)) score += 1 + Math.min(p.length, 12) / 100
      }
      if (score > 0) scored.push({ id: rule.targetId, score, order })
    })

    scored.sort((a, b) => (b.score - a.score) || (a.order - b.order))
    return scored.map(({ id, score }) => ({ id, score }))
  }

  routeWeighted(input: WeightedRouteInput): RouteDecision {
    const recentUserMessages = (input.recentUserMessages || []).slice(-10)
    const combinedText = [recentUserMessages.join("\n"), input.text].filter(Boolean).join("\n").toLowerCase()
    const state = classifyState(combinedText)
    const base = new Map(this.routeScores(combinedText, input.availableAgents).map(item => [item.id, item.score * 10]))
    const scored: WeightedRouteScore[] = input.availableAgents.map((agent, order) => {
      let score = base.get(agent.id) || 0
      const reasons: string[] = []
      if (score > 0) reasons.push("keyword match")

      const caps = (agent.capabilities || []).map(item => item.toLowerCase())
      const capabilityBoost = capabilityScore(state, caps)
      if (capabilityBoost > 0) {
        score += capabilityBoost
        reasons.push(`${state} capability`)
      }

      const preferenceBoost = memoryPreferenceScore(agent.id, input.memories || [])
      if (preferenceBoost > 0) {
        score += preferenceBoost
        reasons.push("memory preference")
      }

      const stats = input.stats?.[agent.id]
      if (stats) {
        const success = stats.success || 0
        const failure = stats.failure || 0
        if (success > 0) {
          const boost = Math.min(8, success * 1.5)
          score += boost
          reasons.push("historical success")
        }
        if (failure > 0) {
          const penalty = Math.min(10, failure * 2)
          score -= penalty
          reasons.push("historical failures")
        }
        if (stats.avgDurationMs && stats.avgDurationMs < 90_000) {
          score += 1
          reasons.push("fast responses")
        }
      }

      if (score <= 0) {
        score = Math.max(0.1, 1 - order / 100)
        reasons.push("fallback order")
      }
      return { id: agent.id, score: Number(score.toFixed(2)), reasons }
    }).sort((a, b) => b.score - a.score)

    const selectedAgentId = scored[0]?.id || null
    return {
      selectedAgentId,
      state,
      scores: scored,
      reasons: scored[0]?.reasons || [],
      recentUserMessages
    }
  }

  routeWithMention(text: string): string | null {
    // LOW-11: Allow hyphens in agent IDs (e.g. @my-agent)
    const mentionMatch = text.match(/@([\w-]+)/)
    return mentionMatch ? mentionMatch[1].toLowerCase() : null
  }
}

function classifyState(text: string): RouteDecision["state"] {
  if (/(git|branch|commit|diff|merge|rebase|pull|push|分支|提交|冲突)/i.test(text)) return "git"
  if (/(browser|网页|浏览器|打开网站|抓取|页面|url|http)/i.test(text)) return "browser"
  if (/(terminal|shell|cmd|powershell|命令|运行|执行)/i.test(text)) return "terminal"
  if (/(review|审查|检查|安全|漏洞|风险|bug)/i.test(text)) return "review"
  if (/(write|draft|文章|写作|润色|文案|总结|翻译)/i.test(text)) return "write"
  if (/(code|typescript|python|实现|修复|函数|组件|测试|编译)/i.test(text)) return "code"
  if (/(memory|记忆|偏好|长期|导入对话|历史)/i.test(text)) return "memory"
  return "chat"
}

function capabilityScore(state: RouteDecision["state"], capabilities: string[]): number {
  const wanted: Record<RouteDecision["state"], string[]> = {
    chat: ["chat", "reasoning", "analysis"],
    write: ["write", "writing", "analysis"],
    code: ["code", "coding", "edit", "terminal"],
    git: ["git", "code", "terminal"],
    browser: ["browser", "web", "computer"],
    terminal: ["terminal", "shell", "computer"],
    review: ["review", "analysis", "security", "code"],
    memory: ["memory", "analysis", "chat"]
  }
  return wanted[state].reduce((score, item) => score + (capabilities.some(cap => cap.includes(item)) ? 3 : 0), 0)
}

function memoryPreferenceScore(agentId: string, memories: Array<{ content?: string; summary?: string; tags?: string[]; category?: string }>): number {
  const agent = agentId.toLowerCase()
  let score = 0
  for (const memory of memories.slice(0, 24)) {
    const text = `${memory.category || ""} ${(memory.tags || []).join(" ")} ${memory.summary || ""} ${memory.content || ""}`.toLowerCase()
    if (text.includes(agent)) score += 2
    if (text.includes(`prefer ${agent}`) || text.includes(`use ${agent}`) || text.includes(`默认 ${agent}`)) score += 4
  }
  return Math.min(score, 10)
}
