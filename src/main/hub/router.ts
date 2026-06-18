import { AgentInfo } from './registry'
import { AGENTS } from './agents'

interface RouteRule {
  patterns: string[]
  targetId: string
  priority: number
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
    return best ? best.id : (availableAgents[0]?.id || null)
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

  routeWithMention(text: string): string | null {
    const mentionMatch = text.match(/@(\w+)/)
    return mentionMatch ? mentionMatch[1].toLowerCase() : null
  }
}
