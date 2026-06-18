import { describe, it, expect } from 'vitest'
import { KeywordRouter } from '../router'

// route() 只读 .id，最小化构造 AgentInfo
const agents = (...ids: string[]) => ids.map(id => ({ id })) as any

describe('KeywordRouter 智能路由（按任务类型打分）', () => {
  const r = new KeywordRouter()
  const all = agents('codex', 'claude', 'openclaw', 'hermes', 'marvis', 'minimax-code')

  it('编码类任务 → codex', () => {
    expect(r.route('帮我写代码 实现一个函数并修复 bug', all)).toBe('codex')
  })

  it('分析/写作类任务 → claude', () => {
    expect(r.route('请分析这份报告并总结，然后翻译成英文文档', all)).toBe('claude')
  })

  it('自动化/部署类任务 → openclaw', () => {
    expect(r.route('帮我部署这个 pipeline 并写个自动化脚本', all)).toBe('openclaw')
  })

  it('混合但编码主导 → 取命中最多的 codex', () => {
    expect(r.route('重构这个函数，修复 bug，实现新的 api', all)).toBe('codex')
  })

  it('无任何关键词 → 回退首个可用 agent', () => {
    expect(r.route('你好呀', agents('claude', 'codex'))).toBe('claude')
  })

  it('只在可用 agent 中选择（codex 不可用时分析类命中 claude）', () => {
    expect(r.route('分析并解释这段内容', agents('claude', 'openclaw'))).toBe('claude')
  })

  it('routeScores 降序且仅含命中者', () => {
    const s = r.routeScores('部署 pipeline 自动化脚本', all)
    expect(s[0].id).toBe('openclaw')
    expect(s.every(x => x.score > 0)).toBe(true)
    for (let i = 1; i < s.length; i++) expect(s[i - 1].score).toBeGreaterThanOrEqual(s[i].score)
  })
})
